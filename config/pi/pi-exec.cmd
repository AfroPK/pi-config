@echo off
REM Executor half of the planner/executor workflow: Swift 1.5 Qwen3.8-27B (IQ2_XS 64K q4_0 KV) at thinking low, full tools, follows PLAN.md.
REM Usage: pi-exec [extra instructions] [pi args...]   (run in the folder where pi-plan wrote PLAN.md; add -p to run non-interactively)
REM Switched from ISTA qwen27-xs-64k to Swift 1.5 on 2026-10-26: same quality, ~half the thinking on vague prompts, fewer
REM runaways at xhigh, ~15-20% slower on agent runs. Backup: *.bak-20261026-swiftswitch.
REM Switched to XeStrata Gyro-S (Qwen3.8-Flash-Next, 128K, C:\XeStrata\start-xestrata-pi.bat) on 2026-10-30. Backup: *.bak-20261030-xestrata.
REM Switched to Kaggle (kaggle/qwen27-q6-mtp: Qwen3.8-27B UD-Q6_K + MTP, 128K, 2x T4 via Cloudflare tunnel) on 2026-10-31.
REM   Needs the Kaggle notebook running + kaggle-set <url> <key>; kaggle-check.ps1 fails fast if it's down. Backup: *.bak-20261031-kaggle.
REM Switched back to Swift 1.5 (local, via llama-swap) on 2026-10-31: the Kaggle tunnel hit Cloudflare 524 timeouts. Backup: *.bak-20261031-swiftback.
REM Switched to Qwen3.6-35B-A3B AntiLoop (antiloop/qwen3.6-antiloop-local: ROCm + MTP n2, 128K, ~45 tok/s) on 2026-10-31
REM   at Freddy's request. Thinking is on/off + token budget (medium 4096 / low 2048). Backup: *.bak-20261031-antiloop.
REM Switched to Ornith 1.5 9B Q8 (ornith/ornith9b-q8, all in VRAM, MTP n2 ~62 tok/s) on 2026-10-31 at Freddy's request; plan/review stay on Swift, so llama-swap swaps models (~35-40 s). Backup: *.bak-20261031-swiftornith.
REM Switched to Qwen3.6-35B-A3B UD-IQ3_XXS (qwen36iq3/qwen3.6-iq3-local, 128K; executor benchmark 10/10 and fastest) on 2026-11-19 at Freddy's request. Backup: *.bak-20261119-3models.
setlocal
if not exist "PLAN.md" (
    echo No PLAN.md in %CD% - run pi-plan "task" here first.
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias qwen3.6-iq3-local
if errorlevel 1 exit /b 1
REM Full node path, as in pi-durable.cmd: a stray quote in PATH ("...\GitHub CLI"") hides node from cmd's PATH search
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model qwen36iq3/qwen3.6-iq3-local --thinking low --no-skills --exclude-tools "ssh-*,call_model" --append-system-prompt "%USERPROFILE%\.pi\bonsai-local.md" --append-system-prompt "%USERPROFILE%\.pi\environment.md" --append-system-prompt "%USERPROFILE%\.pi\executor.md" --name "exec" @PLAN.md "Execute PLAN.md now, step by step." %*
