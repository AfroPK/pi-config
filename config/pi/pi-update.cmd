@echo off
REM Safe Pi / extension update wrapper: backs up key configs, runs `pi update`,
REM verifies/reapplies local package patches, and runs `verify-pi-compat.mjs`.
REM Usage: pi-update [--extensions | --all | ...]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pi-update.ps1" %*
