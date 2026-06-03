param(
  [int]$Seconds = 45,
  [string]$Package = "com.bluestarindia.bluesmart"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb was not found on PATH."
}

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "reverse"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $outDir "bluestar-logcat-$stamp.log"

adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 2
adb logcat -c

Write-Host "Capture started: $outFile"
Write-Host "Use the Blue Star app now: power off, power on, set 24 C, then wait for the timer to finish."

$job = Start-Job -ScriptBlock {
  param($PackageName)
  adb logcat -v time |
    Select-String -Pattern $PackageName, "AWSIotMqttManager", "MqttClientManager", "OkHttp", "Retrofit", "things/", "shadow/update", "/things/"
} -ArgumentList $Package

Start-Sleep -Seconds $Seconds
Stop-Job $job -ErrorAction SilentlyContinue
Receive-Job $job | ForEach-Object { $_.Line } | Set-Content -Encoding UTF8 -Path $outFile
Remove-Job $job -Force -ErrorAction SilentlyContinue

Write-Host "Capture finished: $outFile"
