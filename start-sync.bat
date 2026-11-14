@echo off
setlocal enabledelayedexpansion
title Zigmaa Photos - Camera Auto Sync
echo ===================================================
echo       Zigmaa Photos - Camera Auto Sync Agent
echo ===================================================
echo.

set ROOT_DIR=%~dp0
set EXE_PATH=%ROOT_DIR%Zigmaa-Camera-Sync.exe

:: Unblock to ensure smooth execution without SmartScreen warnings
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%EXE_PATH%' -ErrorAction SilentlyContinue"

if exist "%EXE_PATH%" (
    echo Starting standalone sync agent...
    "%EXE_PATH%"
    exit /b %errorlevel%
)

:: Fallback to python venv if running from source tree
set AGENT_DIR=%ROOT_DIR%ingestion-agent
if exist "%AGENT_DIR%\.venv\Scripts\python.exe" (
    echo [DEV MODE] Running via Python environment...
    cd /d "%AGENT_DIR%"
    set PYTHONPATH=%AGENT_DIR%
    "%AGENT_DIR%\.venv\Scripts\python.exe" -m zigmaa_agent.ftp_sync
    exit /b %errorlevel%
)

echo [ERROR] Neither Zigmaa-Camera-Sync.exe nor Python environment was found.
echo Please run Install-Zigmaa-Sync.bat first.
pause
