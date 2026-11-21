@echo off
REM Durable local agent (Pi Durable + local llama.cpp). Keeps working until the task is done, resumes after crashes.
REM   pi-durable "build a flask todo app with tests"            (runs in the current folder, Qwen3.8)
REM   pi-durable --model bonsai --thinking off "task"
REM   pi-durable --cwd D:/AIWorkspace/Chess3.0 "task"       (in Git Bash use forward slashes or quotes: \ is an escape there)
REM   pi-durable --id task-2026-10-22T20-15-00                   (resume a task)
REM Task logs/state: %USERPROFILE%\.pi-durable\tasks   Code: __PI_HOME__\pi-durable-agent
"C:\Program Files\nodejs\node.exe" "__PI_HOME__\pi-durable-agent\supervise.ts" %*
