from __future__ import annotations

import argparse
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import (
    DEFAULT_MODEL_DIR,
    DEFAULT_OUTPUT_DIR,
    find_model_artifact,
    load_config,
    load_state_model,
    print_header,
    print_kv,
    resolve_cell_sentence_len,
    resolve_checkpoint_path,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load a STATE checkpoint and confirm required artifacts.")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--checkpoint-name", type=str, default=None)
    parser.add_argument(
        "--output-json",
        type=Path,
        default=DEFAULT_OUTPUT_DIR / "03_checkpoint_smoke.json",
    )
    return parser.parse_args()

def main() -> None:
    args = parse_args()
    model_dir = args.model_dir.resolve()
    print_header("model dir")
    print_kv("model_dir", model_dir)

    config_path, config = load_config(model_dir)
    checkpoint = resolve_checkpoint_path(model_dir, args.checkpoint_name)

    print_header("checkpoint")
    print_kv("config_path", config_path)
    print_kv("checkpoint_path", checkpoint.checkpoint_path)
    print_kv("selection_strategy", checkpoint.strategy)
    print_kv("candidate_count", len(checkpoint.candidates))

    print_header("artifacts")
    artifact_paths = {
        "pert_onehot_map": find_model_artifact(model_dir, "pert_onehot_map", (".pt", ".pkl", ".pickle")),
        "batch_onehot_map": find_model_artifact(model_dir, "batch_onehot_map", (".pt", ".pkl", ".pickle")),
        "cell_type_onehot_map": find_model_artifact(model_dir, "cell_type_onehot_map", (".pt", ".pkl", ".pickle")),
        "var_dims": find_model_artifact(model_dir, "var_dims", (".pt", ".pkl", ".pickle")),
    }
    for name, path in artifact_paths.items():
        print_kv(name, path or "missing")

    model = load_state_model(checkpoint.checkpoint_path, config_path)

    print_header("model load")
    print_kv("class", model.__class__.__name__)
    print_kv("repr", model)
    print_kv("cell_sentence_len", getattr(model, "cell_sentence_len", None))
    print_kv("output_space", getattr(model, "output_space", None))
    print_kv("embed_key", getattr(model, "embed_key", None))
    print_kv("use_basal_projection", getattr(model, "use_basal_projection", None))
    print_kv("basal_encoder_type", type(getattr(model, "basal_encoder", None)).__name__)
    print_kv("has_batch_encoder", hasattr(model, "batch_encoder") and getattr(model, "batch_encoder") is not None)
    cell_sentence_len, cell_sentence_len_source = resolve_cell_sentence_len(model, config)
    print_kv("resolved_cell_sentence_len", cell_sentence_len)
    print_kv("cell_sentence_len_source", cell_sentence_len_source)

    write_json(
        args.output_json,
        {
            "model_dir": str(model_dir),
            "config_path": str(config_path),
            "checkpoint_path": str(checkpoint.checkpoint_path),
            "checkpoint_strategy": checkpoint.strategy,
            "artifact_paths": {key: (str(path) if path else None) for key, path in artifact_paths.items()},
            "model_attrs": {
                "cell_sentence_len": getattr(model, "cell_sentence_len", None),
                "output_space": getattr(model, "output_space", None),
                "embed_key": getattr(model, "embed_key", None),
                "use_basal_projection": getattr(model, "use_basal_projection", None),
                "basal_encoder_type": type(getattr(model, "basal_encoder", None)).__name__,
                "has_batch_encoder": hasattr(model, "batch_encoder") and getattr(model, "batch_encoder") is not None,
                "resolved_cell_sentence_len": cell_sentence_len,
                "cell_sentence_len_source": cell_sentence_len_source,
            },
            "config_control_matches": [],
            "config_excerpt": config,
        },
    )


if __name__ == "__main__":
    main()
