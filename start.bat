@echo off
setlocal enabledelayedexpansion
title Corridor Health Monitor — Launching...
echo ======================================================================
echo  CORRIDOR HEALTH MONITOR — NOVO NORDISK GBS
echo  Single-Click Clean Launch Engine
echo ======================================================================
echo.

:: 1. Navigate to script directory
cd /d "%~dp0"
if exist "cipher-corridor-monitor" cd cipher-corridor-monitor

:: 2. Kill any process occupying port 8000
echo [1/4] Freeing Port 8000 (terminating existing listeners)...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Terminating conflicting process PID %%a on port 8000...
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: 3. Verify Python dependencies
echo [2/4] Verifying Python runtime and core dependencies...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 (
    echo [NOTE] Continuing with existing environment packages...
)

:: 4. Ensure dashboard_data.json exists
echo [3/4] Verifying analytical dataset cache...
if not exist "backend\dashboard_data.json" (
    echo Generating initial corridor analytical dataset from parquet...
    python backend\generate_dashboard_data.py
)

:: 5. Launch server and open browser
echo [4/4] Launching application on http://localhost:8000...
start "" http://localhost:8000/
python backend\server.py

if errorlevel 1 (
    echo.
    echo Server exited. Press any key to close.
    pause >nul
)
