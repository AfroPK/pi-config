# Fails fast (exit 1) when Pi's kaggle provider isn't reachable, instead of letting Pi hit 502/530 mid-run.
# Used by pi-plan / pi-exec in place of ensure-server.ps1 (the model runs on Kaggle, nothing to start locally).
$ErrorActionPreference = "Stop"
$p = (Get-Content "$HOME\.pi\agent\models.json" -Raw | ConvertFrom-Json).providers.kaggle
if (-not $p) { Write-Host "No kaggle provider in models.json - run kaggle-set <url> <key> first."; exit 1 }
try {
    $m = Invoke-RestMethod "$($p.baseUrl)/models" -Headers @{Authorization = "Bearer $($p.apiKey)"} -TimeoutSec 20
    Write-Host "kaggle up: $($m.data.id -join ', ') @ $($p.baseUrl)"
} catch {
    Write-Host "Kaggle server not reachable at $($p.baseUrl) ($($_.Exception.Message))."
    Write-Host "Start the Kaggle notebook (keep its tab open), then: kaggle-set <url> <key>"
    exit 1
}
