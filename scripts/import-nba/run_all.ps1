$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
if (Test-Path ".venv-import\Scripts\Activate.ps1") {
  & .venv-import\Scripts\Activate.ps1
}
py -m scripts.import_nba.run_all @args
