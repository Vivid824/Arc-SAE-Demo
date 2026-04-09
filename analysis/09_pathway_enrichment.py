from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from scipy.stats import hypergeom

from analysis_helpers import benjamini_hochberg, parse_gmt, read_json, write_json


SMOKE_TEST_GENES = ["MYC", "CDK4", "E2F1", "TP53", "BRCA1"]


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    default_artifacts = repo_root / "artifacts"

    parser = argparse.ArgumentParser(
        description="Run local pathway enrichment against GMT files for feature-associated genes"
    )
    parser.add_argument(
        "--feature-assoc-path",
        type=Path,
        default=default_artifacts / "feature_gene_assoc.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_artifacts,
    )
    parser.add_argument(
        "--gmt",
        type=Path,
        action="append",
        default=[],
        help="Path to a local GMT file. May be passed multiple times.",
    )
    parser.add_argument("--top-positive-genes", type=int, default=50)
    parser.add_argument("--max-results-per-feature", type=int, default=20)
    parser.add_argument("--min-overlap", type=int, default=2)
    return parser.parse_args()


def database_label_from_path(path: Path) -> str:
    stem = path.stem
    if ".v" in stem:
        stem = stem.split(".v", 1)[0]
    return stem

def run_local_enrichment(
    *,
    query_genes: list[str],
    gene_universe: set[str],
    gmt_payloads: list[tuple[str, dict[str, set[str]]]],
    min_overlap: int,
    max_results_per_feature: int,
) -> list[dict[str, Any]]:
    query_set = {gene for gene in query_genes if gene in gene_universe}
    query_size = len(query_set)
    universe_size = len(gene_universe)

    if query_size == 0:
        return []

    raw_hits: list[dict[str, Any]] = []
    raw_p_values: list[float] = []

    for database, gene_sets in gmt_payloads:
        for term, genes in gene_sets.items():
            term_genes = genes & gene_universe
            term_size = len(term_genes)
            if term_size == 0:
                continue
            overlap_genes = sorted(query_set & term_genes)
            overlap_size = len(overlap_genes)
            if overlap_size < min_overlap:
                continue

            p_value = float(hypergeom.sf(overlap_size - 1, universe_size, term_size, query_size))
            raw_p_values.append(p_value)
            raw_hits.append(
                {
                    "term": term,
                    "database": database,
                    "pValue": p_value,
                    "overlapSize": overlap_size,
                    "termSize": term_size,
                    "querySize": query_size,
                    "overlapGenes": overlap_genes,
                }
            )

    if not raw_hits:
        return []

    adjusted = benjamini_hochberg(raw_p_values)
    for hit, adj_p in zip(raw_hits, adjusted, strict=True):
        hit["adjP"] = float(adj_p)

    raw_hits.sort(key=lambda hit: (hit["adjP"], hit["pValue"], -hit["overlapSize"], hit["term"]))
    return raw_hits[:max_results_per_feature]


def run_local_gmt_smoke_test(
    gmt_payloads: list[tuple[str, dict[str, set[str]]]],
) -> dict[str, Any]:
    smoke_results: list[dict[str, Any]] = []

    for database, gene_sets in gmt_payloads:
        if not gene_sets:
            raise ValueError(f"GMT '{database}' did not contain any gene sets")

        universe = set().union(*gene_sets.values())
        hits = run_local_enrichment(
            query_genes=SMOKE_TEST_GENES,
            gene_universe=universe,
            gmt_payloads=[(database, gene_sets)],
            min_overlap=1,
            max_results_per_feature=5,
        )
        if not hits:
            raise ValueError(
                f"Local GMT smoke test returned no hits for '{database}' using genes {SMOKE_TEST_GENES}"
            )

        required_keys = {"term", "adjP", "overlapGenes"}
        missing_keys = required_keys - set(hits[0].keys())
        if missing_keys:
            raise ValueError(
                f"Local GMT smoke test for '{database}' is missing required fields: {sorted(missing_keys)}"
            )

        smoke_results.append(
            {
                "database": database,
                "hits": len(hits),
                "topTerm": hits[0]["term"],
            }
        )

    return {
        "ok": True,
        "mode": "local_gmt",
        "reason": "Local GMT smoke test passed",
        "checks": smoke_results,
    }


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    feature_assoc = read_json(args.feature_assoc_path)
    feature_assoc_map = feature_assoc["features"]
    gene_universe = set(feature_assoc["metadata"]["geneUniverse"])

    gmt_payloads: list[tuple[str, dict[str, set[str]]]] = []
    for path in args.gmt:
        if not path.exists():
            raise FileNotFoundError(f"GMT file not found: {path}")
        gmt_payloads.append((database_label_from_path(path), parse_gmt(path)))

    if not gmt_payloads:
        raise ValueError("No GMTs supplied. Local GMT enrichment is required for this pipeline.")

    smoke_test = run_local_gmt_smoke_test(gmt_payloads)
    print(f"local GMT smoke test ok={smoke_test['ok']} reason={smoke_test['reason']}")

    pathway_results: dict[str, Any] = {
        "metadata": {
            "gmtFiles": [str(path) for path in args.gmt],
            "topPositiveGenes": args.top_positive_genes,
            "maxResultsPerFeature": args.max_results_per_feature,
            "minOverlap": args.min_overlap,
            "executionMode": "local_gmt",
            "localGmtSmokeTest": smoke_test,
        },
        "features": {},
    }

    universe_size = len(gene_universe)
    if universe_size == 0:
        raise ValueError("Gene universe is empty; cannot run enrichment")

    for latent_idx, payload in feature_assoc_map.items():
        positive_genes = [
            entry["gene"] for entry in payload.get("positive", [])[: args.top_positive_genes]
        ]
        query_genes = [gene for gene in positive_genes if gene in gene_universe]
        query_set = set(query_genes)
        query_size = len(query_set)

        if query_size == 0:
            pathway_results["features"][latent_idx] = []
            continue
        pathway_results["features"][latent_idx] = run_local_enrichment(
            query_genes=list(query_set),
            gene_universe=gene_universe,
            gmt_payloads=gmt_payloads,
            min_overlap=args.min_overlap,
            max_results_per_feature=args.max_results_per_feature,
        )

    output_path = args.output_dir / "pathway_results.json"
    write_json(output_path, pathway_results)
    print(f"saved pathway results: {output_path}")


if __name__ == "__main__":
    main()
