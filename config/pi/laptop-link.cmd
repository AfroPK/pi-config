@echo off
REM Let Pi on the Omarchy laptop use this PC's models via an SSH reverse tunnel. Usage: laptop-link [stop]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0laptop-link.ps1" %*
