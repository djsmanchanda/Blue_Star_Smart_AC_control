$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "AC Control Tray.lnk"
$launcher = Join-Path $root "launch-tray.vbs"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$shortcut.Arguments = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") + ",0"
$shortcut.Save()

Write-Host "Installed AC Control tray startup shortcut:"
Write-Host $shortcutPath
