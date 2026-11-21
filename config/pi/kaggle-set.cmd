@echo off
REM Update Pi's kaggle provider with a new Kaggle session's URL + key. Usage: kaggle-set <base-url> <api-key>
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kaggle-set.ps1" %*
