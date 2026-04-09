from __future__ import annotations

import inspect
import json
import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np


class AnalysisError(RuntimeError):
    pass


ANALYSIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = ANALYSIS_DIR.parent
# Default to the Arc-hosted filtered Replogle AnnData because the direct
# Figshare K562 file is frequently blocked by AWS WAF on cloud hosts.
DEFAULT_DATA_PATH = REPO_ROOT / "data" / "replogle_concat.h5ad"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "artifacts"
DEFAULT_MODEL_DIR = REPO_ROOT / "checkpoints" / "ST-HVG-Replogle" / "fewshot" / "k562"
DEFAULT_SIGNATURES_PATH = REPO_ROOT / "artifacts" / "04_signature_inspection.json"
DEFAULT_MODULES_PATH = REPO_ROOT / "artifacts" / "05_module_inspection.json"
K562_FIGSHARE_URL = "https://figshare.com/ndownloader/files/35773219"

DISPLAY_PERTURBATION_CANDIDATES = (
    "gene",
    "target_gene",
    "gene_target",
    "perturbation",
    "perturbation_label",
)
MODEL_PERTURBATION_CANDIDATES = (
    "guide",
    "guide_id",
    "guide_ids",
    "sgRNA",
    "sgRNA_id",
    "sgrna",
)
BATCH_CANDIDATES = (
    "batch",
    "batch_id",
    "gem_group",
    "seq_batch",
    "library_batch",
    "plate",
)
CELL_TYPE_CANDIDATES = (
    "cell_type",
    "celltype",
    "cell_line",
    "cell_line_name",
)
CONTROL_LABEL_CANDIDATES = (
    "non-targeting",
    "non targeting",
    "nontargeting",
    "nt",
    "control",
    "ctrl",
    "unperturbed",
)


@dataclass(frozen=True)
class CheckpointSelection:
    checkpoint_path: Path
    strategy: str
    candidates: list[str]


def print_header(title: str) -> None:
    print(f"\n== {title} ==")


def print_kv(key: str, value: Any) -> None:
    print(f"{key}: {value}")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def load_config(model_dir: Path) -> tuple[Path, Any]:
    config_path = model_dir / "config.yaml"
    if not config_path.exists():
        raise AnalysisError(f"Missing config.yaml under model dir: {model_dir}")
    try:
        from omegaconf import OmegaConf
    except ModuleNotFoundError as exc:
        raise AnalysisError(
            "OmegaConf is not available. Ensure arc-state installed cleanly before running this script."
        ) from exc
    config = OmegaConf.to_container(OmegaConf.load(config_path), resolve=False)
    return config_path, config


def load_state_model(checkpoint_path: Path, config_path: Path) -> Any:
    from state.tx.models.state_transition import StateTransitionPerturbationModel

    def _load_bare() -> Any:
        return StateTransitionPerturbationModel.load_from_checkpoint(str(checkpoint_path), map_location="cpu")

    def _load_with_hparams() -> Any:
        return StateTransitionPerturbationModel.load_from_checkpoint(
            str(checkpoint_path),
            map_location="cpu",
            hparams_file=str(config_path),
        )

    try:
        return _load_bare()
    except Exception as bare_exc:
        bare_error_text = repr(bare_exc)

        should_retry_with_llama_patch = (
            "validate_architecture" in bare_error_text
            or "hidden size" in bare_error_text.lower()
            or "attention heads" in bare_error_text.lower()
        )

        if should_retry_with_llama_patch:
            try:
                from transformers.models.llama.configuration_llama import LlamaConfig
            except Exception as patch_import_exc:
                raise AnalysisError(
                    "Checkpoint loading hit a LLaMA config validation error, and the temporary "
                    "validation-bypass patch could not be imported.\n"
                    f"bare_error={bare_exc!r}\n"
                    f"patch_import_error={patch_import_exc!r}"
                ) from patch_import_exc

            original_validate = getattr(LlamaConfig, "validate", None)
            try:
                LlamaConfig.validate = lambda self: None  # type: ignore[method-assign]
                return _load_bare()
            except Exception:
                pass
            finally:
                if original_validate is not None:
                    LlamaConfig.validate = original_validate  # type: ignore[method-assign]

        try:
            return _load_with_hparams()
        except Exception as hparams_exc:
            raise AnalysisError(
                "Checkpoint loading failed with both bare load_from_checkpoint(...) and "
                "load_from_checkpoint(..., hparams_file=config.yaml).\n"
                f"bare_error={bare_exc!r}\n"
                f"hparams_error={hparams_exc!r}"
            ) from hparams_exc


def _walk_nested(container: Any, key: str, prefix: str = "") -> list[tuple[str, Any]]:
    matches: list[tuple[str, Any]] = []
    if isinstance(container, dict):
        for child_key, value in container.items():
            child_prefix = f"{prefix}.{child_key}" if prefix else str(child_key)
            if child_key == key:
                matches.append((child_prefix, value))
            matches.extend(_walk_nested(value, key, child_prefix))
    elif isinstance(container, list):
        for idx, value in enumerate(container):
            child_prefix = f"{prefix}[{idx}]"
            matches.extend(_walk_nested(value, key, child_prefix))
    return matches


def find_nested_values(container: Any, candidate_keys: Sequence[str]) -> list[tuple[str, Any]]:
    matches: list[tuple[str, Any]] = []
    for key in candidate_keys:
        matches.extend(_walk_nested(container, key))
    return matches


def first_scalar_value(container: Any, candidate_keys: Sequence[str]) -> tuple[str, Any] | None:
    for path, value in find_nested_values(container, candidate_keys):
        if isinstance(value, (str, int, float, bool)) or value is None:
            return path, value
    return None


def resolve_checkpoint_path(model_dir: Path, checkpoint_name: str | None = None) -> CheckpointSelection:
    root_candidates = []
    for name in ("best.ckpt", "final.ckpt", "last.ckpt"):
        candidate = model_dir / name
        if candidate.exists() and candidate.is_file():
            root_candidates.append(candidate)

    checkpoints_dir = model_dir / "checkpoints"
    nested_candidates = (
        sorted(path for path in checkpoints_dir.rglob("*.ckpt") if path.is_file())
        if checkpoints_dir.exists()
        else []
    )
    candidates = root_candidates + [candidate for candidate in nested_candidates if candidate not in root_candidates]
    candidate_strings = [str(path) for path in candidates]

    if not candidates:
        raise AnalysisError(f"No checkpoint candidates were found under model dir: {model_dir}")

    if checkpoint_name:
        explicit = model_dir / checkpoint_name
        if not explicit.exists():
            explicit = checkpoints_dir / checkpoint_name
        if not explicit.exists():
            raise AnalysisError(
                f"Requested checkpoint '{checkpoint_name}' was not found under {checkpoints_dir}.\n"
                f"Available candidates:\n- " + "\n- ".join(candidate_strings)
            )
        return CheckpointSelection(checkpoint_path=explicit, strategy="explicit", candidates=candidate_strings)

    for preferred_name in ("best.ckpt", "final.ckpt", "last.ckpt"):
        preferred = model_dir / preferred_name
        if preferred.exists() and preferred.is_file():
            return CheckpointSelection(
                checkpoint_path=preferred,
                strategy=preferred_name,
                candidates=candidate_strings,
            )

    for preferred_name in ("best.ckpt", "final.ckpt", "last.ckpt"):
        preferred = checkpoints_dir / preferred_name
        if preferred.exists() and preferred.is_file():
            return CheckpointSelection(
                checkpoint_path=preferred,
                strategy=f"checkpoints/{preferred_name}",
                candidates=candidate_strings,
            )

    if len(candidates) == 1:
        return CheckpointSelection(checkpoint_path=candidates[0], strategy="single-candidate", candidates=candidate_strings)

    raise AnalysisError(
        "Checkpoint filename confirmation failed. Could not choose a single checkpoint automatically.\n"
        f"Model dir: {model_dir}\nAvailable candidates:\n- " + "\n- ".join(candidate_strings)
    )


def find_model_artifact(model_dir: Path, base_name: str, suffixes: Sequence[str]) -> Path | None:
    direct_candidates = [model_dir / f"{base_name}{suffix}" for suffix in suffixes]
    direct_candidates.extend((model_dir / "checkpoints" / f"{base_name}{suffix}" for suffix in suffixes))
    for candidate in direct_candidates:
        if candidate.exists():
            return candidate

    recursive_candidates: list[Path] = []
    for suffix in suffixes:
        recursive_candidates.extend(sorted(model_dir.rglob(f"{base_name}{suffix}")))
    if len(recursive_candidates) > 1:
        raise AnalysisError(
            f"Artifact '{base_name}' is ambiguous under {model_dir}:\n- "
            + "\n- ".join(str(path) for path in recursive_candidates)
        )
    return recursive_candidates[0] if recursive_candidates else None


def require_model_artifact(model_dir: Path, base_name: str, suffixes: Sequence[str]) -> Path:
    artifact_path = find_model_artifact(model_dir, base_name, suffixes)
    if artifact_path is None:
        raise AnalysisError(
            f"Missing required artifact '{base_name}' under {model_dir}. "
            f"Looked for suffixes: {', '.join(suffixes)}"
        )
    return artifact_path


def load_artifact_object(path: Path) -> Any:
    suffix = path.suffix.lower()
    if suffix in {".pt", ".pth", ".torch"}:
        import torch

        # Arc's mapping artifacts are trusted local files, and several of them
        # are generic pickled Python objects rather than plain tensor weights.
        return torch.load(path, map_location="cpu", weights_only=False)
    if suffix in {".pkl", ".pickle"}:
        with path.open("rb") as handle:
            return pickle.load(handle)
    if suffix == ".json":
        return read_json(path)
    raise AnalysisError(f"Unsupported artifact suffix for {path}")


def stringify(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def require_unique_obs_column(adata: Any, override: str | None, candidates: Sequence[str], purpose: str, allow_missing: bool = False) -> str | None:
    obs_columns = list(adata.obs.columns)
    if override:
        if override not in adata.obs.columns:
            raise AnalysisError(
                f"Requested {purpose} column '{override}' was not found.\nAvailable columns:\n- "
                + "\n- ".join(obs_columns)
            )
        return override

    matches = [column for column in candidates if column in adata.obs.columns]
    if allow_missing and not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise AnalysisError(
            f"Could not resolve {purpose} column automatically.\nExpected one of:\n- "
            + "\n- ".join(candidates)
            + "\nAvailable columns:\n- "
            + "\n- ".join(obs_columns)
        )
    raise AnalysisError(
        f"Ambiguous {purpose} column resolution. Found multiple candidates: {matches}.\n"
        "Pass an explicit override flag to disambiguate."
    )


def resolve_matrix_source(adata: Any, embed_key: str | None, model_input_dim: int | None = None) -> tuple[str, np.ndarray]:
    if embed_key in {None, "", "X", ".X"}:
        return "X", matrix_to_numpy(adata.X)
    if embed_key in adata.obsm:
        return f"obsm:{embed_key}", matrix_to_numpy(adata.obsm[embed_key])
    if embed_key in adata.layers:
        return f"layer:{embed_key}", matrix_to_numpy(adata.layers[embed_key])
    x_matrix = matrix_to_numpy(adata.X)
    if model_input_dim is not None and x_matrix.ndim == 2 and x_matrix.shape[1] == model_input_dim:
        return "X", x_matrix
    raise AnalysisError(
        f"Embedding source '{embed_key}' was not found in adata.X / adata.obsm / adata.layers."
    )


def matrix_to_numpy(matrix: Any) -> np.ndarray:
    if hasattr(matrix, "detach") and hasattr(matrix, "cpu"):
        matrix = matrix.detach().cpu().numpy()
    if hasattr(matrix, "toarray"):
        matrix = matrix.toarray()
    elif hasattr(matrix, "A"):
        matrix = matrix.A
    return np.asarray(matrix)


def infer_model_input_dim(model: Any) -> int | None:
    basal_encoder = getattr(model, "basal_encoder", None)
    if basal_encoder is None:
        return None
    in_features = getattr(basal_encoder, "in_features", None)
    if isinstance(in_features, int):
        return in_features
    for child in getattr(basal_encoder, "modules", lambda: [])():
        child_in = getattr(child, "in_features", None)
        if isinstance(child_in, int):
            return child_in
    return None


def resolve_cell_sentence_len(model: Any, config: Any) -> tuple[int, str]:
    config_value = first_scalar_value(config, ("cell_set_len", "cell_sentence_len", "max_set_len"))
    config_int = config_value[1] if config_value is not None and isinstance(config_value[1], int) else None

    model_value = getattr(model, "cell_sentence_len", None)
    model_int = model_value if isinstance(model_value, int) else None

    if config_int is not None and model_int is not None and config_int != model_int:
        raise AnalysisError(
            "cell_set_len mismatch between config and loaded model.\n"
            f"config_value={config_int} ({config_value[0]})\n"
            f"model.cell_sentence_len={model_int}"
        )

    if config_int is not None:
        return config_int, config_value[0]
    if model_int is not None:
        return model_int, "model.cell_sentence_len"

    raise AnalysisError("Could not resolve cell_set_len from config.yaml or model.cell_sentence_len.")


def supports_padded_forward(model: Any) -> tuple[bool, str]:
    signature = inspect.signature(model.forward)
    return ("padded" in signature.parameters), str(signature)


def prepare_batch_like_infer(
    ctrl_basal_np: np.ndarray,
    pert_onehots: Any,
    batch_indices: Any,
    pert_names: list[str],
    device: Any,
) -> dict[str, Any]:
    import torch

    x_batch = torch.tensor(ctrl_basal_np, dtype=torch.float32, device=device)
    pert_tensor = (
        pert_onehots.to(device)
        if hasattr(pert_onehots, "to")
        else torch.tensor(pert_onehots, dtype=torch.float32, device=device)
    )
    batch: dict[str, Any] = {
        "ctrl_cell_emb": x_batch,
        "pert_emb": pert_tensor,
        "pert_name": pert_names,
    }
    if batch_indices is not None:
        batch["batch"] = (
            batch_indices.to(device)
            if hasattr(batch_indices, "to")
            else torch.tensor(batch_indices, dtype=torch.long, device=device)
        )
    return batch


def prepare_batch_like_infer_signature() -> str:
    return str(inspect.signature(prepare_batch_like_infer))


def resolve_transformer_block(model: Any) -> dict[str, Any]:
    preferred_paths = (
        "transformer_backbone.h",
        "transformer_backbone.layers",
        "transformer_backbone.model.layers",
    )
    for path in preferred_paths:
        try:
            module = get_module_by_name(model, path)
        except AnalysisError:
            continue
        length = getattr(module, "__len__", None)
        if callable(length):
            module_len = len(module)
            if module_len > 0:
                middle_index = module_len // 2
                return {
                    "container_path": path,
                    "num_blocks": module_len,
                    "selected_block_path": f"{path}.{middle_index}",
                    "strategy": "preferred-path",
                }

    import torch.nn as nn

    module_lists: list[tuple[str, nn.ModuleList]] = []
    for name, module in model.named_modules():
        if isinstance(module, nn.ModuleList) and len(module) > 0 and "transformer_backbone" in name:
            module_lists.append((name, module))
    if len(module_lists) == 1:
        name, module = module_lists[0]
        middle_index = len(module) // 2
        return {
            "container_path": name,
            "num_blocks": len(module),
            "selected_block_path": f"{name}.{middle_index}",
            "strategy": "transformer-backbone-modulelist",
        }

    raise AnalysisError(
        "Could not infer a hookable transformer block automatically. "
        "Run 05_list_modules.py and pass an explicit --hook-path to 06_extract_activations.py."
    )


def get_module_by_name(model: Any, module_path: str) -> Any:
    module: Any = model
    for part in module_path.split("."):
        if part.isdigit():
            module = module[int(part)]
            continue
        if not hasattr(module, part):
            raise AnalysisError(f"Module path '{module_path}' could not be resolved at '{part}'.")
        module = getattr(module, part)
    return module
