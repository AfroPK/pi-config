#requires -Version 5.1
<#
.SYNOPSIS
  Safe Pi / extension update wrapper that preserves local config and package patches.
.DESCRIPTION
  1. Backs up settings.json, models.json, keybindings.json, npm manifests, and loop-police.json.
  2. Runs `pi update` with any passed arguments (e.g. `--extensions`, `--all`).
  3. Runs `manage-patches.mjs apply` to verify and cleanly reapply local package patches.
  4. Runs `verify-pi-compat.mjs` to prove Pi, schemas, extensions, skills, models, and tests pass.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PiArgs
)

$ErrorActionPreference = "Stop"
$HomeDir = [System.IO.Path]::GetFullPath($HOME).TrimEnd('\')
$AgentDir = Join-Path $HomeDir ".pi\agent"
$BackupDir = Join-Path $HomeDir (".pi-config-backups\pre-update-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

$FilesToBackup = @(
    (Join-Path $AgentDir "settings.json"),
    (Join-Path $AgentDir "models.json"),
    (Join-Path $AgentDir "keybindings.json"),
    (Join-Path $AgentDir "npm\package.json"),
    (Join-Path $AgentDir "npm\package-lock.json"),
    (Join-Path $AgentDir "npm\node_modules\pi-loop-police\extensions\loop-police.json")
)

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$BackedUp = 0
foreach ($src in $FilesToBackup) {
    if (Test-Path -LiteralPath $src -PathType Leaf) {
        $rel = $src.Substring($AgentDir.Length).TrimStart('\')
        $dst = Join-Path $BackupDir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        Copy-Item -LiteralPath $src -Destination $dst -Force
        $BackedUp++
    }
}
Write-Host "[1/4] Backed up $BackedUp config files to $BackupDir"

Write-Host "[2/4] Running pi update $($PiArgs -join ' ')..."
& pi update @PiArgs
if ($LASTEXITCODE) {
    Write-Warning "pi update exited with code $LASTEXITCODE; continuing to patch & compatibility checks."
}

Write-Host "[3/4] Checking and reapplying local package patches..."
& node (Join-Path $AgentDir "patches\manage-patches.mjs") apply --agent-dir $AgentDir --home $HomeDir
if ($LASTEXITCODE) {
    throw "Patch check/reapply failed. Inspect conflicts above; pre-update backup is at $BackupDir"
}

Write-Host "[4/4] Running Pi compatibility suite..."
& node (Join-Path $AgentDir "tests\verify-pi-compat.mjs") --agent-dir $AgentDir
if ($LASTEXITCODE) {
    throw "Compatibility verification failed. Pre-update backup is at $BackupDir"
}

Write-Host "Update and compatibility verification succeeded."
