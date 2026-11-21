# laptop-link: let Pi on the Omarchy laptop (192.168.0.122) use the model servers on this PC.
#   laptop-link        start it        laptop-link stop     close the tunnel
#   laptop-link silent hidden window (run at login by Startup\laptop-link.vbs)
# The servers here bind 127.0.0.1 only, and the laptop's models.json is a copy of this PC's, so the
# laptop's localhost ports are forwarded to the same ports here:
#   8080  llama-swap (all local llama.cpp models)    1234  LM Studio    20128  omnirouter
# A server that isn't running just fails that request; the tunnel stays up and reconnects if it drops.
param([string]$Cmd = "")

$tunnelTitle = "laptop-link tunnel"
function Get-Tunnel {
	Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -match '-R 8080:127\.0\.0\.1:8080 .*freddy@192\.168\.0\.122' }
}

if ($Cmd -eq "stop") {
	Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'laptop-link-loop' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Get-Tunnel | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
	Write-Host "[laptop-link] tunnel stopped."
	exit 0
}

$loopRunning = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'laptop-link-loop' }
if ((Get-Tunnel) -or $loopRunning) { Write-Host "[laptop-link] already running."; exit 0 }
# The marker comment lets `laptop-link stop` find this loop.
$loop = '# laptop-link-loop' + "`n" + 'while ($true) { ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ' +
	'-R 8080:127.0.0.1:8080 -R 1234:127.0.0.1:1234 -R 20128:127.0.0.1:20128 freddy@192.168.0.122; Write-Host "tunnel dropped, reconnecting in 5 s"; Start-Sleep 5 }'
$style = if ($Cmd -eq "silent") { "Hidden" } else { "Minimized" }
Start-Process powershell -WindowStyle $style -ArgumentList "-NoProfile", "-Command", "`$host.UI.RawUI.WindowTitle='$tunnelTitle'; $loop"
Write-Host "[laptop-link] tunnel started: the laptop's Pi can now use this PC's models"
