from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import numpy as np

try:
    from scipy import sparse
except ImportError:  # pragma: no cover - scipy is expected at runtime
    sparse = None


MYC_TARGETS = {
    "MYC",
    "CCND1",
    "E2F1",
    "CDK4",
    "CDK6",
    "MCM2",
    "MCM5",
    "PCNA",
    "RRM1",
    "RRM2",
    "BRCA1",
    "CCNA2",
    "AURKB",
    "BUB1",
    "MKI67",
}

BCR_ABL_EFFECTORS = {
    "STAT5A",
    "STAT5B",
    "CRK",
    "CRKL",
    "PTPN11",
    "PIK3R1",
    "AKT1",
    "BCL2",
    "MCL1",
    "CCND1",
    "MYC",
    "HSP90AA1",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def matrix_to_numpy(matrix: Any) -> np.ndarray:
    if sparse is not None and sparse.issparse(matrix):
        return matrix.toarray()
    return np.asarray(matrix)


def zscore_columns(array: np.ndarray) -> np.ndarray:
    mean = array.mean(axis=0, keepdims=True)
    std = array.std(axis=0, keepdims=True)
    std[std == 0] = 1.0
    return (array - mean) / std


def benjamini_hochberg(p_values: Iterable[float]) -> list[float]:
    p_list = [float(value) for value in p_values]
    if not p_list:
        return []

    order = np.argsort(np.asarray(p_list))
    ranked = np.asarray(p_list, dtype=np.float64)[order]
    adjusted = np.empty_like(ranked)
    total = float(len(ranked))
    running = 1.0

    for idx in range(len(ranked) - 1, -1, -1):
        candidate = ranked[idx] * total / float(idx + 1)
        running = min(running, candidate)
        adjusted[idx] = min(running, 1.0)

    restored = np.empty_like(adjusted)
    restored[order] = adjusted
    return restored.tolist()


def parse_gmt(path: Path) -> dict[str, set[str]]:
    gene_sets: dict[str, set[str]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            parts = line.strip().split("\t")
            if len(parts) < 3:
                continue
            name = parts[0]
            genes = {gene for gene in parts[2:] if gene}
            if genes:
                gene_sets[name] = genes
    return gene_sets


def feature_id_from_rank(rank_zero_indexed: int) -> str:
    return f"F{rank_zero_indexed:04d}"


def make_canonical_overlap(genes: Iterable[str]) -> list[dict[str, Any]]:
    overlaps: list[dict[str, Any]] = []
    seen: set[str] = set()
    myc_targets_upper = {gene.upper() for gene in MYC_TARGETS}
    bcr_abl_effectors_upper = {gene.upper() for gene in BCR_ABL_EFFECTORS}

    for gene in genes:
        gene_display = str(gene)
        gene_upper = gene_display.upper()
        if gene_upper in seen:
            continue
        signatures: list[str] = []
        if gene_upper in myc_targets_upper:
            signatures.append("myc_targets")
        if gene_upper in bcr_abl_effectors_upper:
            signatures.append("bcr_abl")
        if signatures:
            overlaps.append(
                {
                    "gene": gene_display,
                    "signatures": signatures,
                }
            )
            seen.add(gene_upper)
    return overlaps


def validate_method_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("content/method.json must contain a JSON object")

    stages = payload.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("content/method.json must contain a non-empty stages list")

    for idx, stage in enumerate(stages):
        if not isinstance(stage, dict):
            raise ValueError(f"stage {idx} must be an object")
        if "id" not in stage and "number" not in stage:
            raise ValueError(f"stage {idx} must contain either 'id' or 'number'")
        stage_id = stage.get("id", stage.get("number"))
        if not isinstance(stage_id, (str, int)) or not str(stage_id).strip():
            raise ValueError(f"stage {idx} id/number must be a non-empty string or integer")
        if not isinstance(stage["title"], str) or not stage["title"].strip():
            raise ValueError(f"stage {idx} title must be a non-empty string")
        if not isinstance(stage["body"], str) or not stage["body"].strip():
            raise ValueError(f"stage {idx} body must be a non-empty string")

    honesty_caveats = payload.get("honestyCaveats")
    if isinstance(honesty_caveats, str):
        if not honesty_caveats.strip():
            raise ValueError("content/method.json honestyCaveats string must be non-empty")
    elif isinstance(honesty_caveats, list):
        if not honesty_caveats or not all(
            isinstance(entry, str) and entry.strip() for entry in honesty_caveats
        ):
            raise ValueError("content/method.json honestyCaveats list must be non-empty")
    else:
        raise ValueError("content/method.json must contain honestyCaveats as a string or string list")

    dataset_provenance = payload.get("datasetProvenance")
    if isinstance(dataset_provenance, str):
        if not dataset_provenance.strip():
            raise ValueError("content/method.json datasetProvenance string must be non-empty")
    elif isinstance(dataset_provenance, dict):
        for key in ("datasetLabel", "datasetDoi", "modelRunLabel", "shortcutProbeDescription"):
            value = dataset_provenance.get(key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"datasetProvenance must contain non-empty '{key}'")

        sae_config = dataset_provenance.get("saeConfig")
        if not isinstance(sae_config, dict):
            raise ValueError("datasetProvenance.saeConfig must be an object")
        for key in ("layer", "architecture", "expansionFactor", "k"):
            if key not in sae_config:
                raise ValueError(f"datasetProvenance.saeConfig is missing '{key}'")
    else:
        raise ValueError("content/method.json datasetProvenance must be a string or object")

    metric_glossary = payload.get("metricGlossary")
    if metric_glossary is not None:
        if not isinstance(metric_glossary, list):
            raise ValueError("content/method.json metricGlossary must be a list when provided")
        for idx, item in enumerate(metric_glossary):
            if not isinstance(item, dict):
                raise ValueError(f"metricGlossary item {idx} must be an object")
            label = item.get("label")
            body = item.get("body")
            if not isinstance(label, str) or not label.strip():
                raise ValueError(f"metricGlossary item {idx} label must be a non-empty string")
            if not isinstance(body, str) or not body.strip():
                raise ValueError(f"metricGlossary item {idx} body must be a non-empty string")

    return payload


def build_audit_summary(status: str, shortcut_r2: float | None, probe_description: str) -> str:
    if shortcut_r2 is None:
        return f"Needs review - technical probe unavailable ({probe_description})"
    if status == "shortcut":
        return f"Shortcut detected - R² = {shortcut_r2:.3f} ({probe_description})"
    if status == "review":
        return f"Needs review - R² = {shortcut_r2:.3f} ({probe_description})"
    return f"Passes shortcut audit - R² = {shortcut_r2:.3f} ({probe_description})"
