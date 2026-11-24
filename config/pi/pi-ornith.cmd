@echo off
REM Ornith 1.5 9B MQ6 through Hipfire/llama-swap: fully resident, MTP K=2, 72K context.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias ornith-1.5-9b.mq6
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model hipfire/ornith-1.5-9b.mq6 %*
endlocal
