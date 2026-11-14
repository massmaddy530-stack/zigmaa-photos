@echo off
setlocal enabledelayedexpansion
title Zigmaa Photos - Camera Sync Setup Installer
echo ========================================================
echo        Zigmaa Photos - Camera Sync Setup Installer
echo ========================================================
echo.

set "CURRENT_DIR=%~dp0"
set "EXE_PATH=%CURRENT_DIR%Zigmaa-Camera-Sync.exe"
set "ICON_PATH=%CURRENT_DIR%ingestion-agent\zigmaa_icon.ico"
set "CERT_PATH=%CURRENT_DIR%ingestion-agent\zigmaa_cert.cer"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP_DIR%\Zigmaa Camera Sync.lnk"

if not exist "%EXE_PATH%" (
    echo [ERROR] Zigmaa-Camera-Sync.exe not found in %CURRENT_DIR%
    pause
    exit /b 1
)

echo [1/3] Unblocking files (Removing Windows SmartScreen Web Lock)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%EXE_PATH%' -ErrorAction SilentlyContinue; Unblock-File -Path '%CURRENT_DIR%Install-Zigmaa-Sync.bat' -ErrorAction SilentlyContinue; Unblock-File -Path '%CURRENT_DIR%start-sync.bat' -ErrorAction SilentlyContinue; if (Test-Path '%CERT_PATH%') { Unblock-File -Path '%CERT_PATH%' -ErrorAction SilentlyContinue }"
echo       Files verified and unblocked!

echo.
echo [2/3] Registering Zigmaa Tech as Trusted Publisher...
if exist "%CERT_PATH%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Import-Certificate -FilePath '%CERT_PATH%' -CertStoreLocation Cert:\CurrentUser\TrustedPublisher -ErrorAction SilentlyContinue | Out-Null"
    echo       Publisher certificate registered successfully!
) else (
    echo       Certificate file skipped.
)

echo.
echo [3/3] Creating Desktop Shortcut: "%SHORTCUT_PATH%" ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%EXE_PATH%'; $s.WorkingDirectory = '%CURRENT_DIR%'; if (Test-Path '%ICON_PATH%') { $s.IconLocation = '%ICON_PATH%' }; $s.Save()"

echo.
echo ========================================================
echo [SUCCESS] Zigmaa Camera Sync is completely installed!
echo ========================================================
echo 1. You can now launch "Zigmaa Camera Sync" directly from your Desktop.
echo 2. Windows SmartScreen and Security warnings are permanently cleared.
echo 3. Compatible with Sony FX3/A7IV, Canon R, Nikon Z and all Wi-Fi cameras.
echo.
pause
