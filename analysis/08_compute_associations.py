from __future__ import annotations

import argparse
import pickle
from pathlib import Path
from typing import Any

import anndata as ad
import numpy as np
from scipy.stats import rankdata
import torch

from analysis_helpers import (
    matrix_to_numpy,
    read_jsonl,
    write_json,
    zscore_columns,
)


LIBRARY_SIZE_VALIDATED_MAX = 0.35
LIBRARY_SIZE_SHORTCUT_MIN = 0.55
DEFAULT_VALIDATED_MAX = 0.20
DEFAULT_SHORTCUT_MIN = 0.40


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    default_artifacts = repo_root / "artifacts"
    default_var_dims = (
        repo_root / "checkpoints" / "ST-HVG-Replogle" / "fewshot" / "k562" / "var_dims.pkl"
    )

    parser = argparse.ArgumentParser(
        description="Compute feature metrics and gene associations from SAE activations"
    )
    parser.add_argument("--adata-path", type=Path, required=True)
    parser.add_argument(
        "--activation-cells-path",
        type=Path,
        default=default_artifacts / "activation_cells.jsonl",
    )
    parser.add_argument(
        "--feature-acts-path",
        type=Path,
        default=default_artifacts / "feature_acts.npy",
    )
    parser.add_argument("--var-dims-path", type=Path, default=default_var_dims)
    parser.add_argument("--gene-metadata-adata-path", type=Path, default=None)
    parser.add_argument("--layer", type=str, default=None)
    parser.add_argument("--apply-log1p", action="store_true")
    parser.add_argument("--top-positive", type=int, default=50)
    parser.add_argument("--top-negative", type=int, default=15)
    parser.add_argument("--corr-chunk-size", type=int, default=256)
    parser.add_argument("--shortcut-obs-column", type=str, default=None)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_artifacts,
    )
    return parser.parse_args()


def resolve_expression_matrix(adata: ad.AnnData, layer: str | None, apply_log1p: bool) -> np.ndarray:
    if layer is None:
        matrix = adata.X
    else:
        if layer not in adata.layers:
            raise KeyError(f"Layer '{layer}' not found in AnnData")
        matrix = adata.layers[layer]

    dense = matrix_to_numpy(matrix).astype(np.float32, copy=False)
    if apply_log1p:
        dense = np.log1p(dense)
    return dense


def resolve_metadata_gene_names(
    metadata_adata_path: Path,
    expression_dim: int,
) -> list[str] | None:
    metadata_adata = ad.read_h5ad(metadata_adata_path, backed="r")
    try:
        if "highly_variable" in metadata_adata.var.columns:
            hv_mask = metadata_adata.var["highly_variable"].to_numpy()
            if int(hv_mask.sum()) == expression_dim:
                return [str(gene).strip() for gene in metadata_adata.var_names[hv_mask].tolist()]
        metadata_var_names = [str(gene).strip() for gene in metadata_adata.var_names.tolist()]
        if len(metadata_var_names) == expression_dim:
            return metadata_var_names
        return None
    finally:
        metadata_adata.file.close() if getattr(metadata_adata, "file", None) is not None else None


def load_var_dims(path: Path) -> Any:
    load_errors: list[str] = []

    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        try:
            return torch.load(path, map_location="cpu")
        except Exception as exc:
            load_errors.append(f"torch.load fallback failed: {exc}")
    except Exception as exc:
        load_errors.append(f"torch.load failed: {exc}")

    try:
        with path.open("rb") as handle:
            return pickle.load(handle)
    except Exception as exc:
        load_errors.append(f"pickle.load failed: {exc}")

    raise RuntimeError(f"Unable to load var_dims payload at {path}: {'; '.join(load_errors)}")


def resolve_gene_names(
    adata: ad.AnnData,
    *,
    expression_dim: int,
    var_dims_path: Path | None,
    gene_metadata_adata_path: Path | None,
) -> tuple[list[str], str]:
    if var_dims_path is not None:
        var_dims = load_var_dims(var_dims_path)
        print("var_dims type:", type(var_dims).__name__)
        if isinstance(var_dims, dict):
            print("var_dims keys:", sorted(str(key) for key in var_dims.keys()))
        else:
            print("var_dims keys: not a dict")

        if not isinstance(var_dims, dict):
            raise TypeError("var_dims payload must be a dict")
        if "gene_names" not in var_dims:
            raise KeyError("var_dims payload is missing 'gene_names'")

        gene_names = [str(gene).strip() for gene in var_dims["gene_names"]]
        if len(gene_names) != expression_dim:
            raise ValueError(
                f"var_dims gene_names length {len(gene_names)} does not match expression dim {expression_dim}"
            )

        if gene_metadata_adata_path is not None:
            metadata_gene_names = resolve_metadata_gene_names(gene_metadata_adata_path, expression_dim)
            if metadata_gene_names is not None:
                if metadata_gene_names != gene_names:
                    raise ValueError(
                        "Gene metadata cross-check failed: var_dims gene_names do not match metadata AnnData ordering"
                    )
                print("gene metadata cross-check: exact match")

        return gene_names, "var_dims.gene_names"

    for candidate in ("gene_name", "gene", "symbol"):
        if candidate in adata.var.columns:
            values = [str(value).strip() for value in adata.var[candidate].tolist()]
            if any(values) and len(values) == expression_dim:
                return values, f"adata.var[{candidate}]"

    var_names = [str(gene).strip() for gene in adata.var_names.tolist()]
    if len(var_names) == expression_dim and any(name and not name.isdigit() for name in var_names):
        return var_names, "adata.var_names"

    if gene_metadata_adata_path is not None:
        metadata_gene_names = resolve_metadata_gene_names(gene_metadata_adata_path, expression_dim)
        if metadata_gene_names is not None:
            return metadata_gene_names, "metadata_adata"

    return var_names, "adata.var_names_numeric_fallback"


def resolve_library_size_probe(adata: ad.AnnData, expression_matrix: np.ndarray) -> tuple[np.ndarray, str]:
    for candidate in ("total_counts", "n_counts", "library_size"):
        if candidate in adata.obs and np.issubdtype(adata.obs[candidate].dtype, np.number):
            values = adata.obs[candidate].to_numpy(dtype=np.float32, copy=True)
            return values, candidate

    return expression_matrix.sum(axis=1).astype(np.float32, copy=False), "row_sum"


def resolve_shortcut_probe(
    adata: ad.AnnData,
    expression_matrix: np.ndarray,
    obs_column: str | None,
) -> tuple[np.ndarray | None, str, str, float, float]:
    if obs_column is not None:
        if obs_column not in adata.obs:
            raise KeyError(f"Shortcut column '{obs_column}' not found in AnnData.obs")
        if not np.issubdtype(adata.obs[obs_column].dtype, np.number):
            raise TypeError(f"Shortcut column '{obs_column}' must be numeric")
        values = adata.obs[obs_column].to_numpy(dtype=np.float32, copy=True)
        return values, obs_column, obs_column, DEFAULT_VALIDATED_MAX, DEFAULT_SHORTCUT_MIN

    values, source = resolve_library_size_probe(adata, expression_matrix)
    description = f"library_size_proxy:{source}"
    return values, "library_size_proxy", description, LIBRARY_SIZE_VALIDATED_MAX, LIBRARY_SIZE_SHORTCUT_MIN


def corrcoef_r2(feature: np.ndarray, probe: np.ndarray | None) -> float | None:
    if probe is None:
        return None
    if feature.size != probe.size:
        raise ValueError("Feature activations and shortcut probe must share row count")
    if np.allclose(feature, feature[0]) or np.allclose(probe, probe[0]):
        return 0.0
    corr = np.corrcoef(feature, probe)[0, 1]
    if np.isnan(corr):
        return 0.0
    return float(corr * corr)


def resolve_status(shortcut_r2: float | None, validated_max: float, shortcut_min: float) -> str:
    if shortcut_r2 is None:
        return "review"
    if shortcut_r2 >= shortcut_min:
        return "shortcut"
    if shortcut_r2 >= validated_max:
        return "review"
    return "validated"


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    activation_rows = read_jsonl(args.activation_cells_path)
    if not activation_rows:
        raise ValueError(f"No rows found in {args.activation_cells_path}")

    obs_names_in_order = [str(row["obs_name"]) for row in activation_rows]
    perturbations_in_order = [str(row["perturbation"]) for row in activation_rows]

    adata = ad.read_h5ad(args.adata_path)
    adata_aligned = adata[obs_names_in_order].copy()
    if adata_aligned.obs_names.tolist() != obs_names_in_order:
        raise ValueError("Exact row alignment proof failed for activation_cells.jsonl vs AnnData")

    feature_acts = np.load(args.feature_acts_path)
    if feature_acts.ndim != 2:
        raise ValueError(f"Expected 2D feature acts matrix, got shape {feature_acts.shape}")
    if feature_acts.shape[0] != len(obs_names_in_order):
        raise ValueError(
            "feature_acts.npy row count must equal activation_cells.jsonl row count "
            f"({feature_acts.shape[0]} vs {len(obs_names_in_order)})"
        )

    expression_matrix = resolve_expression_matrix(adata_aligned, args.layer, args.apply_log1p)
    if expression_matrix.shape[0] != feature_acts.shape[0]:
        raise ValueError("Expression matrix row count must match feature activations row count")

    shortcut_probe, shortcut_probe_key, shortcut_probe_description, validated_max, shortcut_min = (
        resolve_shortcut_probe(adata_aligned, expression_matrix, args.shortcut_obs_column)
    )

    gene_names, gene_name_source = resolve_gene_names(
        adata_aligned,
        expression_dim=expression_matrix.shape[1],
        var_dims_path=args.var_dims_path,
        gene_metadata_adata_path=args.gene_metadata_adata_path,
    )
    perturbation_labels = list(dict.fromkeys(perturbations_in_order))
    perturbation_masks = {
        label: np.asarray([current == label for current in perturbations_in_order], dtype=bool)
        for label in perturbation_labels
    }

    ranked_expression = rankdata(expression_matrix, axis=0, method="average").astype(np.float32)
    expression_z = zscore_columns(ranked_expression)

    feature_gene_assoc: dict[str, Any] = {
        "metadata": {
            "mode": "expression_correlation",
            "geneUniverse": gene_names,
            "geneNameSource": gene_name_source,
            "topPositive": args.top_positive,
            "topNegative": args.top_negative,
        },
        "features": {},
    }
    feature_metrics: dict[str, Any] = {
        "metadata": {
            "shortcutProbeKey": shortcut_probe_key,
            "shortcutProbeDescription": shortcut_probe_description,
            "validatedMaxR2": validated_max,
            "shortcutMinR2": shortcut_min,
            "perturbations": perturbation_labels,
            "featureActsRowOrder": (
                "Rows align exactly with activations_layer4.npy and activation_cells.jsonl"
            ),
        },
        "features": {},
    }

    for start in range(0, feature_acts.shape[1], args.corr_chunk_size):
        end = min(start + args.corr_chunk_size, feature_acts.shape[1])
        chunk = feature_acts[:, start:end].astype(np.float32, copy=False)
        ranked_chunk = rankdata(chunk, axis=0, method="average").astype(np.float32)
        chunk_z = zscore_columns(ranked_chunk)
        correlations = (chunk_z.T @ expression_z) / max(feature_acts.shape[0] - 1, 1)

        for offset, latent_idx in enumerate(range(start, end)):
            acts = chunk[:, offset]
            corr_row = correlations[offset]

            positive_idx = np.argsort(corr_row)[::-1]
            negative_idx = np.argsort(corr_row)

            positive_entries = [
                {
                    "gene": gene_names[int(gene_idx)],
                    "weight": float(corr_row[int(gene_idx)]),
                }
                for gene_idx in positive_idx
                if corr_row[int(gene_idx)] > 0
            ][: args.top_positive]

            negative_entries = [
                {
                    "gene": gene_names[int(gene_idx)],
                    "weight": float(corr_row[int(gene_idx)]),
                }
                for gene_idx in negative_idx
                if corr_row[int(gene_idx)] < 0
            ][: args.top_negative]

            shortcut_r2 = corrcoef_r2(acts, shortcut_probe)
            status = resolve_status(shortcut_r2, validated_max, shortcut_min)
            activation_max = float(acts.max())
            perturbation_means = {
                label: float(acts[mask].mean()) if mask.any() else 0.0
                for label, mask in perturbation_masks.items()
            }

            feature_gene_assoc["features"][str(latent_idx)] = {
                "latent_idx": latent_idx,
                "mode": "expression_correlation",
                "positive": positive_entries,
                "negative": negative_entries,
            }
            feature_metrics["features"][str(latent_idx)] = {
                "latent_idx": latent_idx,
                "attribution": float(acts.mean()),
                "activationMean": float(acts.mean()),
                "activationMax": activation_max,
                "l0": float((acts > 0).mean() * 100.0),
                "activeCells": int((acts > 0).sum()),
                "shortcutR2": shortcut_r2,
                "shortcutProbeDescription": shortcut_probe_description,
                "status": status,
                "perturbationMeanActivations": perturbation_means,
            }

    assoc_path = args.output_dir / "feature_gene_assoc.json"
    metrics_path = args.output_dir / "feature_metrics.json"
    write_json(assoc_path, feature_gene_assoc)
    write_json(metrics_path, feature_metrics)

    print(f"saved gene associations: {assoc_path}")
    print(f"saved feature metrics: {metrics_path}")
    print(
        "alignment verified:",
        adata_aligned.obs_names.tolist()[:3],
        "...",
        f"rows={len(obs_names_in_order)}",
    )


if __name__ == "__main__":
    main()
