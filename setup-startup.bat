@echo off
setlocal

set "APP_DIR=%~dp0"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AC Control Tray.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell; " ^
  "$shortcut = $shell.CreateShortcut('%SHORTCUT%'); " ^
  "$shortcut.TargetPath = '%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe'; " ^
  "$shortcut.Arguments = '-STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ''%APP_DIR%tray.ps1'''; " ^
  "$shortcut.WorkingDirectory = '%APP_DIR%'; " ^
  "$shortcut.IconLocation = 'powershell.exe,0'; " ^
  "$shortcut.Save()"

if errorlevel 1 (
  echo Failed to install AC Control startup shortcut.
  exit /b 1
)

echo Installed AC Control tray startup shortcut:
echo %SHORTCUT%
echo It will start automatically after the next Windows sign-in.
