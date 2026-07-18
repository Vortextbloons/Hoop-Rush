#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -d ".venv-import" ]; then
  source .venv-import/bin/activate
fi
python -m scripts.import_nba.run_all "$@"
