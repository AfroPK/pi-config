@echo off
REM Update Pi's kaggle-strata provider with a new Kaggle Strata session's URL + key. Usage: kaggle-strata-set <base-url> <api-key> [ctx]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kaggle-strata-set.ps1" %*
