@echo off
REM Stops every local model server (frees the GPU's VRAM). Usage: pi-stop
REM llama-swap keeps running on :8080 with nothing loaded; the next pi-* launcher loads its model again.
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/models/unload -TimeoutSec 60 | Out-Null; Write-Host '[pi-stop] llama-swap: model unloaded.' } catch { Write-Host '[pi-stop] llama-swap not running.' }"
taskkill /f /im llama-server.exe >nul 2>&1 && echo [pi-stop] Stand-alone llama-server stopped.
exit /b 0
