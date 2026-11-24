@echo off
title Zigmaa Moments - Dev Mode (Hot Reload)

echo ========================================================
echo       ZIGMAA MOMENTS - DEVELOPMENT MODE (HOT RELOAD)
echo ========================================================
echo.

set ROOT_DIR=%~dp0

:: Free ports 3001 and 8001 if previously occupied by stale processes
echo [0/2] Checking and freeing ports 3001 and 8001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8001" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [1/2] Starting Backend (:8001)...
if exist "%ROOT_DIR%backend\.venv\Scripts\uvicorn.exe" (
    start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8001"
) else (
    start "Zigmaa Backend (:8001)" cmd /k "cd /d %ROOT_DIR%backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8001"
)

echo [2/2] Starting Frontend in Dev Mode (:3001)...
start "Zigmaa Frontend Dev (:3001)" cmd /k "cd /d %ROOT_DIR%frontend && npm run dev -- -p 3001"

echo.
echo ========================================================
echo  Services started in Development Mode!
echo  Backend:   http://localhost:8001
echo  Frontend:  http://localhost:3001
echo ========================================================
echo.
timeout /t 3 /nobreak >nul
start http://localhost:3001

echo Press any key to close this launcher window.
pause >nul
