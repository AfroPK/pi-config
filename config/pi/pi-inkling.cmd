@echo off
REM Pi on Inkling 2 Mini (thinkingmachines, Unsloth UD-IQ2_XXS + DSpark Q8_0), 113K q4_1, via llama-swap :8080.
REM b12675 measured: 62-75 tok/s short / 46.5 tok/s at 45K, prefill 190 / 167 tok/s, 10.55 GiB ded VRAM flat.
REM Defaults to --thinking minimal (0.1 effort; avoids the 0.7 "medium" overthinking loop). Override with --thinking <lvl>.
REM Usage: pi-inkling [pi args...]
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias inkling2-mini-113k
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model inkling/inkling2-mini-113k --thinking minimal %*

