from __future__ import annotations

import importlib
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common import print_header, print_kv


def main() -> None:
    print_header("python")
    print_kv("executable", sys.executable)
    print_kv("version", sys.version.replace("\n", " "))

    modules = (
        "torch",
        "anndata",
        "numpy",
        "scipy",
        "umap",
        "gseapy",
        "huggingface_hub",
        "state.tx.models.state_transition",
        "state._cli._tx._infer",
    )

    print_header("imports")
    for module_name in modules:
        module = importlib.import_module(module_name)
        version = getattr(module, "__version__", "n/a")
        print_kv(module_name, version)

    from state.tx.models.state_transition import StateTransitionPerturbationModel
    from state._cli._tx._infer import prepare_batch

    print_header("state")
    print_kv("StateTransitionPerturbationModel", StateTransitionPerturbationModel.__module__)
    print_kv("prepare_batch", prepare_batch.__module__)


if __name__ == "__main__":
    main()
