#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORK_ROOT="${WORK_ROOT:-/workspace/state-mvp}"

echo "== remote preflight =="
echo "script_dir: ${SCRIPT_DIR}"
echo "repo_root: ${REPO_ROOT}"
echo "work_root: ${WORK_ROOT}"
echo "hostname: $(hostname)"
echo "cwd: $(pwd)"
echo "date_utc: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

echo "== storage =="
df -h
echo

echo "== key paths =="
ls -ld "${REPO_ROOT}" /workspace /data /mnt /mnt/disk /scratch /tmp 2>/dev/null || true
echo

echo "== tooling =="
command -v python3 || true
python3 --version || true
command -v uv || true
command -v git || true
command -v curl || true
command -v wget || true
command -v nvidia-smi || true
echo

echo "== gpu =="
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || true
echo

echo "== notes =="
echo "- Use ${WORK_ROOT} on the remote host as the sync target unless you override WORK_ROOT."
echo "- This script is read-only. It does not create envs or download artifacts."
