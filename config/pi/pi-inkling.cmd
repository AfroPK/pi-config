@echo off
REM Pi on Inkling 2 Mini (thinkingmachines, Unsloth UD-IQ2_XXS), 113K, text-only, via llama-swap :8080.
REM ~40 tok/s short / 29.29 tok/s at 102K context, server 9.53 GB dedicated VRAM in the deep test. The model id
REM uses inkling2-mini-113k. Thinking levels map to reasoning_effort (off=none ... xhigh).
REM It always reasons a little. Usage: pi-inkling [pi args...]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias inkling2-mini-113k
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model inkling/inkling2-mini-113k %*
