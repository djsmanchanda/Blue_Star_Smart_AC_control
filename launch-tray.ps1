$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TrayScript = Join-Path $Root "tray.ps1"
$LogPath = Join-Path $Root "tray-startup.log"

function Write-StartupLog($message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $LogPath -Value "[$timestamp] $message"
}

try {
  Write-StartupLog "Starting AC Control tray from $TrayScript"

  if (-not (Test-Path -LiteralPath $TrayScript)) {
    throw "Tray script not found: $TrayScript"
  }

  & $TrayScript
  Write-StartupLog "Tray script exited normally."
} catch {
  Write-StartupLog ("Tray startup failed: " + $_.Exception.Message)
  Write-StartupLog $_.ScriptStackTrace
  throw
}
