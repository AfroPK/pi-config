@echo off
REM Planner half of the planner/executor workflow: Swift 1.5 Qwen3.8-27B (IQ2_XS 64K q4_0 KV, llama\start-swift27-xs-64k.bat) at thinking medium
REM (benchmarked 2026-10-25: same plan quality as xhigh, ~30% faster). For big or vague tasks: pi-plan --thinking xhigh "task"
REM Read-only tools + write; planner.md tells it to write only PLAN.md in the current directory. Then run pi-exec.
REM 2026-10-31: + bash (checks/experiments in $TEMP only, per planner.md) + firecrawl_search/scrape (API docs) so plans
REM   are verified before the executor sees them; planner.md also requires built-in logging + a self-test. Backup: *.bak-20261031-solidplans.
REM Usage: pi-plan "task description" [pi args...]   (add -p to plan non-interactively and exit)
REM Switched from ISTA qwen27-xs-64k to Swift 1.5 on 2026-10-26: same quality, ~half the thinking on vague prompts, fewer
REM runaways at xhigh, ~15-20% slower on agent runs. Backup: *.bak-20261026-swiftswitch.
REM Switched to XeStrata Gyro-S (Qwen3.8-Flash-Next, 128K, C:\XeStrata\start-xestrata-pi.bat) on 2026-10-30. Backup: *.bak-20261030-xestrata.
REM Switched to Kaggle (kaggle/qwen27-q6-mtp: Qwen3.8-27B UD-Q6_K + MTP, 128K, 2x T4 via Cloudflare tunnel) on 2026-10-31.
REM   Needs the Kaggle notebook running + kaggle-set <url> <key>; kaggle-check.ps1 fails fast if it's down. Backup: *.bak-20261031-kaggle.
REM Switched back to Swift 1.5 (local, via llama-swap) on 2026-10-31: the Kaggle tunnel hit Cloudflare 524 timeouts. Backup: *.bak-20261031-swiftback.
REM 2026-10-31 robust: + environment.md (fixed PC facts); planner.md adds a requirements table, PLAN.notes.md working memory,
REM   and a rehearsal of the whole plan in a scratch copy. pi-review then checks it. Backup: *.bak-20261031-robust.
REM Switched to Qwen3.6-35B-A3B AntiLoop (antiloop/qwen3.6-antiloop-local: ROCm + MTP n2, 128K, ~45 tok/s) on 2026-10-31
REM   at Freddy's request. Thinking is on/off + token budget (medium 4096 / low 2048). Backup: *.bak-20261031-antiloop.
REM Switched back to Swift 1.5 (qwen27/swift27-xs-64k, 48K, all in VRAM) on 2026-10-31 at Freddy's request; pi-exec now runs Ornith 9B. Backup: *.bak-20261031-swiftornith.
REM 2026-10-31 small scopes: planner.md plans ONE slice (<=3 requirements, <=5 steps, ~150 lines) and writes the other
REM   slices to PLAN.next.md. "pi-plan" with no task (or only pi flags) plans the next slice from PLAN.next.md, after
REM   archiving a finished PLAN.md to PLAN.done-<n>.md. Rehearsal copy is PLAN.rehearsal/. Backup: *.bak-20261031-scope.
REM pi-plan-swift (2026-11-19): the old Swift 1.5 27B planner, kept as a fallback for when Gyro-S writes code instead of a plan. Same rules as pi-plan.
setlocal
REM No task = no argument that is not a flag (or the value of --thinking/--model/--name). pi-pe passes -p "task",
REM which the old first-argument check took for "no task" (fixed 2026-10-31, backup *.bak-20261031-argfix).
set "NEXTMODE=1"
call :scan %*
if not defined NEXTMODE goto server
if not exist "PLAN.next.md" (
    echo No task given and no PLAN.next.md here. Usage: pi-plan "task"   or   pi-plan TASK.md
    exit /b 1
)
if not exist "PLAN.md" goto server
REM Never overwrite a plan that still has open boxes
findstr /r /c:"^- \[ \]" "PLAN.md" >nul
if not errorlevel 1 (
    echo PLAN.md still has unticked items - run pi-exec to finish it first, or move it away.
    exit /b 1
)
set /a N=1
:nextname
if exist "PLAN.done-%N%.md" (set /a N+=1 & goto nextname)
move /Y "PLAN.md" "PLAN.done-%N%.md" >nul
echo Archived the finished PLAN.md as PLAN.done-%N%.md
:server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-server.ps1" -Bat "__PI_HOME__\llama\start-swift27-xs-64k.bat" -Alias swift27-xs-64k
if errorlevel 1 exit /b 1
set PI="C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --model qwen27/swift27-xs-64k --thinking medium --no-skills --tools "read,grep,find,ls,write,edit,bash,firecrawl_search,firecrawl_scrape" --exclude-tools "ssh-*,call_model,mcp__*" --append-system-prompt "%USERPROFILE%\.pi\bonsai-local.md" --append-system-prompt "%USERPROFILE%\.pi\environment.md" --append-system-prompt "%USERPROFILE%\.pi\planner.md" --name "plan"
REM Full node path, as in pi-durable.cmd: a stray quote in PATH ("...\GitHub CLI"") hides node from cmd's PATH search
REM goto instead of an if-block: a task text with ( ) in %* would break a block
if not defined NEXTMODE goto plain
%PI% %* "Plan the next slice: the FIRST '## Slice' section of PLAN.next.md is your whole task. Read it, then follow the planner rules. When PLAN.md is written, remove that section from PLAN.next.md with the edit tool (keep the other slices); if no slices are left, delete PLAN.next.md."
goto :eof
:plain
%PI% %*
goto :eof

:scan
set "C=%~1"
if not defined C goto :eof
set "C=%C:~0,1%"
if /I "%~1"=="--thinking" goto scanvalue
if /I "%~1"=="--model" goto scanvalue
if /I "%~1"=="--name" goto scanvalue
if "%C%"=="-" goto scannext
set "NEXTMODE="
goto :eof
:scanvalue
shift
:scannext
shift
goto scan
