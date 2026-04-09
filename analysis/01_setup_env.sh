#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${VENV_DIR:-${REPO_ROOT}/.venv}"
DATA_DIR="${DATA_DIR:-${REPO_ROOT}/data}"
MODELS_DIR="${MODELS_DIR:-${REPO_ROOT}/checkpoints}"
DATASET_SOURCE="${DATASET_SOURCE:-state_replogle_filtered}"
FIGSHARE_URL="${FIGSHARE_URL:-https://figshare.com/ndownloader/files/35773219}"
STATE_REPLOGLE_REPO="${STATE_REPLOGLE_REPO:-arcinstitute/State-Replogle-Filtered}"
PREPRINT_REPO="${PREPRINT_REPO:-arcinstitute/Replogle-Nadig-Preprint}"
FIGSHARE_K562_PATH="${DATA_DIR}/K562_essential_raw_singlecell_01.h5ad"
STATE_REPLOGLE_PATH="${DATA_DIR}/replogle_concat.h5ad"
PREPRINT_K562_PATH="${DATA_DIR}/K562_essential_normalized_singlecell_01.h5ad"

if [[ -n "${ADATA_PATH:-}" ]]; then
  RESOLVED_ADATA_PATH="${ADATA_PATH}"
else
  case "${DATASET_SOURCE}" in
    state_replogle_filtered)
      RESOLVED_ADATA_PATH="${STATE_REPLOGLE_PATH}"
      ;;
    replogle_nadig_k562_normalized)
      RESOLVED_ADATA_PATH="${PREPRINT_K562_PATH}"
      ;;
    figshare_k562_raw)
      RESOLVED_ADATA_PATH="${FIGSHARE_K562_PATH}"
      ;;
    skip)
      RESOLVED_ADATA_PATH=""
      ;;
    *)
      echo "Unsupported DATASET_SOURCE='${DATASET_SOURCE}'." >&2
      exit 1
      ;;
  esac
fi

mkdir -p "${DATA_DIR}" "${MODELS_DIR}" "${REPO_ROOT}/analysis_data/gmts" "${REPO_ROOT}/artifacts" "${REPO_ROOT}/exported_data"

echo "== setup env =="
echo "repo_root: ${REPO_ROOT}"
echo "venv_dir: ${VENV_DIR}"
echo "dataset_source: ${DATASET_SOURCE}"
echo "adata_path: ${RESOLVED_ADATA_PATH:-<skipped>}"
echo "models_dir: ${MODELS_DIR}"
echo

if [[ ! -d "${VENV_DIR}" ]]; then
uv venv "${VENV_DIR}"
fi

# shellcheck disable=SC1090
source "${VENV_DIR}/bin/activate"

uv pip install torch arc-state anndata numpy scipy umap-learn gseapy tqdm huggingface_hub

validate_h5ad() {
  local path="$1"
  python - "$path" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.exists():
    raise SystemExit(1)
if path.stat().st_size <= 0:
    raise SystemExit(2)
with path.open("rb") as handle:
    signature = handle.read(8)
if signature != b"\x89HDF\r\n\x1a\n":
    raise SystemExit(3)
PY
}

download_from_hf() {
  local repo_id="$1"
  local filename="$2"
  local destination_dir="$3"
  python - "$repo_id" "$filename" "$destination_dir" <<'PY'
from huggingface_hub import hf_hub_download
import sys

repo_id, filename, destination_dir = sys.argv[1:4]
path = hf_hub_download(
    repo_id=repo_id,
    repo_type="dataset",
    filename=filename,
    local_dir=destination_dir,
)
print(path)
PY
}

if [[ -z "${RESOLVED_ADATA_PATH}" ]]; then
  echo "Skipping dataset download because DATASET_SOURCE=skip."
elif [[ ! -f "${RESOLVED_ADATA_PATH}" ]]; then
  case "${DATASET_SOURCE}" in
    state_replogle_filtered)
      echo "Downloading Arc-hosted State-Replogle-Filtered AnnData..."
      download_from_hf "${STATE_REPLOGLE_REPO}" "replogle_concat.h5ad" "${DATA_DIR}"
      ;;
    replogle_nadig_k562_normalized)
      echo "Downloading Arc-hosted K562 normalized AnnData..."
      download_from_hf "${PREPRINT_REPO}" "K562_essential_normalized_singlecell_01.h5ad" "${DATA_DIR}"
      ;;
    figshare_k562_raw)
      echo "Downloading direct K562 Figshare h5ad..."
      if command -v curl >/dev/null 2>&1; then
        curl -L --fail --retry 3 --retry-delay 2 "${FIGSHARE_URL}" -o "${RESOLVED_ADATA_PATH}"
      elif command -v wget >/dev/null 2>&1; then
        wget -O "${RESOLVED_ADATA_PATH}" "${FIGSHARE_URL}"
      else
        echo "Neither curl nor wget is available." >&2
        exit 1
      fi
      ;;
  esac
else
  echo "AnnData file already present, skipping download."
fi

if [[ -n "${RESOLVED_ADATA_PATH}" ]] && ! validate_h5ad "${RESOLVED_ADATA_PATH}"; then
  echo >&2
  echo "ERROR: ${RESOLVED_ADATA_PATH} is missing, empty, or not an HDF5-backed .h5ad file." >&2
  echo "On cloud hosts, the Figshare ndownloader URL may return an AWS WAF challenge instead of the real file." >&2
  echo "Fix by either:" >&2
  echo "  1. Downloading the file locally and rsyncing it to ${RESOLVED_ADATA_PATH}, or" >&2
  echo "  2. Pointing --adata-path at a different verified AnnData file." >&2
  rm -f "${RESOLVED_ADATA_PATH}"
  exit 1
fi

python -c "import torch; print(torch.__version__)"
python -c "import umap; print(umap.__version__)"
python -c "from state.tx.models.state_transition import StateTransitionPerturbationModel; print('state import ok')"
if [[ -n "${RESOLVED_ADATA_PATH}" ]]; then
  python -c "import anndata; a = anndata.read_h5ad('${RESOLVED_ADATA_PATH}', backed='r'); print(a.shape)"
fi

echo
echo "== done =="
echo "- Environment ready at ${VENV_DIR}"
echo "- AnnData ready at ${RESOLVED_ADATA_PATH:-<skipped>}"
echo "- Sync or download the chosen STATE run folder under ${MODELS_DIR} before running 03-06."
