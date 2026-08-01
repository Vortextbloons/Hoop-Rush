$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
if (Test-Path ".venv-import\Scripts\Activate.ps1") {
  & .venv-import\Scripts\Activate.ps1
}
python scripts/import-nba/run_all.py @args
