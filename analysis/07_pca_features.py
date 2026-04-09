from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from analysis_helpers import ensure_dir


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    default_artifacts = repo_root / "artifacts"

    parser = argparse.ArgumentParser(
        description=(
            "Prepared-but-not-run PCA fallback for feature activations. "
            "Writes feature_acts.npy and sae_selection.json with architecture=pca."
        )
    )
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
        "--n-components",
        type=int,
        default=50,
        help="Number of principal components to export. Use 0 for full rank.",
    )
    parser.add_argument(
        "--selection-path",
        type=Path,
        default=default_artifacts / "sae_selection.json",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dir(args.output_dir)
    np.random.seed(args.seed)

    activations = np.load(args.activations_path)
    if activations.ndim != 2:
        raise ValueError(
            f"Expected 2D activations matrix at {args.activations_path}, got {activations.shape}"
        )

    activations = activations.astype(np.float32, copy=False)
    n_rows, d_model = activations.shape
    full_rank = min(n_rows, d_model)
    n_components = full_rank if args.n_components <= 0 else min(args.n_components, full_rank)
    if n_components <= 0:
        raise ValueError("n_components must be positive after rank resolution")

    mean = activations.mean(axis=0, keepdims=True)
    centered = activations - mean

    # PCA fallback uses deterministic SVD; no SAE sparsity/dead-feature dynamics apply.
    _, singular_values, right_vectors_t = np.linalg.svd(centered, full_matrices=False)
    components = right_vectors_t[:n_components]
    projected = centered @ components.T
    feature_acts = np.maximum(projected, 0).astype(np.float32, copy=False)

    feature_acts_path = args.output_dir / "feature_acts.npy"
    np.save(feature_acts_path, feature_acts)

    explained_variance = ((singular_values**2) / max(n_rows - 1, 1))[:n_components]
    total_variance = float(np.sum((singular_values**2) / max(n_rows - 1, 1)))
    explained_ratio = (
        explained_variance / total_variance if total_variance > 0 else np.zeros_like(explained_variance)
    )

    pca_payload = {
        "meanPath": str(args.output_dir / "pca_mean.npy"),
        "componentsPath": str(args.output_dir / "pca_components.npy"),
        "explainedVariancePath": str(args.output_dir / "pca_explained_variance.npy"),
        "explainedVarianceRatioPath": str(args.output_dir / "pca_explained_variance_ratio.npy"),
    }
    np.save(args.output_dir / "pca_mean.npy", mean.astype(np.float32, copy=False))
    np.save(args.output_dir / "pca_components.npy", components.astype(np.float32, copy=False))
    np.save(args.output_dir / "pca_explained_variance.npy", explained_variance.astype(np.float32, copy=False))
    np.save(
        args.output_dir / "pca_explained_variance_ratio.npy",
        explained_ratio.astype(np.float32, copy=False),
    )

    train_log_payload = {
        "architecture": "pca",
        "nRows": n_rows,
        "dModel": d_model,
        "nComponents": n_components,
        "deadFeatureFraction": 0.0,
        "note": "PCA has no dead features by definition (linear basis; no sparsity masking).",
        "explainedVarianceRatioCumulative": float(explained_ratio.sum()),
    }
    train_log_path = args.output_dir / "sae_train_log.json"
    with train_log_path.open("w", encoding="utf-8") as handle:
        json.dump(train_log_payload, handle, indent=2)
        handle.write("\n")

    selection_payload = {
        "selected": True,
        "fallbackRequired": False,
        "architecture": "pca",
        "expansionFactor": None,
        "k": None,
        "deadFeatureFraction": 0.0,
        "preferredQuality": True,
        "featureActsPath": str(feature_acts_path),
        "trainLogPath": str(train_log_path),
        "checkpointPath": None,
        "abortedEarly": False,
        "globalDeadFeatureFraction": 0.0,
        "note": "PCA fallback selected. PCA has no dead features by definition.",
        "pca": pca_payload,
    }

    with args.selection_path.open("w", encoding="utf-8") as handle:
        json.dump(selection_payload, handle, indent=2)
        handle.write("\n")

    print(f"saved PCA feature activations: {feature_acts_path}")
    print(f"saved PCA selection metadata: {args.selection_path}")
    print("note: PCA fallback script is prepared-but-not-run by default plan policy.")


if __name__ == "__main__":
    main()
