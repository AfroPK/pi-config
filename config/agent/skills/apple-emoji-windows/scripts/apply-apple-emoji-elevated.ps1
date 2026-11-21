# Runs Apply-AppleEmoji.ps1 or Restore-SegoeEmoji.ps1 with a UAC prompt from a
# non-elevated shell.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File apply-apple-emoji-elevated.ps1 [-Mode Apply|Restore] [-Base <checkout>]
#
# -Base defaults to the standard checkout. The wrapper re-launches itself
# elevated with -Inner, runs the chosen script and leaves a UTF-8 log
# (apply-log.txt / restore-log.txt) next to it. Requires the font - and
# preferably the optimised build - to be in the checkout already, so the
# elevated run does no network I/O.
[CmdletBinding()]
param(
    [ValidateSet('Apply', 'Restore')]
    [string]$Mode = 'Apply',
    [string]$Base = '__PI_HOME__\projects\apple-emoji-windows',
    [switch]$Inner
)

$Base   = (Resolve-Path -LiteralPath $Base).Path
$Script = if ($Mode -eq 'Restore') { 'Restore-SegoeEmoji.ps1' } else { 'Apply-AppleEmoji.ps1' }
$Log    = Join-Path $Base ($(if ($Mode -eq 'Restore') { 'restore-log.txt' } else { 'apply-log.txt' }))

if (-not $Inner) {
    # Windows PowerShell 5.1 inherits a PowerShell 7 module path from some shells,
    # then loads PS7's Microsoft.PowerShell.Utility, which lacks Get-FileHash.
    $env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')

    $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass',
                            '-File', "`"$PSCommandPath`"", '-Inner', '-Mode', $Mode,
                            '-Base', "`"$Base`"")
    "elevated exit code: $($p.ExitCode)"
    if (Test-Path -LiteralPath $Log) {
        ''
        "--- $(Split-Path -Leaf $Log) ---"
        Get-Content -LiteralPath $Log -Encoding UTF8
    } else {
        'No log written - was the UAC prompt declined?'
    }
    exit 0
}

# ---------------------------------------------------------------- inner (elevated)
# Lines are buffered as they stream so a mid-run failure keeps the steps that
# already succeeded in the log (the applier throws instead of exiting).
Set-Location $Base
Remove-Item -LiteralPath $Log -Force -ErrorAction SilentlyContinue
$lines = New-Object 'System.Collections.Generic.List[string]'
try {
    & (Join-Path $Base $Script) *>&1 | ForEach-Object {
        $s = "$_"
        $lines.Add($s)
        Write-Host $s
    }
} catch {
    $msg = "FATAL: $($_.Exception.Message)"
    $lines.Add($msg)
    Write-Host $msg -ForegroundColor Red
} finally {
    Set-Content -LiteralPath $Log -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
}
Write-Host ''
Write-Host "--- $Script done; log at $(Split-Path -Leaf $Log) (window closes in 45s) ---" -ForegroundColor DarkGray
Start-Sleep -Seconds 45
