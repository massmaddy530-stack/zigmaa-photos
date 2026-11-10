@echo off
setlocal enabledelayedexpansion
title Zigmaa Photos - Camera Auto Sync

echo ===================================================
echo       Zigmaa Photos - Camera Auto Sync Agent
echo ===================================================
echo.

set ROOT_DIR=%~dp0
set AGENT_DIR=%ROOT_DIR%ingestion-agent

if not exist "%AGENT_DIR%\.venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found in %AGENT_DIR%\.venv
    echo Please ensure ingestion-agent dependencies are installed.
    pause
    exit /b 1
)

set /p EV_INPUT="Paste Event ID or Event URL: "
if "%EV_INPUT%"=="" (
    echo [ERROR] Event ID cannot be empty!
    pause
    exit /b 1
)

:: Extract UUID if user pasted a full URL like https://.../dashboard/events/<uuid>
set EVENT_ID=%EV_INPUT%
for %%A in (%EV_INPUT:/= %) do set EVENT_ID=%%A

set /p FOLDER_INPUT="Enter Folder to watch (Press Enter for C:\EventPhotos): "
if "%FOLDER_INPUT%"=="" set FOLDER_INPUT=C:\EventPhotos

if not exist "%FOLDER_INPUT%" (
    echo Creating folder: %FOLDER_INPUT%
    mkdir "%FOLDER_INPUT%" 2>nul
)

set API_URL=https://zigmaa-photos.onrender.com
set INGEST_KEY=HbwzKQUT3Jeg63DZz6xwsc9NkJ8SAOSH9KOP_e8AJIk

set CAMERA_SOURCE=folder
set WATCH_FOLDER=%FOLDER_INPUT%
set EVENT_ID=%EVENT_ID%
set API_BASE_URL=%API_URL%
set INGEST_API_KEY=%INGEST_KEY%
set FOLDER_RECURSIVE=true
set FILE_STABLE_SECONDS=2

echo.
echo ---------------------------------------------------
echo  Event ID:      %EVENT_ID%
echo  Watch Folder:  %WATCH_FOLDER%
echo  Server:        %API_BASE_URL%
echo ---------------------------------------------------
echo [READY] Every photo saved to %WATCH_FOLDER% will auto-upload!
echo Keep this window open during the event. (Press Ctrl+C to stop)
echo ---------------------------------------------------
echo.

cd /d "%AGENT_DIR%"
"%AGENT_DIR%\.venv\Scripts\python.exe" -m zigmaa_agent run

pause
