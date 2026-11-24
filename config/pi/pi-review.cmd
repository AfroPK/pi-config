@echo off
REM Reviewer step of the planner/executor workflow (added 2026-10-31): a FRESH Swift session (clean 48K context, thinking medium)
REM checks PLAN.md against the task (requirements coverage, every code listing syntax-checked + read for runtime bugs, real APIs,
REM anchors, quoted facts, Verify coverage, This-PC facts) and appends a "## Review corrections" section + an extra step.
REM Usage: pi-review [TASK-file] [pi args...]   (add -p to run non-interactively and exit). Without a TASK file it reviews
REM against the plan's own goal and Requirements table. pi-pe saves its task text to PLAN.task.md and passes that.
REM Switched to Qwen3.6-35B-A3B AntiLoop (antiloop/qwen3.6-antiloop-local: ROCm + MTP n2, 128K, ~45 tok/s) on 2026-10-31
REM   at Freddy's request. Thinking is on/off + token budget (medium 4096 / low 2048). Backup: *.bak-20261031-antiloop.
REM Switched back to Swift 1.5 (qwen27/swift27-xs-64k, 48K, all in VRAM) on 2026-10-31 at Freddy's request; pi-exec now runs Ornith 9B. Backup: *.bak-20261031-swiftornith.
REM Switched to Strata Gyro-S (strata/qwen3.8-flash-next-gyro-s, 64K) on 2026-11-19 at Freddy's request. Backup: *.bak-20261119-3models.
setlocal
if not exist "PLAN.md" (
    echo No PLAN.md in %CD% - run pi-plan first.
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Alias qwen3.8-flash-next-gyro-gyro-s
if errorlevel 1 exit /b 1
set "TASKARG=Review PLAN.md now."
if "%~1"=="" goto run
if not exist "%~1" goto run
set "TASKARG=Review PLAN.md now. The task it was planned from is in %~1 - read it first."
shift
:run
"C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model strata/qwen3.8-flash-next-gyro-s --thinking medium --no-skills --tools "read,grep,find,ls,edit,bash,firecrawl_search,firecrawl_scrape" --exclude-tools "ssh-*,call_model,mcp__*" --append-system-prompt "%USERPROFILE%\.pi\strata-local.md" --append-system-prompt "%USERPROFILE%\.pi\environment.md" --append-system-prompt "%USERPROFILE%\.pi\reviewer.md" --name "review" %1 %2 %3 %4 %5 %6 %7 %8 %9 "%TASKARG%"
