@echo off
REM Lean Pi launcher for Qwen3.6-35B-A3B UD-IQ3_XXS, ncmoe 16, 128K q4_0 (__PI_HOME__\llama\start-qwen36-iq3.bat; ~40 tok/s, ~1400 pp).
REM Starts (or swaps to) that server on :8080, then runs Pi with the same trimmed prompt as pi-antiloop.
REM Thinking is on/off + token budget (settings.json thinkingBudgets), no effort levels.
REM Usage: pi-qwen36 [pi args...]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Bat "__PI_HOME__\llama\start-qwen36-iq3.bat" -Alias qwen3.6-iq3-local
if errorlevel 1 exit /b 1
REM Full node path, as in pi-durable.cmd: a stray quote in PATH ("...\GitHub CLI"") hides node from cmd's PATH search
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --model qwen36iq3/qwen3.6-iq3-local --no-skills --exclude-tools "ssh-*,call_model" --append-system-prompt "%USERPROFILE%\.pi\bonsai-local.md" %*
