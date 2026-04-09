from __future__ import annotations

import argparse
import inspect
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import anndata as ad
import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import (
    BATCH_CANDIDATES,
    CELL_TYPE_CANDIDATES,
    CONTROL_LABEL_CANDIDATES,
    DEFAULT_DATA_PATH,
    DEFAULT_MODEL_DIR,
    DEFAULT_MODULES_PATH,
    DEFAULT_OUTPUT_DIR,
    DISPLAY_PERTURBATION_CANDIDATES,
    MODEL_PERTURBATION_CANDIDATES,
    AnalysisError,
    ensure_dir,
    find_model_artifact,
    first_scalar_value,
    get_module_by_name,
    infer_model_input_dim,
    load_artifact_object,
    load_config,
    load_state_model,
    prepare_batch_like_infer,
    prepare_batch_like_infer_signature,
    matrix_to_numpy,
    print_header,
    print_kv,
    read_json,
    resolve_cell_sentence_len,
    resolve_checkpoint_path,
    resolve_matrix_source,
    resolve_transformer_block,
    require_model_artifact,
    require_unique_obs_column,
    stringify,
    supports_padded_forward,
    write_json,
    write_jsonl,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Hook-first STATE activation extraction on a model-compatible Replogle AnnData file."
    )
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--adata-path", type=Path, default=DEFAULT_DATA_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--checkpoint-name", type=str, default=None)
    parser.add_argument("--display-pert-col", type=str, default=None)
    parser.add_argument("--model-pert-col", type=str, default=None)
    parser.add_argument("--batch-col", type=str, default=None)
    parser.add_argument("--cell-type-col", type=str, default=None)
    parser.add_argument("--control-label", type=str, default=None)
    parser.add_argument("--embed-key", type=str, default=None)
    parser.add_argument("--hook-path", type=str, default=None)
    parser.add_argument("--pert-name-map", type=Path, default=None)
    parser.add_argument("--module-json", type=Path, default=DEFAULT_MODULES_PATH)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit-perturbations", type=int, default=None)
    parser.add_argument("--max-windows-per-perturbation", type=int, default=None)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--include-control-targets", action="store_true")
    return parser.parse_args()


def unique_non_empty(values: list[str] | np.ndarray) -> list[str]:
    return sorted({stringify(value) for value in values if stringify(value)})


def preview_list(values: list[str], limit: int = 5) -> list[str]:
    return values[:limit]


def lower_lookup(values: list[str]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for value in values:
        lookup[stringify(value).lower()] = value
    return lookup


def resolve_control_label(
    display_values: np.ndarray,
    explicit: str | None,
    config: Any,
    model: Any,
) -> str:
    unique_values = unique_non_empty(display_values)
    lookup = lower_lookup(unique_values)

    if explicit:
        explicit_key = explicit.strip().lower()
        if explicit in unique_values:
            return explicit
        if explicit_key in lookup:
            return lookup[explicit_key]
        raise AnalysisError(
            f"Explicit control label '{explicit}' was not found in the display perturbation column.\n"
            f"Observed values sample: {preview_list(unique_values, 20)}"
        )

    config_candidates: list[str] = []
    model_control = getattr(model, "control_pert", None)
    if isinstance(model_control, str) and model_control.strip():
        config_candidates.append(model_control)
    config_value = first_scalar_value(config, ("control_pert",))
    if config_value is not None and isinstance(config_value[1], str):
        config_candidates.append(config_value[1])

    for candidate in config_candidates:
        lowered = candidate.strip().lower()
        if lowered in lookup:
            return lookup[lowered]

    matches = [lookup[candidate] for candidate in CONTROL_LABEL_CANDIDATES if candidate in lookup]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise AnalysisError(
            "Multiple plausible control labels were found in the display perturbation column. "
            f"Pass --control-label explicitly. Matches: {matches}"
        )

    raise AnalysisError(
        "Could not resolve the control perturbation label automatically. "
        "Pass --control-label explicitly."
    )


def resolve_control_model_key(
    *,
    pert_map: dict[str, Any],
    explicit_mapping: dict[str, Any] | None,
    control_display_label: str,
    config: Any,
    model: Any,
) -> str:
    candidates: list[str] = []
    if explicit_mapping is not None:
        candidates.append(stringify(explicit_mapping.get("control_model_key", "")))
    model_control = getattr(model, "control_pert", None)
    if isinstance(model_control, str):
        candidates.append(stringify(model_control))
    config_value = first_scalar_value(config, ("control_pert",))
    if config_value is not None and isinstance(config_value[1], str):
        candidates.append(stringify(config_value[1]))
    candidates.append(control_display_label)

    for candidate in candidates:
        if candidate and candidate in pert_map:
            return candidate

    raise AnalysisError(
        "Could not resolve a valid control model key present in pert_onehot_map.\n"
        f"control_display_label={control_display_label}\n"
        f"candidate_controls={candidates}"
    )


def normalize_embed_key(candidate: Any) -> str | None:
    if candidate is None:
        return None
    if isinstance(candidate, str):
        cleaned = candidate.strip()
        if cleaned.lower() in {"", "none", "null"}:
            return None
        return cleaned
    return str(candidate)


def resolve_embed_key(args: argparse.Namespace, config: Any, model: Any) -> str | None:
    if args.embed_key is not None:
        return normalize_embed_key(args.embed_key)

    model_embed_key = normalize_embed_key(getattr(model, "embed_key", None))
    if model_embed_key is not None:
        return model_embed_key

    config_value = first_scalar_value(config, ("embed_key",))
    if config_value is not None:
        return normalize_embed_key(config_value[1])

    return None


def load_perturbation_map(model_dir: Path) -> dict[str, Any]:
    artifact_path = require_model_artifact(model_dir, "pert_onehot_map", (".pt", ".pkl", ".pickle"))
    payload = load_artifact_object(artifact_path)
    if not isinstance(payload, dict):
        raise AnalysisError(f"pert_onehot_map artifact did not load as a dict: {artifact_path}")
    return {stringify(key): value for key, value in payload.items()}


def load_optional_map(model_dir: Path, base_name: str) -> tuple[Path | None, dict[str, Any] | None]:
    artifact_path = find_model_artifact(model_dir, base_name, (".pt", ".pkl", ".pickle"))
    if artifact_path is None:
        return None, None
    payload = load_artifact_object(artifact_path)
    if not isinstance(payload, dict):
        raise AnalysisError(f"{base_name} artifact did not load as a dict: {artifact_path}")
    return artifact_path, {stringify(key): value for key, value in payload.items()}


def coerce_index(value: Any, *, name: str) -> int:
    array = matrix_to_numpy(value)
    if array.ndim == 0:
        return int(array.item())
    flat = np.asarray(array).reshape(-1)
    if flat.size == 1:
        return int(flat[0])
    max_index = int(np.argmax(flat))
    if not np.isclose(flat[max_index], 1.0):
        raise AnalysisError(f"Could not coerce {name} value to an index cleanly: {value}")
    return max_index


def build_pert_rows(model_key: str, pert_map: dict[str, Any], n_rows: int) -> np.ndarray:
    value = pert_map[model_key]
    array = matrix_to_numpy(value).astype(np.float32).reshape(-1)
    if array.size == 1:
        index = int(array[0])
        if index < 0 or index >= len(pert_map):
            raise AnalysisError(f"Perturbation index for key '{model_key}' is out of bounds: {index}")
        vector = np.zeros(len(pert_map), dtype=np.float32)
        vector[index] = 1.0
    else:
        vector = array
    return np.repeat(vector[None, :], n_rows, axis=0)


def resolve_batch_indices(
    adata: ad.AnnData,
    batch_col: str | None,
    batch_map: dict[str, Any] | None,
) -> tuple[np.ndarray | None, str | None]:
    if batch_col is None:
        return None, None
    if batch_map is None:
        raise AnalysisError(
            f"Batch column '{batch_col}' was resolved, but batch_onehot_map is missing from the model dir."
        )
    values = [stringify(value) for value in adata.obs[batch_col].tolist()]
    indices = np.empty(len(values), dtype=np.int64)
    for idx, value in enumerate(values):
        if value in batch_map:
            indices[idx] = coerce_index(batch_map[value], name=f"batch:{value}")
            continue
        lowered_matches = [key for key in batch_map if key.lower() == value.lower()]
        if len(lowered_matches) == 1:
            indices[idx] = coerce_index(batch_map[lowered_matches[0]], name=f"batch:{value}")
            continue
        raise AnalysisError(
            f"Batch value '{value}' from column '{batch_col}' was not found in batch_onehot_map."
        )
    return indices, batch_col


def load_mapping_payload(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    if not path.exists():
        raise AnalysisError(f"Explicit perturbation mapping file does not exist: {path}")
    payload = read_json(path)
    if not isinstance(payload, dict):
        raise AnalysisError(f"Explicit perturbation mapping file must be a JSON object: {path}")
    return payload


def write_mapping_template(
    path: Path,
    *,
    display_column: str,
    model_column: str | None,
    control_display_label: str,
    display_examples: list[str],
    model_examples: list[str],
    model_keys: list[str],
) -> None:
    payload = {
        "notes": [
            "Fill guide_value_to_model_key only if the AnnData model column values do not match pert_onehot_map keys exactly.",
            "Fill model_key_to_display to collapse multiple guide-level model keys under a single display gene label.",
            "Keep control_display_label aligned to the AnnData display perturbation column.",
        ],
        "display_column": display_column,
        "model_column": model_column,
        "control_display_label": control_display_label,
        "control_model_key": "",
        "guide_value_to_model_key": {},
        "model_key_to_display": {},
        "observed_display_values_sample": display_examples,
        "observed_model_values_sample": model_examples,
        "model_keys_sample": model_keys,
    }
    write_json(path, payload)


def resolve_perturbation_rows(
    *,
    adata: ad.AnnData,
    display_col: str,
    model_col: str | None,
    control_display_label: str,
    pert_map: dict[str, Any],
    explicit_mapping: dict[str, Any] | None,
    output_dir: Path,
) -> tuple[np.ndarray, np.ndarray, str, str | None]:
    display_values = np.asarray([stringify(value) for value in adata.obs[display_col].tolist()], dtype=object)
    display_unique = unique_non_empty(display_values.tolist())
    pert_keys = set(pert_map)

    non_control_display = sorted({value for value in display_unique if value != control_display_label})
    if non_control_display and set(non_control_display).issubset(pert_keys):
        row_model_keys = display_values.copy()
        return display_values, row_model_keys, "gene-direct", display_col

    if model_col is not None:
        model_values = np.asarray([stringify(value) for value in adata.obs[model_col].tolist()], dtype=object)
        model_unique = unique_non_empty(model_values.tolist())
        non_control_model = sorted(
            {
                model_values[idx]
                for idx in range(len(model_values))
                if display_values[idx] != control_display_label and model_values[idx]
            }
        )
        if non_control_model and set(non_control_model).issubset(pert_keys):
            for model_key in non_control_model:
                mask = model_values == model_key
                mapped_display_values = sorted({display_values[idx] for idx in np.where(mask)[0] if display_values[idx]})
                if len(mapped_display_values) != 1:
                    raise AnalysisError(
                        f"Model perturbation key '{model_key}' maps to multiple display labels: {mapped_display_values}.\n"
                        "Use an explicit --pert-name-map to disambiguate."
                    )
            return display_values, model_values, "guide-direct", model_col

        if explicit_mapping is not None:
            guide_to_model = {
                stringify(key): stringify(value)
                for key, value in explicit_mapping.get("guide_value_to_model_key", {}).items()
                if stringify(key)
            }
            model_to_display = {
                stringify(key): stringify(value)
                for key, value in explicit_mapping.get("model_key_to_display", {}).items()
                if stringify(key)
            }
            control_model_key = stringify(explicit_mapping.get("control_model_key", ""))

            row_model_keys: list[str] = []
            row_display_labels: list[str] = []
            for idx, raw_model_value in enumerate(model_values):
                mapped_model = guide_to_model.get(raw_model_value, raw_model_value)
                display_value = display_values[idx]
                if display_value == control_display_label and not mapped_model:
                    mapped_model = control_model_key
                if mapped_model and display_value != control_display_label and mapped_model not in pert_keys:
                    raise AnalysisError(
                        f"Explicit mapping resolved '{raw_model_value}' -> '{mapped_model}', "
                        "but that key is not present in pert_onehot_map."
                    )
                mapped_display = model_to_display.get(mapped_model, display_value)
                row_model_keys.append(mapped_model)
                row_display_labels.append(mapped_display)

            return (
                np.asarray(row_display_labels, dtype=object),
                np.asarray(row_model_keys, dtype=object),
                "explicit-map",
                model_col,
            )

        template_path = output_dir / "pert_name_map.template.json"
        write_mapping_template(
            template_path,
            display_column=display_col,
            model_column=model_col,
            control_display_label=control_display_label,
            display_examples=preview_list(display_unique, 20),
            model_examples=preview_list(model_unique, 20),
            model_keys=preview_list(sorted(pert_keys), 20),
        )
        raise AnalysisError(
            "Perturbation names do not resolve cleanly between AnnData and pert_onehot_map.\n"
            f"Wrote template mapping file to: {template_path}\n"
            "Fill that file and re-run with --pert-name-map."
        )

    raise AnalysisError(
        "Display perturbation values do not match pert_onehot_map keys directly, and no model perturbation column "
        "was resolved. Pass --model-pert-col or provide an explicit --pert-name-map."
    )


def apply_control_model_key(
    row_display_labels: np.ndarray,
    row_model_keys: np.ndarray,
    *,
    control_display_label: str,
    control_model_key: str,
) -> np.ndarray:
    updated = np.asarray(row_model_keys, dtype=object).copy()
    control_mask = row_display_labels == control_display_label
    updated[control_mask] = control_model_key
    return updated


def select_display_label_rows(
    *,
    row_display_labels: np.ndarray,
    row_model_keys: np.ndarray,
    group_labels: np.ndarray,
    group_has_control_pool: dict[str, bool],
    pert_map: dict[str, Any],
    control_display_label: str,
    min_cells_required: int,
    max_non_control_labels: int,
    cap_per_label: int = 256,
) -> tuple[list[str], dict[str, np.ndarray], list[dict[str, Any]]]:
    eligible_indices_by_display: dict[str, list[int]] = defaultdict(list)
    for idx, (display_label, model_key, group_label) in enumerate(
        zip(row_display_labels.tolist(), row_model_keys.tolist(), group_labels.tolist(), strict=True)
    ):
        display_label = stringify(display_label)
        model_key = stringify(model_key)
        group_label = stringify(group_label)
        if not display_label or model_key not in pert_map:
            continue
        if not group_has_control_pool.get(group_label, False):
            continue
        eligible_indices_by_display[display_label].append(idx)

    selection_notes: list[dict[str, Any]] = []
    selected_labels: list[str] = []
    if control_display_label in eligible_indices_by_display:
        selected_labels.append(control_display_label)
        selection_notes.append(
            {
                "display_label": control_display_label,
                "eligible_pooled_cell_count": int(len(eligible_indices_by_display[control_display_label])),
                "selection_reason": "control-label",
            }
        )

    non_control_ranked = sorted(
        [
            (label, len(indices))
            for label, indices in eligible_indices_by_display.items()
            if label != control_display_label and len(indices) >= min_cells_required
        ],
        key=lambda item: (-item[1], item[0]),
    )
    for label, pooled_count in non_control_ranked[:max_non_control_labels]:
        selected_labels.append(label)
        selection_notes.append(
            {
                "display_label": label,
                "eligible_pooled_cell_count": int(pooled_count),
                "selection_reason": "top-pooled-count",
            }
        )

    selected_rows_by_label: dict[str, np.ndarray] = {}
    for label in selected_labels:
        selected_rows_by_label[label] = np.asarray(
            eligible_indices_by_display[label][:cap_per_label],
            dtype=np.int64,
        )
    for note in selection_notes:
        label = note["display_label"]
        note["selected_cell_count"] = int(len(selected_rows_by_label.get(label, [])))

    for label, indices in eligible_indices_by_display.items():
        if label in selected_rows_by_label:
            continue
        selection_notes.append(
            {
                "display_label": label,
                "eligible_pooled_cell_count": int(len(indices)),
                "selected_cell_count": 0,
                "selection_reason": (
                    "below-min-cells"
                    if label != control_display_label and len(indices) < min_cells_required
                    else "beyond-top-k"
                ),
            }
        )

    return selected_labels, selected_rows_by_label, selection_notes


def resolve_hook_path(args: argparse.Namespace, model: Any, model_dir: Path) -> str:
    if args.hook_path:
        return args.hook_path
    if args.module_json and args.module_json.exists():
        payload = read_json(args.module_json)
        payload_model_dir = payload.get("model_dir")
        hook_target = payload.get("hook_target", {})
        selected = hook_target.get("selected_block_path")
        if payload_model_dir == str(model_dir) and isinstance(selected, str) and selected:
            return selected
    return resolve_transformer_block(model)["selected_block_path"]


def call_prepare_batch(prepare_batch_fn: Any, *, ctrl_basal_np: np.ndarray, pert_onehots: np.ndarray, batch_indices: np.ndarray | None, pert_names: list[str], device: str) -> dict[str, Any]:
    signature = inspect.signature(prepare_batch_fn)
    parameter_names = list(signature.parameters)
    expected_names = ["ctrl_basal_np", "pert_onehots", "batch_indices", "pert_names", "device"]
    if all(name in signature.parameters for name in expected_names):
        return prepare_batch_fn(
            ctrl_basal_np=ctrl_basal_np,
            pert_onehots=pert_onehots,
            batch_indices=batch_indices,
            pert_names=pert_names,
            device=device,
        )
    if len(parameter_names) == 5:
        return prepare_batch_fn(ctrl_basal_np, pert_onehots, batch_indices, pert_names, device)
    raise AnalysisError(
        "prepare_batch signature is not compatible with the canonical extraction script.\n"
        f"Observed signature: {signature}"
    )


def choose_device(requested: str) -> str:
    import torch

    def cuda_usable() -> bool:
        if not torch.cuda.is_available():
            return False
        try:
            _ = torch.cuda.current_device()
            return True
        except Exception:
            return False

    if requested == "auto":
        return "cuda" if cuda_usable() else "cpu"
    if requested == "cuda" and not cuda_usable():
        raise AnalysisError(
            "Requested --device cuda, but CUDA is not usable on this host. "
            "Check the installed torch build versus the NVIDIA driver, or rerun with --device cpu."
        )
    return requested


def main() -> None:
    args = parse_args()
    output_dir = ensure_dir(args.output_dir.resolve())
    adata_path = args.adata_path.resolve()
    model_dir = args.model_dir.resolve()
    explicit_mapping = load_mapping_payload(args.pert_name_map.resolve() if args.pert_name_map else None)

    print_header("inputs")
    print_kv("adata_path", adata_path)
    print_kv("model_dir", model_dir)
    print_kv("output_dir", output_dir)

    adata = ad.read_h5ad(adata_path)
    if not adata.obs_names.is_unique:
        raise AnalysisError(
            "AnnData obs_names are not unique. Exact row-order preservation requires unique obs_names."
        )

    print_header("adata")
    print_kv("shape", adata.shape)
    print_kv("obs_names[:5]", adata.obs_names[:5].tolist())

    config_path, config = load_config(model_dir)
    checkpoint = resolve_checkpoint_path(model_dir, args.checkpoint_name)

    import torch

    model = load_state_model(checkpoint.checkpoint_path, config_path)
    model.eval()

    pert_map = load_perturbation_map(model_dir)
    _, batch_map = load_optional_map(model_dir, "batch_onehot_map")

    display_override = args.display_pert_col or (explicit_mapping.get("display_column") if explicit_mapping else None)
    model_override = args.model_pert_col or (explicit_mapping.get("model_column") if explicit_mapping else None)

    display_col = require_unique_obs_column(
        adata,
        display_override,
        DISPLAY_PERTURBATION_CANDIDATES,
        purpose="display perturbation",
    )
    model_col = require_unique_obs_column(
        adata,
        model_override,
        MODEL_PERTURBATION_CANDIDATES,
        purpose="model perturbation",
        allow_missing=True,
    )
    batch_col = require_unique_obs_column(
        adata,
        args.batch_col,
        BATCH_CANDIDATES,
        purpose="batch",
        allow_missing=True,
    )
    cell_type_col = require_unique_obs_column(
        adata,
        args.cell_type_col,
        CELL_TYPE_CANDIDATES,
        purpose="cell type",
        allow_missing=True,
    )

    display_preview = unique_non_empty([stringify(value) for value in adata.obs[display_col].tolist()])
    print_kv(f"{display_col}[:5-unique]", preview_list(display_preview, 5))
    print_kv("pert_onehot_keys[:5]", preview_list(sorted(pert_map), 5))

    if model_col is not None:
        model_preview = unique_non_empty([stringify(value) for value in adata.obs[model_col].tolist()])
        print_kv(f"{model_col}[:5-unique]", preview_list(model_preview, 5))

    control_label = resolve_control_label(
        np.asarray([stringify(value) for value in adata.obs[display_col].tolist()], dtype=object),
        args.control_label or (explicit_mapping.get("control_display_label") if explicit_mapping else None),
        config,
        model,
    )
    print_kv("control_display_label", control_label)
    control_model_key = resolve_control_model_key(
        pert_map=pert_map,
        explicit_mapping=explicit_mapping,
        control_display_label=control_label,
        config=config,
        model=model,
    )
    print_kv("control_model_key", control_model_key)

    row_display_labels, row_model_keys, mapping_mode, resolved_model_col = resolve_perturbation_rows(
        adata=adata,
        display_col=display_col,
        model_col=model_col,
        control_display_label=control_label,
        pert_map=pert_map,
        explicit_mapping=explicit_mapping,
        output_dir=output_dir,
    )
    row_model_keys = apply_control_model_key(
        row_display_labels,
        row_model_keys,
        control_display_label=control_label,
        control_model_key=control_model_key,
    )
    print_kv("mapping_mode", mapping_mode)
    print_kv("resolved_model_column", resolved_model_col or "display column / direct")

    control_mask = row_display_labels == control_label
    if not np.any(control_mask):
        raise AnalysisError("No control rows were identified after perturbation resolution.")
    print_kv("control_pool_size", int(control_mask.sum()))

    batch_indices_all, resolved_batch_col = resolve_batch_indices(adata, batch_col, batch_map)
    if resolved_batch_col:
        print_kv("batch_column", resolved_batch_col)
    model_uses_batch = hasattr(model, "batch_encoder") and getattr(model, "batch_encoder") is not None
    if model_uses_batch and resolved_batch_col is None:
        print_kv(
            "batch_column_warning",
            "Checkpoint exposes a batch encoder, but no batch column resolved; continuing without batch indices.",
        )

    cell_type_values = (
        np.asarray([stringify(value) for value in adata.obs[cell_type_col].tolist()], dtype=object)
        if cell_type_col
        else np.asarray(["__ALL__"] * adata.n_obs, dtype=object)
    )
    if cell_type_col:
        print_kv("cell_type_column", cell_type_col)

    model_input_dim = infer_model_input_dim(model)
    embed_key = resolve_embed_key(args, config, model)
    matrix_source, basal_matrix = resolve_matrix_source(adata, embed_key, model_input_dim=model_input_dim)
    if model_input_dim is not None and basal_matrix.shape[1] != model_input_dim:
        raise AnalysisError(
            f"Selected embedding source '{matrix_source}' has shape {basal_matrix.shape}, "
            f"but model basal_encoder expects input_dim={model_input_dim}. "
            "This usually means the chosen AnnData file is not yet in the input space expected by the checkpoint."
        )
    print_kv("matrix_source", matrix_source)
    print_kv("matrix_shape", basal_matrix.shape)

    cell_sentence_len, cell_sentence_len_source = resolve_cell_sentence_len(model, config)
    min_cells_required = max(30, cell_sentence_len // 4)
    max_non_control_labels = 19 if args.limit_perturbations is None else min(19, args.limit_perturbations)
    print_kv("cell_sentence_len", cell_sentence_len)
    print_kv("cell_sentence_len_source", cell_sentence_len_source)
    print_kv("min_cells_required", min_cells_required)
    print_kv("max_non_control_labels", max_non_control_labels)

    device = choose_device(args.device)
    model.to(device)
    print_kv("device", device)

    forward_supports_padded, forward_signature = supports_padded_forward(model)
    prepare_batch_signature = prepare_batch_like_infer_signature()
    print_kv("forward_signature", forward_signature)
    print_kv("prepare_batch_signature", prepare_batch_signature)

    hook_path = resolve_hook_path(args, model, model_dir)
    hook_module = get_module_by_name(model, hook_path)
    print_kv("hook_path", hook_path)

    rng = np.random.default_rng(args.seed)

    hook_state: dict[str, Any] = {"tensor": None}

    def hook_fn(_module: Any, _inputs: tuple[Any, ...], output: Any) -> None:
        tensor = output
        if hasattr(output, "last_hidden_state"):
            tensor = output.last_hidden_state
        elif isinstance(output, (tuple, list)) and output:
            tensor = output[0]
            if hasattr(tensor, "last_hidden_state"):
                tensor = tensor.last_hidden_state
        hook_state["tensor"] = tensor.detach().cpu() if hasattr(tensor, "detach") else tensor

    handle = hook_module.register_forward_hook(hook_fn)

    activation_payloads: list[tuple[int, np.ndarray, dict[str, Any]]] = []
    skipped_perturbations: list[dict[str, Any]] = []
    token_feature_fallback_windows = 0
    first_batch_logged = False
    window_id = 0

    try:
        group_to_indices: dict[str, list[int]] = defaultdict(list)
        for row_index, group_value in enumerate(cell_type_values.tolist()):
            group_to_indices[group_value].append(row_index)

        group_control_indices_by_label: dict[str, np.ndarray] = {}
        group_has_control_pool: dict[str, bool] = {}
        for group_label in sorted(group_to_indices):
            group_indices = np.asarray(group_to_indices[group_label], dtype=np.int64)
            group_control_indices = group_indices[control_mask[group_indices]]
            group_control_indices_by_label[group_label] = group_control_indices
            group_has_control_pool[group_label] = len(group_control_indices) > 0
            if len(group_control_indices) == 0:
                skipped_perturbations.append(
                    {
                        "group": group_label,
                        "model_perturbation": "",
                        "display_perturbation": "",
                        "n_cells": int(len(group_indices)),
                        "reason": "no-control-pool-for-group",
                    }
                )

        selected_display_labels, selected_rows_by_label, selection_notes = select_display_label_rows(
            row_display_labels=row_display_labels,
            row_model_keys=row_model_keys,
            group_labels=cell_type_values,
            group_has_control_pool=group_has_control_pool,
            pert_map=pert_map,
            control_display_label=control_label,
            min_cells_required=min_cells_required,
            max_non_control_labels=max_non_control_labels,
            cap_per_label=256,
        )
        print_kv("selected_display_labels", selected_display_labels)

        for selection_note in selection_notes:
            if selection_note["selection_reason"] not in {"control-label", "top-pooled-count"}:
                skipped_perturbations.append(
                    {
                        "group": "__GLOBAL__",
                        "model_perturbation": "",
                        "display_perturbation": selection_note["display_label"],
                        "n_cells": int(selection_note["eligible_pooled_cell_count"]),
                        "reason": selection_note["selection_reason"],
                    }
                )

        selected_target_order: list[int] = []
        for display_label in selected_display_labels:
            selected_target_order.extend(selected_rows_by_label[display_label].tolist())
        export_order_lookup = {target_idx: order for order, target_idx in enumerate(selected_target_order)}

        for display_label in selected_display_labels:
            selected_indices = selected_rows_by_label[display_label]
            if len(selected_indices) == 0:
                continue

            display_group_labels = [stringify(label) for label in cell_type_values[selected_indices].tolist()]
            unique_group_labels = []
            for label in display_group_labels:
                if label not in unique_group_labels:
                    unique_group_labels.append(label)

            for group_label in unique_group_labels:
                group_mask = cell_type_values[selected_indices] == group_label
                display_group_indices = selected_indices[group_mask]
                group_control_indices = group_control_indices_by_label[group_label]
                if len(group_control_indices) == 0:
                    continue

                ordered_model_keys = []
                for model_key in row_model_keys[display_group_indices].tolist():
                    model_key = stringify(model_key)
                    if model_key not in ordered_model_keys:
                        ordered_model_keys.append(model_key)

                for model_key in ordered_model_keys:
                    target_indices = display_group_indices[row_model_keys[display_group_indices] == model_key]
                    if len(target_indices) == 0:
                        continue

                    per_key_windows = 0
                    for start in range(0, len(target_indices), cell_sentence_len):
                        if args.max_windows_per_perturbation is not None and per_key_windows >= args.max_windows_per_perturbation:
                            break

                        idx_window = target_indices[start : start + cell_sentence_len]
                        if len(idx_window) == 0:
                            continue

                        sampled_ctrl_idx = rng.choice(group_control_indices, size=len(idx_window), replace=True)
                        ctrl_basal_np = basal_matrix[sampled_ctrl_idx].astype(np.float32, copy=False)
                        pert_onehots = build_pert_rows(model_key, pert_map, len(idx_window))
                        batch_window = batch_indices_all[idx_window] if batch_indices_all is not None else None
                        pert_names = [model_key] * len(idx_window)

                        batch = call_prepare_batch(
                            prepare_batch_like_infer,
                            ctrl_basal_np=ctrl_basal_np,
                            pert_onehots=pert_onehots,
                            batch_indices=batch_window,
                            pert_names=pert_names,
                            device=device,
                        )

                        hook_state["tensor"] = None
                        with torch.no_grad():
                            if forward_supports_padded:
                                _ = model.forward(batch, padded=False)
                            else:
                                _ = model.forward(batch)

                        captured = hook_state["tensor"]
                        if captured is None:
                            raise AnalysisError(f"Hook at '{hook_path}' did not capture any tensor output.")
                        if captured.ndim != 3:
                            raise AnalysisError(
                                f"Hook at '{hook_path}' returned tensor with ndim={captured.ndim}; expected 3."
                            )
                        if not first_batch_logged:
                            print_kv("first_hook_shape", tuple(captured.shape))
                            first_batch_logged = True
                        if captured.shape[0] != 1:
                            raise AnalysisError(
                                f"Expected B=1 from canonical windowing, but hook returned shape {tuple(captured.shape)}."
                            )

                        expected_rows = len(idx_window)
                        selected_tensor = captured
                        if captured.shape[1] != expected_rows:
                            token_cache = getattr(model, "_token_features", None)
                            if token_cache is not None:
                                token_cache = token_cache.detach().cpu()
                                if token_cache.ndim == 3 and token_cache.shape[0] == 1 and token_cache.shape[1] == expected_rows:
                                    selected_tensor = token_cache
                                    token_feature_fallback_windows += 1
                                else:
                                    raise AnalysisError(
                                        f"Hook output sequence length {captured.shape[1]} did not match expected rows {expected_rows}, "
                                        f"and _token_features shape {tuple(token_cache.shape)} could not rescue it."
                                    )
                            else:
                                raise AnalysisError(
                                    f"Hook output sequence length {captured.shape[1]} did not match expected rows {expected_rows}, "
                                    "and _token_features is unavailable."
                                )

                        flat_activations = selected_tensor.reshape(-1, selected_tensor.shape[-1]).numpy()
                        if flat_activations.shape[0] != expected_rows:
                            raise AnalysisError(
                                f"Flattened activations row count {flat_activations.shape[0]} did not match expected rows {expected_rows}."
                            )

                        target_obs_names = adata.obs_names[idx_window].tolist()
                        control_obs_names = adata.obs_names[sampled_ctrl_idx].tolist()
                        for row_offset, (control_idx, target_idx) in enumerate(
                            zip(sampled_ctrl_idx.tolist(), idx_window.tolist(), strict=True)
                        ):
                            activation_payloads.append(
                                (
                                    int(target_idx),
                                    np.asarray(flat_activations[row_offset]).copy(),
                                    {
                                        "obs_name": stringify(target_obs_names[row_offset]),
                                        "perturbation": display_label,
                                        "model_perturbation": model_key,
                                        "window_id": window_id,
                                        "source_index": int(target_idx),
                                        "control_obs_name": stringify(control_obs_names[row_offset]),
                                        "control_index": int(control_idx),
                                        "cell_type": None if cell_type_col is None else stringify(adata.obs.iloc[target_idx][cell_type_col]),
                                        "batch": None if resolved_batch_col is None else stringify(adata.obs.iloc[target_idx][resolved_batch_col]),
                                    },
                                )
                            )

                        window_id += 1
                        per_key_windows += 1
    finally:
        handle.remove()

    if not activation_payloads:
        raise AnalysisError("No activations were exported. Check perturbation mapping, control pool, and min-cells threshold.")

    if len(activation_payloads) != len(export_order_lookup):
        raise AnalysisError(
            f"Expected exactly one activation row per selected target row, but got payloads={len(activation_payloads)} "
            f"and selected_targets={len(export_order_lookup)}."
        )

    activation_payloads.sort(key=lambda item: export_order_lookup[item[0]])
    activations_array = np.stack([payload[1] for payload in activation_payloads], axis=0)
    activation_rows = [payload[2] for payload in activation_payloads]
    if activations_array.shape[0] != len(activation_rows):
        raise AnalysisError(
            f"Row-order preservation failed: activations rows={activations_array.shape[0]} "
            f"but activation_cells rows={len(activation_rows)}"
        )

    activations_path = output_dir / "activations_layer4.npy"
    activation_rows_path = output_dir / "activation_cells.jsonl"
    metadata_path = output_dir / "06_extraction_manifest.json"

    np.save(activations_path, activations_array)
    write_jsonl(activation_rows_path, activation_rows)
    write_json(
        metadata_path,
        {
            "adata_path": str(adata_path),
            "model_dir": str(model_dir),
            "config_path": str(config_path),
            "checkpoint_path": str(checkpoint.checkpoint_path),
            "matrix_source": matrix_source,
            "matrix_shape": list(basal_matrix.shape),
            "display_perturbation_column": display_col,
            "model_perturbation_column": resolved_model_col,
            "batch_column": resolved_batch_col,
            "cell_type_column": cell_type_col,
            "control_display_label": control_label,
            "control_model_key": control_model_key,
            "mapping_mode": mapping_mode,
            "hook_path": hook_path,
            "forward_signature": forward_signature,
            "prepare_batch_signature": prepare_batch_signature,
            "cell_sentence_len": cell_sentence_len,
            "min_cells_required": min_cells_required,
            "selected_display_labels": selected_display_labels,
            "selection_notes": selection_notes,
            "device": device,
            "exported_rows": int(activations_array.shape[0]),
            "exported_windows": int(window_id),
            "token_feature_fallback_windows": int(token_feature_fallback_windows),
            "skipped_perturbations": skipped_perturbations,
            "obs_name_role": "target_perturbed_row",
        },
    )

    print_header("outputs")
    print_kv("activations_path", activations_path)
    print_kv("activation_rows_path", activation_rows_path)
    print_kv("metadata_path", metadata_path)
    print_kv("activations_shape", tuple(activations_array.shape))
    print_kv("exported_windows", window_id)
    print_kv("token_feature_fallback_windows", token_feature_fallback_windows)


if __name__ == "__main__":
    main()
