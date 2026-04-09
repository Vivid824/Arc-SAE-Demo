from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, TensorDataset

from analysis_helpers import ensure_dir


class BaseSAE(nn.Module):
    def __init__(self) -> None:
        super().__init__()

    def initialize_encoder_bias(self, value: float = 0.01) -> None:
        with torch.no_grad():
            self.encoder.bias.fill_(value)

    def normalize_decoder(self) -> None:
        with torch.no_grad():
            self.decoder.weight.data = F.normalize(self.decoder.weight.data, dim=0)


class BatchTopKSAE(BaseSAE):
    def __init__(self, d_in: int, n_latents: int, k: int) -> None:
        super().__init__()
        self.encoder = nn.Linear(d_in, n_latents, bias=True)
        self.decoder = nn.Linear(n_latents, d_in, bias=True)
        self.k = k
        self.initialize_encoder_bias()
        self.normalize_decoder()

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        pre_acts = F.relu(self.encoder(x))
        batch_size, n_latents = pre_acts.shape
        topk = min(self.k * batch_size, batch_size * n_latents)

        flat = pre_acts.reshape(-1)
        if topk > 0:
            _, indices = torch.topk(flat, k=topk)
            sparse_flat = torch.zeros_like(flat)
            sparse_flat[indices] = flat[indices]
            sparse_acts = sparse_flat.view_as(pre_acts)
        else:
            sparse_acts = torch.zeros_like(pre_acts)

        reconstruction = self.decoder(sparse_acts)
        return reconstruction, sparse_acts


class TopKSAE(BaseSAE):
    def __init__(self, d_in: int, n_latents: int, k: int) -> None:
        super().__init__()
        self.encoder = nn.Linear(d_in, n_latents, bias=True)
        self.decoder = nn.Linear(n_latents, d_in, bias=True)
        self.k = k
        self.initialize_encoder_bias()
        self.normalize_decoder()

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        pre = self.encoder(x)
        pre_relu = torch.relu(pre)
        k = min(self.k, pre_relu.shape[-1])
        topk_vals, topk_idx = torch.topk(pre_relu, k, dim=-1)
        acts = torch.zeros_like(pre_relu)
        acts.scatter_(-1, topk_idx, topk_vals)
        reconstruction = self.decoder(acts)
        return reconstruction, acts


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    default_artifacts = repo_root / "artifacts"

    parser = argparse.ArgumentParser(description="Train a sparse autoencoder on STATE activations")
    parser.add_argument(
        "--activations-path",
        type=Path,
        default=default_artifacts / "activations_layer4.npy",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_artifacts,
    )
    parser.add_argument(
        "--architecture",
        type=str,
        default="topk",
        choices=("batchtopk", "topk"),
    )
    parser.add_argument("--expansion-factor", type=int, default=2)
    parser.add_argument("--k", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--l1-coefficient", "--l1-coef", dest="l1_coefficient", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--warmup-epochs", type=int, default=3)
    parser.add_argument("--device", type=str, default="cpu")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--inference-batch-size", type=int, default=2048)
    parser.add_argument("--dead-feature-selected-max", type=float, default=0.40)
    parser.add_argument("--dead-feature-preferred-max", type=float, default=0.25)
    parser.add_argument("--early-abort-epoch", type=int, default=15)
    parser.add_argument("--early-abort-dead-fraction", type=float, default=0.70)
    parser.add_argument("--grad-clip-norm", type=float, default=1.0)
    parser.add_argument(
        "--selection-path",
        type=Path,
        default=default_artifacts / "sae_selection.json",
    )
    return parser.parse_args()


def resolve_device(requested: str) -> torch.device:
    def cuda_usable() -> bool:
        if not torch.cuda.is_available():
            return False
        try:
            _ = torch.cuda.current_device()
            return True
        except Exception:
            return False

    if requested == "auto":
        if cuda_usable():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if requested == "cuda" and not cuda_usable():
        raise RuntimeError(
            "Requested --device cuda, but CUDA is not usable on this host. "
            "Check the installed torch build versus the NVIDIA driver, or rerun with --device cpu."
        )
    return torch.device(requested)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    try:
        cuda_ready = torch.cuda.is_available() and torch.cuda.device_count() > 0
    except Exception:
        cuda_ready = False
    if cuda_ready:
        torch.cuda.manual_seed_all(seed)


def build_model(architecture: str, d_in: int, n_latents: int, k: int) -> BaseSAE:
    if architecture == "batchtopk":
        return BatchTopKSAE(d_in=d_in, n_latents=n_latents, k=k)
    if architecture == "topk":
        return TopKSAE(d_in=d_in, n_latents=n_latents, k=k)
    raise ValueError(f"Unsupported architecture: {architecture}")


def main() -> None:
    args = parse_args()
    seed_everything(args.seed)

    ensure_dir(args.output_dir)

    # These activations are already extracted upstream from STATE. This script only
    # trains an SAE on that fixed matrix and preserves its row order exactly.
    activations = np.load(args.activations_path)
    if activations.ndim != 2:
        raise ValueError(
            f"Expected 2D activations matrix at {args.activations_path}, got shape {activations.shape}"
        )

    activations = activations.astype(np.float32, copy=False)
    n_rows, d_model = activations.shape
    n_latents = d_model * args.expansion_factor

    device = resolve_device(args.device)
    if device.type != "cpu":
        print(f"requested device resolved to {device}. This recovery path is CPU-ready and deterministic.")
    model = build_model(args.architecture, d_in=d_model, n_latents=n_latents, k=args.k).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)

    dataset = TensorDataset(torch.from_numpy(activations))
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, drop_last=False)
    global_step = 0

    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        lr_lambda=lambda epoch: (epoch + 1) / args.warmup_epochs if epoch < args.warmup_epochs else 1.0,
    )

    training_log: list[dict[str, float]] = []
    aborted_early = False
    global_feature_max = torch.zeros(n_latents, device=device)

    for epoch in range(args.epochs):
        model.train()
        total_loss = 0.0
        total_recon_loss = 0.0
        total_l1_loss = 0.0
        total_l0 = 0.0
        seen_batches = 0
        epoch_feature_max = torch.zeros(n_latents, device=device)

        for (batch,) in loader:
            batch = batch.to(device)
            reconstruction, sparse_acts = model(batch)
            recon_loss = F.mse_loss(reconstruction, batch)
            l1_loss = sparse_acts.abs().mean()
            loss = recon_loss + (args.l1_coefficient * l1_loss)

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=args.grad_clip_norm)
            optimizer.step()

            total_loss += float(loss.item())
            total_recon_loss += float(recon_loss.item())
            total_l1_loss += float(l1_loss.item())
            total_l0 += float((sparse_acts > 0).sum(dim=1).float().mean().item())
            with torch.no_grad():
                epoch_feature_max = torch.maximum(
                    epoch_feature_max,
                    sparse_acts.detach().max(dim=0).values,
                )
            seen_batches += 1
            global_step += 1

        global_feature_max = torch.maximum(global_feature_max, epoch_feature_max)
        model.normalize_decoder()
        scheduler.step()

        epoch_loss = total_loss / max(seen_batches, 1)
        epoch_recon_loss = total_recon_loss / max(seen_batches, 1)
        epoch_l1_loss = total_l1_loss / max(seen_batches, 1)
        epoch_l0 = total_l0 / max(seen_batches, 1)
        epoch_dead_fraction = float((epoch_feature_max <= 0).float().mean().item())
        global_dead_fraction = float((global_feature_max <= 0).float().mean().item())
        learning_rate = float(optimizer.param_groups[0]["lr"])

        training_log.append(
            {
                "epoch": float(epoch),
                "loss": epoch_loss,
                "reconstructionLoss": epoch_recon_loss,
                "l1Loss": epoch_l1_loss,
                "meanActiveFeatures": epoch_l0,
                "deadFeatureFraction": epoch_dead_fraction,
                "globalDeadFeatureFraction": global_dead_fraction,
                "learningRate": learning_rate,
                "globalStep": float(global_step),
            }
        )
        print(
            f"epoch={epoch:02d} loss={epoch_loss:.6f} "
            f"recon={epoch_recon_loss:.6f} l1={epoch_l1_loss:.6f} "
            f"mean_active={epoch_l0:.2f} epoch_dead_fraction={epoch_dead_fraction:.3f} "
            f"global_dead_fraction={global_dead_fraction:.3f} "
            f"lr={learning_rate:.6f}"
        )

        if (
            args.architecture == "topk"
            and epoch == args.early_abort_epoch
            and global_dead_fraction > args.early_abort_dead_fraction
        ):
            aborted_early = True
            print(
                "EARLY ABORT: "
                f"global dead fraction {global_dead_fraction:.3f} > {args.early_abort_dead_fraction:.2f} "
                f"at epoch {args.early_abort_epoch}. Stopping."
            )
            break

    final_dead_fraction = float((global_feature_max <= 0).float().mean().item())
    selected = not aborted_early and final_dead_fraction <= args.dead_feature_selected_max

    selection_payload: dict[str, Any] = {
        "selected": selected,
        "fallbackRequired": not selected,
        "architecture": args.architecture,
        "expansionFactor": args.expansion_factor,
        "k": args.k,
        "deadFeatureFraction": final_dead_fraction,
        "preferredQuality": final_dead_fraction <= args.dead_feature_preferred_max,
        "trainLogPath": str(args.output_dir / "sae_train_log.json"),
        "featureActsPath": str(args.output_dir / "feature_acts.npy") if selected else None,
        "checkpointPath": str(args.output_dir / "sae_layer4.pt") if selected else None,
        "abortedEarly": aborted_early,
        "earlyAbortEpoch": args.early_abort_epoch,
        "earlyAbortDeadFraction": args.early_abort_dead_fraction,
        "device": str(device),
        "globalDeadFeatureFraction": final_dead_fraction,
    }

    train_log_path = args.output_dir / "sae_train_log.json"
    selection_path = args.selection_path

    with train_log_path.open("w", encoding="utf-8") as handle:
        json.dump(training_log, handle, indent=2)
        handle.write("\n")

    with selection_path.open("w", encoding="utf-8") as handle:
        json.dump(selection_payload, handle, indent=2)
        handle.write("\n")

    print(f"saved training log: {train_log_path}")
    print(f"saved selection metadata: {selection_path}")

    if not selected:
        print("selection=false, skipping checkpoint and feature_acts export for this run")
        return

    model.eval()
    ordered_feature_acts = np.zeros((n_rows, n_latents), dtype=np.float32)

    with torch.no_grad():
        for start in range(0, n_rows, args.inference_batch_size):
            end = min(start + args.inference_batch_size, n_rows)
            batch = torch.from_numpy(activations[start:end]).to(device)
            _, sparse_acts = model(batch)
            ordered_feature_acts[start:end] = sparse_acts.detach().cpu().numpy().astype(np.float32)

    checkpoint_payload = {
        "state_dict": model.state_dict(),
        "config": {
            "d_model": d_model,
            "n_latents": n_latents,
            "expansionFactor": args.expansion_factor,
            "k": args.k,
            "batchSize": args.batch_size,
            "learningRate": args.learning_rate,
            "l1Coefficient": args.l1_coefficient,
            "warmupEpochs": args.warmup_epochs,
            "epochs": args.epochs,
            "architecture": "BatchTopK" if args.architecture == "batchtopk" else "TopK",
            "seed": args.seed,
            "device": str(device),
        },
        "alignment": {
            "featureActsRowOrder": "same_as_activations_layer4.npy",
            "activationSource": str(args.activations_path),
        },
        "training_log": training_log,
    }

    checkpoint_path = args.output_dir / "sae_layer4.pt"
    feature_acts_path = args.output_dir / "feature_acts.npy"

    torch.save(checkpoint_payload, checkpoint_path)
    np.save(feature_acts_path, ordered_feature_acts)

    print(f"saved checkpoint: {checkpoint_path}")
    print(f"saved feature acts: {feature_acts_path} shape={ordered_feature_acts.shape}")
    print("feature_acts row order preserved from activations_layer4.npy")


if __name__ == "__main__":
    main()
