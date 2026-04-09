#!/usr/bin/env bash
set -euo pipefail

ARTIFACTS_DIR="${1:-/workspace/state-mvp/artifacts}"
EXPORTED_DIR="${2:-/workspace/state-mvp/exported_data}"
ARCHIVE_DIR="${ARTIFACTS_DIR}/archive/$(date +%Y%m%d-%H%M%S)-failed-batchtopk"

mkdir -p "${ARCHIVE_DIR}"
mkdir -p "${EXPORTED_DIR}"

for f in sae_layer4.pt feature_acts.npy sae_train_log.json sae_selection.json feature_metrics.json feature_gene_assoc.json pathway_results.json; do
  if [ -f "${ARTIFACTS_DIR}/${f}" ]; then
    mv "${ARTIFACTS_DIR}/${f}" "${ARCHIVE_DIR}/"
  fi
done

if [ -d "${EXPORTED_DIR}" ]; then
  mkdir -p "${ARCHIVE_DIR}/exported_data"
  rsync -a "${EXPORTED_DIR}/" "${ARCHIVE_DIR}/exported_data/"
fi

# Clear exported_data after archival to avoid mixed stale/new exports.
find "${EXPORTED_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

rm -f "${ARTIFACTS_DIR}/sae_selection.json"

echo "Archived failed SAE branch to ${ARCHIVE_DIR}"
