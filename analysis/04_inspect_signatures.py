from __future__ import annotations

import argparse
import inspect
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import (
    DEFAULT_MODEL_DIR,
    DEFAULT_SIGNATURES_PATH,
    load_config,
    load_state_model,
    prepare_batch_like_infer_signature,
    print_header,
    print_kv,
    resolve_checkpoint_path,
    supports_padded_forward,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect installed STATE signatures.")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--checkpoint-name", type=str, default=None)
    parser.add_argument(
        "--output-json",
        type=Path,
        default=DEFAULT_SIGNATURES_PATH,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_dir = args.model_dir.resolve()
    config_path, _ = load_config(model_dir)
    checkpoint = resolve_checkpoint_path(model_dir, args.checkpoint_name)

    model = load_state_model(checkpoint.checkpoint_path, config_path)

    forward_supports_padded, forward_signature = supports_padded_forward(model)
    predict_step_signature = str(inspect.signature(model.predict_step))
    prepare_batch_signature = prepare_batch_like_infer_signature()

    print_header("signatures")
    print_kv("model.forward", forward_signature)
    print_kv("model.predict_step", predict_step_signature)
    print_kv("prepare_batch", prepare_batch_signature)
    print_kv("forward_supports_padded", forward_supports_padded)

    recommended_call = "model.forward(batch, padded=False)" if forward_supports_padded else "model.forward(batch)"
    print_kv("recommended_forward_call", recommended_call)

    write_json(
        args.output_json,
        {
            "model_dir": str(model_dir),
            "config_path": str(config_path),
            "checkpoint_path": str(checkpoint.checkpoint_path),
            "forward_signature": forward_signature,
            "predict_step_signature": predict_step_signature,
            "prepare_batch_signature": prepare_batch_signature,
            "prepare_batch_source": "local helper mirroring installed state._cli._tx._infer nested prepare_batch",
            "forward_supports_padded": forward_supports_padded,
            "recommended_forward_call": recommended_call,
        },
    )


if __name__ == "__main__":
    main()
