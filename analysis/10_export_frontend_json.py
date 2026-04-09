from __future__ import annotations

import argparse
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import umap

from analysis_helpers import (
    build_audit_summary,
    feature_id_from_rank,
    make_canonical_overlap,
    read_json,
    read_jsonl,
    repo_root,
    validate_method_payload,
    write_json,
)


def parse_args() -> argparse.Namespace:
    root = repo_root()
    artifacts = root / "artifacts"

    parser = argparse.ArgumentParser(description="Export frontend JSON files from post-extraction artifacts")
    parser.add_argument("--activations-path", type=Path, default=artifacts / "activations_layer4.npy")
    parser.add_argument("--activation-cells-path", type=Path, default=artifacts / "activation_cells.jsonl")
    parser.add_argument("--feature-acts-path", type=Path, default=artifacts / "feature_acts.npy")
    parser.add_argument("--feature-assoc-path", type=Path, default=artifacts / "feature_gene_assoc.json")
    parser.add_argument("--feature-metrics-path", type=Path, default=artifacts / "feature_metrics.json")
    parser.add_argument("--pathway-results-path", type=Path, default=artifacts / "pathway_results.json")
    parser.add_argument("--sae-checkpoint-path", type=Path, default=artifacts / "sae_layer4.pt")
    parser.add_argument("--selection-path", type=Path, default=artifacts / "sae_selection.json")
    parser.add_argument("--pipeline-complete-path", type=Path, default=artifacts / "pipeline_complete.json")
    parser.add_argument("--method-path", type=Path, default=root / "method.json")
    parser.add_argument(
        "--preregistered-review-path",
        type=Path,
        default=root / "analysis" / "preregistered_review.md",
    )
    parser.add_argument("--export-dir", type=Path, default=root / "exported_data")
    parser.add_argument("--dataset-label", type=str, default="Replogle K562 Essential Perturb-seq")
    parser.add_argument("--dataset-doi", type=str, default="10.1016/j.cell.2022.05.013")
    parser.add_argument("--model-label", type=str, default="ST-HVG-Replogle")
    parser.add_argument("--model-run-label", type=str, default="ST-HVG-Replogle/fewshot/k562")
    parser.add_argument("--model-url", type=str, default="https://huggingface.co/arcinstitute/models")
    parser.add_argument("--layer", type=int, default=4)
    parser.add_argument("--default-theme", type=str, default="light", choices=("light", "dark"))
    parser.add_argument("--umap-neighbors", type=int, default=15)
    parser.add_argument("--umap-min-dist", type=float, default=0.1)
    parser.add_argument("--umap-metric", type=str, default="cosine")
    parser.add_argument("--umap-random-state", type=int, default=42)
    parser.add_argument("--top-positive-display", type=int, default=7)
    parser.add_argument("--top-negative-display", type=int, default=3)
    parser.add_argument("--top-pathways-display", type=int, default=5)
    parser.add_argument("--top-perturbations-display", type=int, default=5)
    parser.add_argument("--max-live-features", type=int, default=50)
    return parser.parse_args()


def load_sae_config(checkpoint_path: Path, selection_path: Path) -> dict[str, Any]:
    selection_payload: dict[str, Any] | None = None
    if selection_path.exists():
        selection_payload = read_json(selection_path)

    if checkpoint_path.exists():
        checkpoint = torch.load(checkpoint_path, map_location="cpu")
        config = checkpoint.get("config", {})
        architecture = str(config.get("architecture", "BatchTopK"))
        expansion_factor = config.get("expansionFactor")
        k = config.get("k")
        if selection_payload:
            architecture = str(selection_payload.get("architecture", architecture))
            expansion_factor = selection_payload.get("expansionFactor", expansion_factor)
            k = selection_payload.get("k", k)
        return {
            "architecture": architecture,
            "expansionFactor": expansion_factor,
            "k": k,
        }

    if selection_payload:
        architecture = str(selection_payload.get("architecture", "TopK"))
        expansion_factor = selection_payload.get("expansionFactor")
        k = selection_payload.get("k")
        if architecture.lower() == "pca":
            expansion_factor = expansion_factor or 1
            k = k or 1
        return {
            "architecture": architecture,
            "expansionFactor": expansion_factor,
            "k": k,
        }

    return {"architecture": "TopK", "expansionFactor": 1, "k": 1}


def build_gene_association_list(
    assoc_payload: dict[str, Any],
    top_positive_display: int,
    top_negative_display: int,
) -> list[dict[str, Any]]:
    positive = assoc_payload.get("positive", [])[:top_positive_display]
    negative = assoc_payload.get("negative", [])[:top_negative_display]
    return [
        {"gene": str(entry["gene"]), "weight": float(entry["weight"])}
        for entry in [*positive, *negative]
    ]


def main() -> None:
    args = parse_args()

    # This script assigns display-facing feature IDs exactly once from latent_idx-ranked
    # intermediates. The SAE has already been applied offline to exported activations.
    activations = np.load(args.activations_path)
    feature_acts = np.load(args.feature_acts_path)
    cells_meta = read_jsonl(args.activation_cells_path)
    feature_assoc = read_json(args.feature_assoc_path)
    feature_metrics = read_json(args.feature_metrics_path)
    pathway_results = read_json(args.pathway_results_path)

    if activations.ndim != 2:
        raise ValueError(f"Expected 2D activations array, got shape {activations.shape}")
    if feature_acts.ndim != 2:
        raise ValueError(f"Expected 2D feature acts array, got shape {feature_acts.shape}")
    if activations.shape[0] != feature_acts.shape[0]:
        raise ValueError(
            f"Row mismatch between activations ({activations.shape[0]}) and feature acts ({feature_acts.shape[0]})"
        )
    if activations.shape[0] != len(cells_meta):
        raise ValueError(
            "Row mismatch between activations and activation_cells.jsonl "
            f"({activations.shape[0]} vs {len(cells_meta)})"
        )

    method_payload = validate_method_payload(read_json(args.method_path))
    if not args.preregistered_review_path.exists():
        raise FileNotFoundError(
            f"Missing preregistered review note at {args.preregistered_review_path}"
        )
    if not args.preregistered_review_path.read_text(encoding="utf-8").strip():
        raise ValueError(
            f"Preregistered review note is empty at {args.preregistered_review_path}"
        )
    sae_config = load_sae_config(args.sae_checkpoint_path, args.selection_path)

    metrics_map: dict[str, Any] = feature_metrics["features"]
    assoc_map: dict[str, Any] = feature_assoc["features"]
    pathway_map: dict[str, Any] = pathway_results["features"]

    live_mask = feature_acts.max(axis=0) > 0.0
    live_latent_indices = np.flatnonzero(live_mask).tolist()

    for latent_key, payload in metrics_map.items():
        latent_idx = int(latent_key)
        if latent_idx < 0 or latent_idx >= feature_acts.shape[1]:
            raise ValueError(f"latent_idx {latent_idx} is outside feature_acts column range")

        activation_max = float(feature_acts[:, latent_idx].max())
        metrics_activation_max = float(payload["activationMax"])
        if not np.isclose(activation_max, metrics_activation_max, atol=1e-6):
            raise ValueError(
                "feature_metrics activationMax does not match current feature_acts "
                f"for latent_idx {latent_idx}: {metrics_activation_max} vs {activation_max}"
            )

    if not live_latent_indices:
        raise ValueError("No live features found. Live feature definition requires activationMax > 0.0")

    missing_live_metrics = [idx for idx in live_latent_indices if str(idx) not in metrics_map]
    if missing_live_metrics:
        raise ValueError(
            "Missing feature_metrics entries for live latent indices: "
            f"{missing_live_metrics[:20]}"
        )

    ranked_latent_indices = sorted(
        live_latent_indices,
        key=lambda latent_idx: (
            -float(metrics_map[str(latent_idx)]["attribution"]),
            int(latent_idx),
        ),
    )[: args.max_live_features]

    feature_id_map = {
        latent_idx: feature_id_from_rank(rank)
        for rank, latent_idx in enumerate(ranked_latent_indices)
    }

    reducer = umap.UMAP(
        n_neighbors=args.umap_neighbors,
        min_dist=args.umap_min_dist,
        metric=args.umap_metric,
        random_state=args.umap_random_state,
    )
    embedding = reducer.fit_transform(activations)

    cells = []
    for row, coords in zip(cells_meta, embedding, strict=True):
        cells.append(
            {
                "x": float(coords[0]),
                "y": float(coords[1]),
                "perturbation": str(row["perturbation"]),
            }
        )

    perturbations = list(feature_metrics["metadata"]["perturbations"])
    features_payload: list[dict[str, Any]] = []
    embedding_feature_acts: dict[str, list[float]] = {}
    activation_ranges: dict[str, list[float]] = {}
    ordered_feature_ids: list[str] = []

    significant_pathway_feature_count = 0

    for display_rank, latent_idx in enumerate(ranked_latent_indices):
        latent_key = str(latent_idx)
        feature_id = feature_id_map[latent_idx]
        metrics = metrics_map[latent_key]
        assoc_payload = assoc_map.get(
            latent_key,
            {"mode": "none", "positive": [], "negative": []},
        )
        pathways = pathway_map.get(latent_key, [])

        top_pathways = sorted(
            pathways,
            key=lambda payload: (float(payload["adjP"]), float(payload["pValue"]), payload["term"]),
        )[: args.top_pathways_display]
        if any(float(payload["adjP"]) < 0.05 for payload in top_pathways):
            significant_pathway_feature_count += 1

        perturbation_means = {
            str(label): float(value)
            for label, value in metrics["perturbationMeanActivations"].items()
        }
        top_perturbations = sorted(
            perturbation_means.items(),
            key=lambda item: (-float(item[1]), item[0]),
        )[: args.top_perturbations_display]

        positive_genes = [entry["gene"] for entry in assoc_payload.get("positive", [])]
        canonical_overlap = make_canonical_overlap(positive_genes)

        ordered_feature_ids.append(feature_id)
        features_payload.append(
            {
                "id": feature_id,
                "rank": display_rank + 1,
                "status": str(metrics["status"]),
                "attribution": float(metrics["attribution"]),
                "l0": float(metrics["l0"]),
                "activeCells": int(metrics["activeCells"]),
                "shortcutR2": (
                    None if metrics["shortcutR2"] is None else float(metrics["shortcutR2"])
                ),
                "shortcutProbeDescription": str(metrics["shortcutProbeDescription"]),
                "auditSummary": build_audit_summary(
                    str(metrics["status"]),
                    None if metrics["shortcutR2"] is None else float(metrics["shortcutR2"]),
                    str(metrics["shortcutProbeDescription"]),
                ),
                "geneAssociationMode": str(assoc_payload.get("mode", "none")),
                "geneAssociations": build_gene_association_list(
                    assoc_payload,
                    top_positive_display=args.top_positive_display,
                    top_negative_display=args.top_negative_display,
                ),
                "pathways": [
                    {
                        "term": str(pathway["term"]),
                        "database": str(pathway["database"]),
                        "adjP": float(pathway["adjP"]),
                        "pValue": float(pathway["pValue"]),
                        "overlapGenes": [str(gene) for gene in pathway["overlapGenes"]],
                    }
                    for pathway in top_pathways
                ],
                "canonicalOverlap": canonical_overlap,
                "topPerturbations": [
                    {
                        "perturbation": perturbation,
                        "meanActivation": float(mean_activation),
                    }
                    for perturbation, mean_activation in top_perturbations
                ],
                "perturbationMeanActivations": perturbation_means,
            }
        )

        ordered_feature_acts = feature_acts[:, latent_idx].astype(np.float32, copy=False)
        if ordered_feature_acts.shape[0] != len(cells):
            raise ValueError(
                f"Feature activations for {feature_id} do not match cell count "
                f"({ordered_feature_acts.shape[0]} vs {len(cells)})"
            )

        embedding_feature_acts[feature_id] = [float(value) for value in ordered_feature_acts.tolist()]
        activation_ranges[feature_id] = [
            float(ordered_feature_acts.min()),
            float(ordered_feature_acts.max()),
        ]

    feature_payload_by_id = {feature["id"]: feature for feature in features_payload}
    matrix_rows = []
    for perturbation in perturbations:
        raw_values = [
            float(feature_payload_by_id[feature_id]["perturbationMeanActivations"].get(perturbation, 0.0))
            for feature_id in ordered_feature_ids
        ]
        matrix_rows.append(raw_values)

    matrix_array = np.asarray(matrix_rows, dtype=np.float32)
    if matrix_array.size == 0:
        raise ValueError("Matrix export requires at least one perturbation and one live feature")

    column_max = matrix_array.max(axis=0)
    column_max[column_max == 0.0] = 1.0
    normalized_matrix = matrix_array / column_max

    default_feature = features_payload[0]
    default_perturbation = (
        default_feature["topPerturbations"][0]["perturbation"]
        if default_feature["topPerturbations"]
        else perturbations[0]
    )

    manifest_payload = {
        "datasetLabel": args.dataset_label,
        "datasetDoi": args.dataset_doi,
        "modelLabel": args.model_label,
        "modelRunLabel": args.model_run_label,
        "modelUrl": args.model_url,
        "saeConfig": {
            "architecture": sae_config["architecture"],
            "expansionFactor": sae_config["expansionFactor"],
            "k": sae_config["k"],
            "layer": args.layer,
        },
        "nLiveFeatures": len(features_payload),
        "shortcutProbe": str(feature_metrics["metadata"]["shortcutProbeDescription"]),
        "canonicalSignatures": ["MYC targets", "BCR-ABL effectors"],
        "availableLayers": [args.layer],
        "defaultLayer": args.layer,
        "defaultFeatureId": default_feature["id"],
        "defaultPerturbation": default_perturbation,
        "defaultTheme": args.default_theme,
        "filePaths": {
            "features": "data/features.json",
            "embedding": "data/embedding.json",
            "matrix": "data/matrix.json",
            "method": "data/method.json",
        },
    }

    embedding_payload = {
        "cells": cells,
        "featureActivations": embedding_feature_acts,
        "activationRanges": activation_ranges,
        "caveat": (
            "Set-conditioned embeddings: each exported cell representation may reflect context "
            "from other cells in the same extracted STATE activation window."
        ),
    }

    for feature_id in ordered_feature_ids:
        if len(embedding_feature_acts[feature_id]) != len(cells):
            raise ValueError(
                f"Feature activations for {feature_id} do not match exported cell count "
                f"({len(embedding_feature_acts[feature_id])} vs {len(cells)})"
            )

    cell_perturbations = set(cell["perturbation"] for cell in cells)
    for feature_payload in features_payload:
        pma_keys = set(feature_payload["perturbationMeanActivations"].keys())
        missing = cell_perturbations - pma_keys
        extra = pma_keys - cell_perturbations
        if missing or extra:
            raise ValueError(
                "Perturbation label mismatch - "
                f"in cells but not PMA: {sorted(missing)}; "
                f"in PMA but not cells: {sorted(extra)}"
            )

    matrix_payload = {
        "perturbations": perturbations,
        "featureIds": ordered_feature_ids,
        "values": normalized_matrix.astype(np.float32).tolist(),
        "normalization": "per-feature max",
    }
    pipeline_complete_payload = {
        "complete": True,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "exportedCellCount": len(cells),
        "exportedPerturbationCount": len(perturbations),
        "exportedFeatureCount": len(features_payload),
        "defaultFeatureId": manifest_payload["defaultFeatureId"],
        "rank1TopGenes": [str(entry["gene"]) for entry in default_feature["geneAssociations"][:3]],
        "shortcutFeatureCount": sum(feature["status"] == "shortcut" for feature in features_payload),
        "pathwayHitCountAdjPBelow005": significant_pathway_feature_count,
        "canonicalOverlapCount": sum(1 for feature in features_payload if feature["canonicalOverlap"]),
        "architecture": str(sae_config["architecture"]),
        "paths": {
            "manifest": "manifest.json",
            "features": "features.json",
            "embedding": "embedding.json",
            "matrix": "matrix.json",
            "method": "method.json",
        },
    }

    export_dir = args.export_dir
    export_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="data-staging-", dir=str(export_dir.parent)) as staging_dir:
        staging_path = Path(staging_dir)
        write_json(staging_path / "manifest.json", manifest_payload)
        write_json(staging_path / "features.json", features_payload)
        write_json(staging_path / "embedding.json", embedding_payload)
        write_json(staging_path / "matrix.json", matrix_payload)
        write_json(staging_path / "method.json", method_payload)

        if export_dir.exists():
            shutil.rmtree(export_dir)
        shutil.copytree(staging_path, export_dir)

    write_json(args.pipeline_complete_path, pipeline_complete_payload)

    print(f"exported cells: {len(cells)}")
    print(f"live features: {len(features_payload)}")
    print(f"defaultFeatureId: {manifest_payload['defaultFeatureId']}")
    if features_payload[0]["geneAssociations"]:
        top_genes = [entry["gene"] for entry in features_payload[0]["geneAssociations"][:3]]
        print(f"rank1 top genes: {top_genes}")
    else:
        print("rank1 top genes: []")
    shortcut_count = sum(feature["status"] == "shortcut" for feature in features_payload)
    print(f"shortcut features: {shortcut_count}")
    print(f"features with adjP < 0.05 pathway hit: {significant_pathway_feature_count}")
    print(f"exported data dir: {export_dir}")


if __name__ == "__main__":
    main()
