@echo off
REM Lean Pi launcher for Qwen3.8-27B Unsloth UD-Q6_K + MTP running on Kaggle (2x T4) behind a Cloudflare tunnel.
REM Notebook: __PI_HOME__\kaggle-ollama\llama-kaggle.ipynb. Each Kaggle restart changes URL + key: run kaggle-set first.
REM Same trimmed prompt as pi-qwen27 (--no-skills, -xt ssh-*,call_model, local-session note). ~23-27 tok/s (--split-mode tensor).
REM Usage: pi-kaggle [pi args...]
setlocal
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model kaggle/qwen27-q6-mtp --no-skills --exclude-tools "ssh-*,call_model" --append-system-prompt "%USERPROFILE%\.pi\bonsai-local.md" %*
