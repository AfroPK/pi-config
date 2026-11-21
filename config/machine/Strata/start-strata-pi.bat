@echo off
REM Strata Gyro-S server for Pi (pi-strata / ensure-server.ps1): same as run-gyro-gyro-s.bat without opening the browser.
title Strata gyro-Gyro-S
cd /d "C:\Strata"
"C:\Strata\.venv\Scripts\python.exe" "C:\Strata\serve\server.py" "--engine" "strata" "--config" "C:\Strata\strata-gyro-gyro-s.json" "--port" "8080"
if errorlevel 1 pause
