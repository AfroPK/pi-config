@echo off
REM Pi Agent Multi-Model Launcher (trimmed to 3 local models 2026-11-19, backup *.bak-20261119-3models; cleaned up 2026-11-02: only models in use; old menu in pi-models.cmd.bak-20261102-cleanup)
REM Usage: pi-models [model] [pi args...]      (no model = plain pi with the default, Strata Gyro-S)
REM   strata    - Qwen3.8-Flash-Next Gyro-S on Strata (64K ctx, ~25 tok/s, sees images)
REM   qwen36    - Qwen3.6 35B-A3B UD-IQ3_XXS, experts partly in RAM, 128K ctx, ~55 tok/s (fast coder)
REM   plan / review / exec - pi-plan (Gyro-S, writes PLAN.md) / pi-review (Gyro-S) / pi-exec (Qwen3.6 IQ3); pi-pe "task" chains them
REM   plan-swift - pi-plan on Swift 1.5 27B (fallback planner)
REM   loop      - pi-loop: plan -> review -> exec -> code-review, unattended
REM   kaggle / kaggle-strata - remote Kaggle notebooks (need the notebook running + kaggle-set / kaggle-strata-set)

REM Full node path, as in pi-durable.cmd: a stray quote in PATH ("...\GitHub CLI"") hides node from cmd's PATH search
set PI_CMD="C:\Program Files\nodejs\node.exe" "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"
REM REST = all args after the first, quotes preserved ("shift" alone does not change %*)
set "HERE=%~dp0"
set "MODE=%~1"
set REST=
:collect
shift
if "%~1"=="" goto collected
set REST=%REST% %1
goto collect
:collected

if /I "%MODE%"=="strata" (call "%HERE%pi-strata.cmd" %REST% & goto :eof)
if /I "%MODE%"=="qwen36" (call "%HERE%pi-qwen36.cmd" %REST% & goto :eof)
if /I "%MODE%"=="plan" (call "%HERE%pi-plan.cmd" %REST% & goto :eof)
if /I "%MODE%"=="review" (call "%HERE%pi-review.cmd" %REST% & goto :eof)
if /I "%MODE%"=="plan-swift" (call "%HERE%pi-plan-swift.cmd" %REST% & goto :eof)
if /I "%MODE%"=="exec" (call "%HERE%pi-exec.cmd" %REST% & goto :eof)
if /I "%MODE%"=="loop" (call "%HERE%pi-loop.cmd" %REST% & goto :eof)
if /I "%MODE%"=="kaggle" (call "%HERE%pi-kaggle.cmd" %REST% & goto :eof)
if /I "%MODE%"=="kaggle-strata" (call "%HERE%pi-kaggle-strata.cmd" %REST% & goto :eof)

REM Default: use the configured default model
%PI_CMD% %*
