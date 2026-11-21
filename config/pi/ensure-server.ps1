# Makes sure :8080 is serving $Alias. Since 2026-10-30 :8080 is llama-swap (C:\llama-swap\config.yaml), which runs one
# model at a time and swaps by model name; $Alias is that name. -Bat is still accepted from the launchers but unused:
# the model's command now lives in config.yaml (the old ensure-server is ensure-server.ps1.bak-20261030-llamaswap).
param([string]$Bat, [Parameter(Mandatory)][string]$Alias)

$swap = 'C:\llama-swap\start-llama-swap.bat'

function Get-Listener { (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess }

# A stand-alone server from before llama-swap (or a start-*.bat run by hand) holds :8080: stop it and what it started.
$owner = Get-Listener
if ($owner -and (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName -ne 'llama-swap') {
  Write-Host "[pi-local] Stopping the stand-alone server on :8080 for llama-swap"
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add([int]$owner)
  for ($i = 0; $i -lt $ids.Count; $i++) { $all | ? { $_.ParentProcessId -eq $ids[$i] } | % { $ids.Add([int]$_.ProcessId) } }
  $p = $all | ? { $_.ProcessId -eq $owner }
  # the Strata / XeStrata python wrappers and xestrata-cli above the listener would otherwise linger
  while ($p -and ($up = $all | ? { $_.ProcessId -eq $p.ParentProcessId -and $_.Name -in 'python.exe', 'xestrata-cli.exe' })) { $ids.Add([int]$up.ProcessId); $p = $up }
  $ids | % { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 20 -and (Get-Listener); $i++) { Start-Sleep 1 }
}

if (-not (Get-Listener)) {
  Write-Host "[pi-local] Starting llama-swap..."
  Start-Process cmd.exe -ArgumentList '/c', "`"$swap`"" -WindowStyle Minimized
  for ($i = 0; $i -lt 30 -and -not (Get-Listener); $i++) { Start-Sleep 1 }
  if (-not (Get-Listener)) { Write-Host "[pi-local] llama-swap did not start - run $swap to see why."; exit 1 }
}

$running = try { (Invoke-RestMethod http://127.0.0.1:8080/running -TimeoutSec 5).running | ? { $_.state -eq 'ready' } | % model } catch { @() }
if ($running -contains $Alias) { exit 0 }
Write-Host "[pi-local] Loading $Alias (llama-swap)..."
# /upstream/<model>/health starts or swaps to the model and answers once it is ready (healthCheckTimeout 600 s)
for ($try = 0; $try -lt 3; $try++) {
  try {
    if ((Invoke-WebRequest "http://127.0.0.1:8080/upstream/$Alias/health" -UseBasicParsing -TimeoutSec 900).StatusCode -eq 200) { exit 0 }
  } catch { $why = $_.Exception.Message; Start-Sleep 3 }
}
Write-Host "[pi-local] $Alias did not come up ($why) - see http://127.0.0.1:8080/ui logs."
exit 1
