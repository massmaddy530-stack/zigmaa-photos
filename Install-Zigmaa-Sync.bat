@echo off
setlocal
echo ========================================================
echo        Zigmaa Photos - Camera Sync Setup / Installer
echo ========================================================
echo.
set "CURRENT_DIR=%~dp0"
set "EXE_PATH=%CURRENT_DIR%Zigmaa-Camera-Sync.exe"
set "ICON_PATH=%CURRENT_DIR%ingestion-agent\zigmaa_icon.ico"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP_DIR%\Zigmaa Camera Sync.lnk"

if not exist "%EXE_PATH%" (
    echo [ERROR] Zigmaa-Camera-Sync.exe not found in %CURRENT_DIR%
    pause
    exit /b 1
)

echo Creating Desktop Shortcut: "%SHORTCUT_PATH%" ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%EXE_PATH%'; $s.WorkingDirectory = '%CURRENT_DIR%'; if (Test-Path '%ICON_PATH%') { $s.IconLocation = '%ICON_PATH%' }; $s.Save()"

echo.
echo [SUCCESS] Zigmaa Camera Sync is ready on your Desktop!
echo You can now double-click "Zigmaa Camera Sync" on your Desktop to start sync.
echo.
pause
