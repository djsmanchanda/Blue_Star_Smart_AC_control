Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8765
$BaseUrl = "http://127.0.0.1:$Port"
$NodeExe = "node"
$Service = Join-Path $Root "service.js"
$OutLog = Join-Path $Root "server.out.log"
$ErrLog = Join-Path $Root "server.err.log"

function Test-Service {
  try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 1
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Start-ServiceIfNeeded {
  if (Test-Service) {
    return $null
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodeExe
  $startInfo.Arguments = "`"$Service`""
  $startInfo.WorkingDirectory = $Root
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $process.Start() | Out-Null

  $outWriter = [System.IO.StreamWriter]::new($OutLog, $true)
  $errWriter = [System.IO.StreamWriter]::new($ErrLog, $true)
  $process.add_OutputDataReceived({
    if ($EventArgs.Data) {
      $outWriter.WriteLine($EventArgs.Data)
      $outWriter.Flush()
    }
  })
  $process.add_ErrorDataReceived({
    if ($EventArgs.Data) {
      $errWriter.WriteLine($EventArgs.Data)
      $errWriter.Flush()
    }
  })
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Service) {
      return $process
    }
  }
  throw "The local service did not start. Check $ErrLog."
}

function Send-DeviceCommand($deviceId, $command, $value = $null) {
  $payload = @{ command = $command }
  if ($null -ne $value) {
    $payload.value = $value
  }
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/devices/$deviceId/commands" -ContentType "application/json" -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 15 | Out-Null
}

function Get-ACTemperature {
  $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/devices/ac/status" -TimeoutSec 20
  $temperature = $response.status.state.stemp
  if ($null -eq $temperature) {
    return 24
  }
  return [double]$temperature
}

function Change-ACTemperature($delta) {
  $temperature = Get-ACTemperature
  Send-DeviceCommand "ac" "setTemperature" ($temperature + $delta)
}

function New-TrayIcon {
  $bitmap = New-Object System.Drawing.Bitmap 32, 32
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(36, 99, 169))
  $graphics.FillEllipse($brush, 2, 2, 28, 28)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 3
  $graphics.DrawLine($pen, 10, 16, 22, 16)
  $graphics.DrawLine($pen, 16, 10, 16, 22)
  $iconHandle = $bitmap.GetHicon()
  return [System.Drawing.Icon]::FromHandle($iconHandle)
}

$serviceProcess = Start-ServiceIfNeeded

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = New-TrayIcon
$notifyIcon.Text = "AC Control"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add("Open control panel")
$openItem.Add_Click({ Start-Process "$BaseUrl/" })

$menu.Items.Add("-") | Out-Null

$acOn = $menu.Items.Add("AC on")
$acOn.Add_Click({ Send-DeviceCommand "ac" "turnOn" })

$acOff = $menu.Items.Add("AC off")
$acOff.Add_Click({ Send-DeviceCommand "ac" "turnOff" })

$tempUp = $menu.Items.Add("Increase temp by 1 C")
$tempUp.Add_Click({ Change-ACTemperature 1 })

$tempDown = $menu.Items.Add("Decrease temp by 1 C")
$tempDown.Add_Click({ Change-ACTemperature -1 })

$menu.Items.Add("-") | Out-Null

$reload = $menu.Items.Add("Reload config")
$reload.Add_Click({ Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/reload" -TimeoutSec 5 | Out-Null })

$quit = $menu.Items.Add("Quit")
$quit.Add_Click({
  $notifyIcon.Visible = $false
  if ($serviceProcess -and -not $serviceProcess.HasExited) {
    $serviceProcess.Kill()
  }
  [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Add_DoubleClick({ Start-Process "$BaseUrl/" })

[System.Windows.Forms.Application]::Run()
