Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TrayNative {
  [DllImport("shcore.dll")]
  private static extern int SetProcessDpiAwareness(int value);

  [DllImport("user32.dll")]
  private static extern bool SetProcessDPIAware();

  [DllImport("dwmapi.dll")]
  private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

  public static void EnableDpiAwareness() {
    try {
      if (SetProcessDpiAwareness(2) == 0) {
        return;
      }
    } catch {}
    try {
      SetProcessDPIAware();
    } catch {}
  }

  public static void ApplyDarkRounded(IntPtr hwnd) {
    int dark = 1;
    DwmSetWindowAttribute(hwnd, 20, ref dark, sizeof(int));
    int round = 2;
    DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int));
  }
}
"@
[TrayNative]::EnableDpiAwareness()
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8765
$BaseUrl = "http://127.0.0.1:$Port"
$NodeExe = "node"
$Service = Join-Path $Root "service.js"
$OutLog = Join-Path $Root "server.out.log"
$ErrLog = Join-Path $Root "server.err.log"
$script:serviceProcess = $null
$script:ServiceReady = $false
$script:ServiceStartupError = $null

function Test-Service {
  try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 1
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Test-ServicePort {
  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(150)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) {
      $client.Close()
    }
  }
}

function Start-ServiceProcessIfNeeded {
  if (Test-ServicePort) {
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

  return $process
}

function Begin-ServiceStartup {
  try {
    $script:serviceProcess = Start-ServiceProcessIfNeeded
  } catch {
    $script:ServiceStartupError = $_.Exception.Message
  }
}

function Send-DeviceCommand($deviceId, $command, $value = $null) {
  $payload = @{ command = $command }
  if ($null -ne $value) {
    $payload.value = $value
  }
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/devices/$deviceId/commands" -ContentType "application/json" -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 15 | Out-Null
}

function Get-ACTemperature {
  $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/devices/ac/status" -TimeoutSec 5
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

function Toggle-ACDisplay {
  $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/devices/ac/status" -TimeoutSec 5
  $display = $response.status.state.display
  if ($display -eq 1) {
    Send-DeviceCommand "ac" "setDisplay" 0
  } else {
    Send-DeviceCommand "ac" "setDisplay" 1
  }
}

function Get-ACState {
  try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/devices/ac/status" -TimeoutSec 5
    return $response.status.state
  } catch {
    return $null
  }
}

function Set-CapacityProfile($eco, $esave = 0, $turbo = 0, $fanSpeed = $null, $temperature = $null) {
  $value = @{
    eco = $eco
    esave = $esave
    turbo = $turbo
  }
  if ($null -ne $fanSpeed) {
    $value.fspd = $fanSpeed
  }
  if ($null -ne $temperature) {
    $value.stemp = $temperature
  }
  Send-DeviceCommand "ac" "setCapacityProfile" $value
}

# --- Tray icon ---

function New-RoundedRectPath($x, $y, $width, $height, $radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc(($x + $width - $diameter), $y, $diameter, $diameter, 270, 90)
  $path.AddArc(($x + $width - $diameter), ($y + $height - $diameter), $diameter, $diameter, 0, 90)
  $path.AddArc($x, ($y + $height - $diameter), $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-TrayIcon {
  $bitmap = New-Object System.Drawing.Bitmap 64, 64
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = 64 / 44
  $offset = -2 * $scale
  $yOffset = 4
  $blackPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), (3.4 * $scale)
  $blackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $blackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $blackPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $blueBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(47, 136, 255))

  $outer = New-RoundedRectPath ($offset + (4 * $scale)) ($yOffset + $offset + (8 * $scale)) (40 * $scale) (20 * $scale) (2 * $scale)
  $inner = New-RoundedRectPath ($offset + (12 * $scale)) ($yOffset + $offset + (20 * $scale)) (24 * $scale) (8 * $scale) (1 * $scale)

  $graphics.FillPath($whiteBrush, $outer)
  $graphics.DrawPath($blackPen, $outer)
  $graphics.FillPath($blueBrush, $inner)
  $graphics.DrawPath($blackPen, $inner)
  $graphics.DrawLine($blackPen, ($offset + (32 * $scale)), ($yOffset + $offset + (14 * $scale)), ($offset + (36 * $scale)), ($yOffset + $offset + (14 * $scale)))
  $graphics.DrawLine($blackPen, ($offset + (24 * $scale)), ($yOffset + $offset + (34 * $scale)), ($offset + (24 * $scale)), ($yOffset + $offset + (40 * $scale)))
  $graphics.DrawLine($blackPen, ($offset + (16 * $scale)), ($yOffset + $offset + (36 * $scale)), ($offset + (16 * $scale)), ($yOffset + $offset + (38 * $scale)))
  $graphics.DrawLine($blackPen, ($offset + (32 * $scale)), ($yOffset + $offset + (36 * $scale)), ($offset + (32 * $scale)), ($yOffset + $offset + (38 * $scale)))

  $iconHandle = $bitmap.GetHicon()
  return [System.Drawing.Icon]::FromHandle($iconHandle)
}

# --- Theme colours ---

$ColWidth   = 140
$BtnHeight  = 30
$MenuBack   = [System.Drawing.Color]::FromArgb(43, 43, 43)
$MenuHover  = [System.Drawing.Color]::FromArgb(61, 61, 61)
$MenuPress  = [System.Drawing.Color]::FromArgb(53, 53, 53)
$MenuFore   = [System.Drawing.Color]::FromArgb(251, 251, 251)
$MenuMuted  = [System.Drawing.Color]::FromArgb(154, 154, 154)
$ActiveBack = [System.Drawing.Color]::FromArgb(14, 50, 34)
$ActiveFore = [System.Drawing.Color]::FromArgb(96, 210, 130)
$SepColor   = [System.Drawing.Color]::FromArgb(56, 56, 56)
$Deg        = [char]0x00B0   # ° (degree sign, avoids encoding issues)
$ButtonFont = New-Object System.Drawing.Font "Segoe UI", 9, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Point)
$HeaderFont = New-Object System.Drawing.Font "Segoe UI", 8, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Point)

# --- NotifyIcon ---

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = New-TrayIcon
$notifyIcon.Text = "AC Control"
$notifyIcon.Visible = $true
$notifyIcon.BalloonTipTitle = "AC Control"
$notifyIcon.BalloonTipText = "AC Control is running in the system tray."
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info

# Start the local service only after the tray is visible. Keeping this out of
# the pre-icon path avoids hiding tray startup behind Node boot and health polls.
Begin-ServiceStartup

# --- Popup form ---

$PanelW = $ColWidth + 4           # button + margin
$Gap    = 8
$FormW  = 8 + $PanelW + $Gap + $PanelW + $Gap + $PanelW + 8

$script:TrayPopup = New-Object System.Windows.Forms.Form
$script:TrayPopup.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$script:TrayPopup.ShowInTaskbar = $false
$script:TrayPopup.TopMost = $true
$script:TrayPopup.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$script:TrayPopup.BackColor = $MenuBack
$script:TrayPopup.Width = $FormW
$script:TrayPopup.Padding = New-Object System.Windows.Forms.Padding 8
$script:TrayPopup.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$script:TrayPopup.Font = $ButtonFont
$script:TrayPopup.Add_Shown({ [TrayNative]::ApplyDarkRounded($script:TrayPopup.Handle) })

# --- Three column panels ---

$leftPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$leftPanel.Location = New-Object System.Drawing.Point 8, 8
$leftPanel.Width = $PanelW
$leftPanel.AutoSize = $true
$leftPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::TopDown
$leftPanel.WrapContents = $false
$leftPanel.BackColor = $MenuBack
$script:TrayPopup.Controls.Add($leftPanel)

$rightPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$rightPanel.Location = New-Object System.Drawing.Point (8 + $PanelW + $Gap), 8
$rightPanel.Width = $PanelW
$rightPanel.AutoSize = $true
$rightPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::TopDown
$rightPanel.WrapContents = $false
$rightPanel.BackColor = $MenuBack
$script:TrayPopup.Controls.Add($rightPanel)

$swingPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$swingPanel.Location = New-Object System.Drawing.Point (8 + (($PanelW + $Gap) * 2)), 8
$swingPanel.Width = $PanelW
$swingPanel.AutoSize = $true
$swingPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::TopDown
$swingPanel.WrapContents = $false
$swingPanel.BackColor = $MenuBack
$script:TrayPopup.Controls.Add($swingPanel)

# --- UI helpers ---

function New-PopupButton($text, $onClick) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $text
  $button.Width = $ColWidth
  $button.Height = $BtnHeight
  $button.Margin = New-Object System.Windows.Forms.Padding 2, 1, 2, 1
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 0
  $button.FlatAppearance.MouseOverBackColor = $MenuHover
  $button.FlatAppearance.MouseDownBackColor = $MenuPress
  $button.BackColor = $MenuBack
  $button.ForeColor = $MenuFore
  $button.Font = $ButtonFont
  $button.UseCompatibleTextRendering = $false
  $button.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
  $button.Padding = New-Object System.Windows.Forms.Padding 6, 0, 4, 0
  $button | Add-Member -MemberType NoteProperty -Name LabelText -Value $text
  $button | Add-Member -MemberType NoteProperty -Name Action -Value $onClick
  $button.Add_Click({
    param($sender, $eventArgs)
    $script:TrayPopup.Hide()
    if ($sender.Action -is [scriptblock]) {
      & $sender.Action
    }
  })
  return $button
}

function Add-PopupHeader($panel, $text) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.AutoSize = $false
  $label.Width = $ColWidth
  $label.Height = 18
  $label.Margin = New-Object System.Windows.Forms.Padding 2, 8, 2, 2
  $label.ForeColor = $MenuMuted
  $label.Font = $HeaderFont
  $label.UseCompatibleTextRendering = $false
  $label.Padding = New-Object System.Windows.Forms.Padding 6, 0, 0, 0
  $panel.Controls.Add($label)
}

function Add-PopupSeparator($panel) {
  $sep = New-Object System.Windows.Forms.Panel
  $sep.Height = 1
  $sep.Width = ($ColWidth - 16)
  $sep.BackColor = $SepColor
  $sep.Margin = New-Object System.Windows.Forms.Padding 10, 6, 10, 6
  $panel.Controls.Add($sep)
}

function Set-PopupButtonState($button, $isActive) {
  $label = [string]$button.LabelText
  if ($isActive) {
    $button.Text = "$([char]0x25CF)  $label"
    $button.BackColor = $ActiveBack
    $button.ForeColor = $ActiveFore
  } else {
    $button.Text = "   $label"
    $button.BackColor = $MenuBack
    $button.ForeColor = $MenuFore
  }
}

# =============================================
#  LEFT COLUMN: Open  |  Power  |  Fan
# =============================================

$openButton = New-PopupButton "Open panel" { Start-Process "$BaseUrl/" }
$leftPanel.Controls.Add($openButton)

Add-PopupSeparator $leftPanel

Add-PopupHeader $leftPanel "POWER"
$powerOnButton   = New-PopupButton "On"          { Send-DeviceCommand "ac" "turnOn" }
$powerOffButton  = New-PopupButton "Off"         { Send-DeviceCommand "ac" "turnOff" }
$displayOnButton  = New-PopupButton "Display on"  { Send-DeviceCommand "ac" "setDisplay" 1 }
$displayOffButton = New-PopupButton "Display off" { Send-DeviceCommand "ac" "setDisplay" 0 }
$leftPanel.Controls.AddRange(@($powerOnButton, $powerOffButton, $displayOnButton, $displayOffButton))

Add-PopupSeparator $leftPanel

Add-PopupHeader $leftPanel "FAN"
$fanLowButton    = New-PopupButton "Low"    { Send-DeviceCommand "ac" "setFanSpeed" 2 }
$fanMediumButton = New-PopupButton "Medium" { Send-DeviceCommand "ac" "setFanSpeed" 3 }
$fanHighButton   = New-PopupButton "High"   { Send-DeviceCommand "ac" "setFanSpeed" 4 }
$fanTurboButton  = New-PopupButton "Turbo"  { Send-DeviceCommand "ac" "setFanSpeed" 6 }
$fanAutoButton   = New-PopupButton "Auto"   { Send-DeviceCommand "ac" "setFanSpeed" 7 }
$leftPanel.Controls.AddRange(@($fanLowButton, $fanMediumButton, $fanHighButton, $fanTurboButton, $fanAutoButton))

# =============================================
#  RIGHT COLUMN: Temperature  |  Profile
# =============================================

Add-PopupHeader $rightPanel "TEMPERATURE"
$rightPanel.Controls.AddRange(@(
  (New-PopupButton "Temp +1 ${Deg}C" { Change-ACTemperature 1 }),
  (New-PopupButton "Temp -1 ${Deg}C" { Change-ACTemperature -1 })
))

Add-PopupSeparator $rightPanel

Add-PopupHeader $rightPanel "PROFILE"
$profileDefaultButton = New-PopupButton "Default" { Set-CapacityProfile 0 0 0 }
$profile100Button     = New-PopupButton "100%"    { Set-CapacityProfile 1 0 0 }
$profile80Button      = New-PopupButton "80%"     { Set-CapacityProfile 2 0 0 }
$profile60Button      = New-PopupButton "60%"     { Set-CapacityProfile 3 0 0 }
$profile40Button      = New-PopupButton "40%"     { Set-CapacityProfile 4 0 0 }
$profileEcoButton     = New-PopupButton "Eco"     { Set-CapacityProfile 0 1 0 }
$profileTurboButton   = New-PopupButton "Turbo"   { Set-CapacityProfile 0 0 3 6 "16.0" }
$rightPanel.Controls.AddRange(@($profileDefaultButton, $profile100Button, $profile80Button, $profile60Button, $profile40Button, $profileEcoButton, $profileTurboButton))

# =============================================
#  SWING COLUMN: Horizontal  |  Vertical  |  System
# =============================================

Add-PopupHeader $swingPanel "HORIZONTAL SWING"
$horizontalSwingOnButton  = New-PopupButton "On"  { Send-DeviceCommand "ac" "setHorizontalSwing" 0 }
$horizontalSwingOffButton = New-PopupButton "Off" { Send-DeviceCommand "ac" "setHorizontalSwing" 6 }
$swingPanel.Controls.AddRange(@($horizontalSwingOnButton, $horizontalSwingOffButton))

Add-PopupSeparator $swingPanel

Add-PopupHeader $swingPanel "VERTICAL SWING"
$verticalSwingSweepButton = New-PopupButton "Swing" { Send-DeviceCommand "ac" "setVerticalSwing" 0 }
$verticalSwing1Button     = New-PopupButton "Position 1" { Send-DeviceCommand "ac" "setVerticalSwing" 1 }
$verticalSwing2Button     = New-PopupButton "Position 2" { Send-DeviceCommand "ac" "setVerticalSwing" 2 }
$verticalSwing3Button     = New-PopupButton "Position 3" { Send-DeviceCommand "ac" "setVerticalSwing" 3 }
$verticalSwing4Button     = New-PopupButton "Position 4" { Send-DeviceCommand "ac" "setVerticalSwing" 4 }
$verticalSwing5Button     = New-PopupButton "Position 5" { Send-DeviceCommand "ac" "setVerticalSwing" 5 }
$verticalSwingOffButton   = New-PopupButton "Off" { Send-DeviceCommand "ac" "setVerticalSwing" 6 }
$swingPanel.Controls.AddRange(@($verticalSwingSweepButton, $verticalSwing1Button, $verticalSwing2Button, $verticalSwing3Button, $verticalSwing4Button, $verticalSwing5Button, $verticalSwingOffButton))

Add-PopupSeparator $swingPanel

$reloadButton = New-PopupButton "Reload" { Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/reload" -TimeoutSec 5 | Out-Null }
$quitButton = New-PopupButton "Quit" {
  $notifyIcon.Visible = $false
  if ($script:serviceProcess -and -not $script:serviceProcess.HasExited) {
    $script:serviceProcess.Kill()
  }
  [System.Windows.Forms.Application]::Exit()
}
$swingPanel.Controls.AddRange(@($reloadButton, $quitButton))

# --- Calculate form height from tallest column ---

$leftH = 0
foreach ($c in $leftPanel.Controls) { $leftH += $c.Height + $c.Margin.Top + $c.Margin.Bottom }
$rightH = 0
foreach ($c in $rightPanel.Controls) { $rightH += $c.Height + $c.Margin.Top + $c.Margin.Bottom }
$swingH = 0
foreach ($c in $swingPanel.Controls) { $swingH += $c.Height + $c.Margin.Top + $c.Margin.Bottom }
$script:TrayPopup.Height = [Math]::Max($leftH, [Math]::Max($rightH, $swingH)) + 16

# --- State refresh ---

function Refresh-PopupVisualState {
  $state = Get-ACState
  if ($null -eq $state) {
    return
  }
  Set-PopupButtonState $powerOnButton ($state.pow -eq 1)
  Set-PopupButtonState $powerOffButton ($state.pow -eq 0)
  Set-PopupButtonState $displayOnButton ($state.display -eq 1)
  Set-PopupButtonState $displayOffButton ($state.display -eq 0)
  Set-PopupButtonState $fanLowButton ($state.fspd -eq 2)
  Set-PopupButtonState $fanMediumButton ($state.fspd -eq 3)
  Set-PopupButtonState $fanHighButton ($state.fspd -eq 4)
  Set-PopupButtonState $fanTurboButton ($state.fspd -eq 6)
  Set-PopupButtonState $fanAutoButton ($state.fspd -eq 7)
  Set-PopupButtonState $profileTurboButton ($state.turbo -eq 3)
  Set-PopupButtonState $profileEcoButton (($state.turbo -ne 3) -and ($state.esave -eq 1))
  Set-PopupButtonState $profileDefaultButton (($state.turbo -ne 3) -and ($state.esave -ne 1) -and ($state.eco -eq 0))
  Set-PopupButtonState $profile100Button (($state.turbo -ne 3) -and ($state.esave -ne 1) -and ($state.eco -eq 1))
  Set-PopupButtonState $profile80Button (($state.turbo -ne 3) -and ($state.esave -ne 1) -and ($state.eco -eq 2))
  Set-PopupButtonState $profile60Button (($state.turbo -ne 3) -and ($state.esave -ne 1) -and ($state.eco -eq 3))
  Set-PopupButtonState $profile40Button (($state.turbo -ne 3) -and ($state.esave -ne 1) -and ($state.eco -eq 4))
  Set-PopupButtonState $horizontalSwingOnButton ($state.hswing -eq 0)
  Set-PopupButtonState $horizontalSwingOffButton ($state.hswing -eq 6)
  Set-PopupButtonState $verticalSwingSweepButton ($state.vswing -eq 0)
  Set-PopupButtonState $verticalSwing1Button ($state.vswing -eq 1)
  Set-PopupButtonState $verticalSwing2Button ($state.vswing -eq 2)
  Set-PopupButtonState $verticalSwing3Button ($state.vswing -eq 3)
  Set-PopupButtonState $verticalSwing4Button ($state.vswing -eq 4)
  Set-PopupButtonState $verticalSwing5Button ($state.vswing -eq 5)
  Set-PopupButtonState $verticalSwingOffButton ($state.vswing -eq 6)
}

$script:TrayPopup.Add_Deactivate({ $script:TrayPopup.Hide() })

$stateTimer = New-Object System.Windows.Forms.Timer
$stateTimer.Interval = 1500
$stateTimer.Add_Tick({
  if (-not $script:ServiceReady) {
    if (Test-Service) {
      $script:ServiceReady = $true
      $notifyIcon.Text = "AC Control"
      $stateTimer.Interval = 300000
    } elseif ($script:ServiceStartupError) {
      $notifyIcon.Text = "AC Control - service failed"
      $notifyIcon.BalloonTipTitle = "AC Control"
      $notifyIcon.BalloonTipText = "Service failed to start. Check $ErrLog."
      $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
      $notifyIcon.ShowBalloonTip(5000)
      $stateTimer.Stop()
    }
  }
})
$stateTimer.Start()

# --- Show popup near tray ---

function Show-TrayPopup {
  $point = [System.Windows.Forms.Cursor]::Position
  $screen = [System.Windows.Forms.Screen]::FromPoint($point).WorkingArea
  $x = [Math]::Min($point.X, $screen.Right - $script:TrayPopup.Width - 8)
  $y = [Math]::Min($point.Y, $screen.Bottom - $script:TrayPopup.Height - 8)
  $script:TrayPopup.Location = New-Object System.Drawing.Point ([Math]::Max($screen.Left + 8, $x)), ([Math]::Max($screen.Top + 8, $y))
  $script:TrayPopup.Show()
  $script:TrayPopup.Activate()
  if ($script:ServiceReady) {
    Refresh-PopupVisualState
  }
}

$notifyIcon.Add_MouseUp({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
    Show-TrayPopup
  }
})
$notifyIcon.Add_DoubleClick({ Start-Process "$BaseUrl/" })
$notifyIcon.ShowBalloonTip(3000)

[System.Windows.Forms.Application]::Run()
