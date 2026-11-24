@echo off
setlocal enabledelayedexpansion
title Zigmaa Moments - Starting...

echo ========================================================
echo               ZIGMAA MOMENTS - LOCAL LAUNCHER
echo ========================================================
echo.

set ROOT_DIR=%~dp0

:: 1. Ensure Frontend Production Build exists
if not exist "%ROOT_DIR%frontend\.next\BUILD_ID" (
    echo [INFO] First-time setup: Building frontend for production...
    echo This may take about 30 seconds. Please wait...
    echo.
    cd /d "%ROOT_DIR%frontend"
    call npm run build
    if errorlevel 1 (
        echo.
        echo [WARNING] Production build failed. Falling back to development mode...
        cd /d "%ROOT_DIR%"
        goto :dev_launch
    )
    cd /d "%ROOT_DIR%"
)

echo [1/2] Starting Backend (:8001)...
if exist "%ROOT_DIR%backend\.venv\Scripts\uvicorn.exe" (
    start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8001"
) else if exist "%ROOT_DIR%backend\.venv\Scripts\python.exe" (
    start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001"
) else (
    start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && uvicorn app.main:app --host 0.0.0.0 --port 8001"
)

echo [2/2] Starting Frontend (:3001)...
start "Zigmaa Frontend (:3001)" cmd /k "cd /d %ROOT_DIR%frontend && npm start -- -p 3001"

goto :finish

:dev_launch
echo [1/2] Starting Backend (:8001)...
start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8001"
echo [2/2] Starting Frontend in Dev Mode (:3001)...
start "Zigmaa Frontend (:3001)" cmd /k "cd /d %ROOT_DIR%frontend && npm run dev -- -p 3001"

:finish
echo.
echo ========================================================
echo  All Services Started!
echo  Backend:   http://localhost:8001 (Docs: /docs)
echo  Frontend:  http://localhost:3001
echo ========================================================
echo.
echo Admin Login:
echo   Username: admin
echo   Password: Masthan@08
echo   (Or use your registered Google email)
echo.
echo Opening browser to http://localhost:3001 in 3 seconds...
timeout /t 3 /nobreak >nul
start http://localhost:3001

echo.
echo Press any key to close this launcher window (services keep running).
pause >nul
