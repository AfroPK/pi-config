@echo off
REM Lean Pi launcher for Strata Qwen3.8-Flash-Next Gyro-S (125B MoE) running on Kaggle (2x T4) behind a Cloudflare tunnel, 64K context.
REM Notebook: __PI_HOME__\kaggle-ollama\strata-kaggle.ipynb (built by build_strata_notebook.py). Each restart: run kaggle-strata-set first.
REM Same trimmed prompt as pi-strata. Thinking defaults to off; pass --thinking medium for hard problems.
REM Usage: pi-kaggle-strata [pi args...]
setlocal
set "THINK=--thinking off"
echo %* | findstr /i /c:"--thinking" >nul && set "THINK="
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model kaggle-strata/gyro-s %THINK% --no-skills --exclude-tools "ssh-*,call_model" --append-system-prompt "%USERPROFILE%\.pi\kaggle-strata.md" %*
