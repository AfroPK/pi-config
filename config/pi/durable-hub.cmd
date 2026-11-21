@echo off
REM Durable Pi web UI (on the HomeLab) using this PC's models. Usage: durable-hub [qwen38|bonsai|stop]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0durable-hub.ps1" %*
