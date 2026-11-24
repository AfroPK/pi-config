@echo off
REM Lean Pi launcher for the local Strata server (Qwen3.8-Flash-Next Gyro-S on the RX 6750 XT, C:\Strata\start-strata-pi.bat).
REM Starts (or swaps to) Strata on :8080, then runs Pi with the same trimmed prompt as pi-qwen38:
REM   --no-skills, -xt ssh-*,call_model, plus the Strata session note (32K context: targeted reads).
REM Thinking defaults to off: a test task took ~21-29 s off; pass --thinking medium for hard problems.
REM Server tuning lives in C:\Strata\strata-gyro-gyro-s.json (FP16 prompts, VRAM reserve, RAM headroom).
REM Usage: pi-strata [pi args...]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Bat "C:\Strata\start-strata-pi.bat" -Alias qwen3.8-flash-next-gyro-gyro-s
if errorlevel 1 exit /b 1
set "THINK=--thinking off"
echo %* | findstr /i /c:"--thinking" >nul && set "THINK="
REM Full node path, as in pi-durable.cmd: a stray quote in PATH ("...\GitHub CLI"") hides node from cmd's PATH search
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model strata/qwen3.8-flash-next-gyro-s %THINK% --no-skills --exclude-tools "ssh-*,call_model" --append-system-prompt "%USERPROFILE%\.pi\strata-local.md" %*
