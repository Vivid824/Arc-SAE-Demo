from __future__ import annotations

import argparse
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import DEFAULT_MODEL_DIR, DEFAULT_MODULES_PATH, load_config, load_state_model, print_header, print_kv, resolve_checkpoint_path, resolve_transformer_block, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="List STATE modules and identify a hookable transformer block.")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--checkpoint-name", type=str, default=None)
    parser.add_argument(
        "--output-json",
        type=Path,
        default=DEFAULT_MODULES_PATH,
    )
    parser.add_argument("--print-limit", type=int, default=200)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_dir = args.model_dir.resolve()
    config_path, _ = load_config(model_dir)
    checkpoint = resolve_checkpoint_path(model_dir, args.checkpoint_name)
    model = load_state_model(checkpoint.checkpoint_path, config_path)

    named_modules = list(model.named_modules())
    block_info = resolve_transformer_block(model)

    print_header("hook target")
    print_kv("container_path", block_info["container_path"])
    print_kv("num_blocks", block_info["num_blocks"])
    print_kv("selected_block_path", block_info["selected_block_path"])
    print_kv("selection_strategy", block_info["strategy"])

    print_header("named modules")
    for name, module in named_modules[: args.print_limit]:
        print(f"{name}: {type(module).__name__}")

    write_json(
        args.output_json,
        {
            "model_dir": str(model_dir),
            "checkpoint_path": str(checkpoint.checkpoint_path),
            "hook_target": block_info,
            "named_modules": [
                {"name": name, "type": type(module).__name__}
                for name, module in named_modules[: args.print_limit]
            ],
        },
    )


if __name__ == "__main__":
    main()
