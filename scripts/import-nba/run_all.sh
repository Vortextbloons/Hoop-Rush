#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -d ".venv-import" ]; then
  source .venv-import/bin/activate
fi
python scripts/import-nba/run_all.py "$@"
