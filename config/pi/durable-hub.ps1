# durable-hub: use the Durable Pi web UI that runs on the HomeLab, with models from this PC.
#   durable-hub            Qwen3.8 (default)     durable-hub bonsai     durable-hub stop
# One SSH connection carries both directions:
#   -L 4781  this PC's localhost:4781  -> HomeLab hub (web UI, 127.0.0.1 only)
#   -R 18080 HomeLab's localhost:18080 -> this PC's llama.cpp server :8080
# The tunnel runs in a minimized window and reconnects if it drops. Agents keep running on the HomeLab
# without it; model calls just wait and retry until the tunnel and model server are back.
param([string]$Model = "qwen38")

$tunnelTitle = "durable-hub tunnel"
function Get-Tunnel {
	Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -match '-R 18080:127\.0\.0\.1:8080' }
}

if ($Model -eq "stop") {
	Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'durable-hub-loop' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Get-Tunnel | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Write-Host "[durable-hub] tunnel stopped (the HomeLab hub and agents keep running)."
	exit 0
}

$models = @{
	qwen38 = @{ Bat = "__PI_HOME__\llama\start-qwen38.bat"; Alias = "qwen3.8-35b-a3b-local" }
	bonsai = @{ Bat = "__PI_HOME__\llama-prism\start-bonsai.bat"; Alias = "bonsai2-27b-mtp" }
}
if (-not $models.ContainsKey($Model)) { Write-Host "Usage: durable-hub [qwen38|bonsai|stop]"; exit 1 }

& powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\ensure-server.ps1" -Bat $models[$Model].Bat -Alias $models[$Model].Alias
if ($LASTEXITCODE -ne 0) { Write-Host "[durable-hub] model server did not start"; exit 1 }

if (-not (Get-Tunnel)) {
	Write-Host "[durable-hub] opening tunnel to the HomeLab..."
	# The marker comment lets `durable-hub stop` find this loop.
	$loop = '# durable-hub-loop' + "`n" + 'while ($true) { ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ' +
		'-L 4781:127.0.0.1:4781 -R 18080:127.0.0.1:8080 homelab; Write-Host "tunnel dropped, reconnecting in 5 s"; Start-Sleep 5 }'
	Start-Process powershell -WindowStyle Minimized -ArgumentList "-NoProfile", "-Command", "`$host.UI.RawUI.WindowTitle='$tunnelTitle'; $loop"
	for ($i = 0; $i -lt 20; $i++) {
		try { if ((Invoke-WebRequest http://127.0.0.1:4781/ -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
		Start-Sleep 1
	}
}
try { $null = Invoke-WebRequest http://127.0.0.1:4781/ -UseBasicParsing -TimeoutSec 3 } catch {
	Write-Host "[durable-hub] hub not reachable. On the HomeLab check: systemctl status dpi-hub dpi-backend"; exit 1
}
Write-Host "[durable-hub] ready: http://localhost:4781  (model: $($models[$Model].Alias) on this PC)"
Start-Process "http://localhost:4781"
