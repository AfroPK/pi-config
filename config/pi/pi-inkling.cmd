@echo off
REM Pi on Inkling 2 Mini (thinkingmachines, Unsloth UD-IQ2_XXS), 64K, text-only, via llama-swap :8080.
REM ~42 tok/s short / 34.7 tok/s at 55K context, 9.35 GB VRAM. Thinking levels map to the template's
REM reasoning_effort (off=none ... xhigh); it always reasons a little. Usage: pi-inkling [pi args...]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias inkling2-mini-64k
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --model inkling/inkling2-mini-64k %*
