@echo off
title Zigmaa Photos
echo ========================================================
echo  Starting Zigmaa Photos
echo  Backend:  http://localhost:8001 (Docs: /docs)
echo  Frontend: http://localhost:3001 (Admin: /login)
echo ========================================================
echo.

start "Zigmaa Photos - Backend (:8001)" cmd /k "cd /d %~dp0backend && .venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8001"
start "Zigmaa Photos - Frontend (:3001)" cmd /k "cd /d %~dp0frontend && npx next start -p 3001"

echo Both services started in separate windows!
echo Admin Credentials:
echo   Username: admin
echo   Password: Admin12345678!
echo.
pause

