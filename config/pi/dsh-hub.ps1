# dsh-hub: open the DeepSeek Harness web UI that runs on the HomeLab (dsh.service, 127.0.0.1:3080 there).
#   dsh-hub        open it        dsh-hub stop     close the tunnel
#   dsh-hub silent tunnel only, hidden window, no browser (run at login by Startup\dsh-hub.vbs)
# https://192.168.0.117:3081 (Caddy, self-signed) is blocked by browsers on this PC because the cert
# is untrusted. http://localhost is a secure context with no cert, so tunnel the port instead:
#   -L 3080  this PC's localhost:3080 -> HomeLab dsh 127.0.0.1:3080 (via ZeroTier 10.147.17.219, works off-LAN too)
#   -R 18081 HomeLab 127.0.0.1:18081 -> this PC's llama-swap :8080, so dsh can use the local models (provider "local")
# The tunnel runs in a minimized window and reconnects if it drops.
param([string]$Cmd = "")

$tunnelTitle = "dsh-hub tunnel"
function Get-Tunnel {
	Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -match '-L 3080:127\.0\.0\.1:3080' }
}

if ($Cmd -eq "stop") {
	Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'dsh-hub-loop' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Get-Tunnel | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Write-Host "[dsh-hub] tunnel stopped (dsh keeps running on the HomeLab)."
	exit 0
}

# The DSH-Tunnel boot task and the Startup shortcut both run this; a running loop counts as up.
$loopRunning = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'dsh-hub-loop' }
if (-not (Get-Tunnel) -and -not $loopRunning) {
	Write-Host "[dsh-hub] opening tunnel to the HomeLab..."
	# The marker comment lets `dsh-hub stop` find this loop.
	$loop = '# dsh-hub-loop' + "`n" + 'while ($true) { ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ' +
		'-L 3080:127.0.0.1:3080 -R 18081:127.0.0.1:8080 freddy@10.147.17.219; Write-Host "tunnel dropped, reconnecting in 5 s"; Start-Sleep 5 }'
	$style = if ($Cmd -eq "silent") { "Hidden" } else { "Minimized" }
	Start-Process powershell -WindowStyle $style -ArgumentList "-NoProfile", "-Command", "`$host.UI.RawUI.WindowTitle='$tunnelTitle'; $loop"
	for ($i = 0; $i -lt 20; $i++) {
		try { if ((Invoke-WebRequest http://127.0.0.1:3080/ -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
		Start-Sleep 1
	}
}
if ($Cmd -eq "silent") { exit 0 }
try { $null = Invoke-WebRequest http://127.0.0.1:3080/ -UseBasicParsing -TimeoutSec 3 } catch {
	Write-Host "[dsh-hub] dsh not reachable. On the HomeLab check: systemctl status dsh"; exit 1
}
Write-Host "[dsh-hub] ready: http://localhost:3080"
Start-Process "http://localhost:3080"
