@echo off
setlocal

set "APP_DIR=%~dp0"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AC Control Tray.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%install-startup.ps1"

if errorlevel 1 (
  echo Failed to install AC Control startup shortcut.
  exit /b 1
)

echo Installed AC Control tray startup shortcut:
echo %SHORTCUT%
echo It will start automatically after the next Windows sign-in.
