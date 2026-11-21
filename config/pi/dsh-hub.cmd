@echo off
REM DeepSeek Harness web UI (on the HomeLab) via an SSH tunnel. Usage: dsh-hub [stop]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-hub.ps1" %*
