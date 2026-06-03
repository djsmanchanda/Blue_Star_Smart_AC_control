# AC Control

A lightweight Windows laptop service for controlling a Blue Star Smart AC from a local web panel and Windows system tray.

The service runs on `127.0.0.1:8765`, loads credentials from `.env`, talks to the Blue Star cloud through AWS IoT MQTT over WebSocket, and exposes local API endpoints for the tray and web UI.

## Run

Create `.env` from `.env.example`:

```text
BLUESTAR_AUTH_ID=your-phone-number
BLUESTAR_PASSWORD=your-password
```

Start the local service:

```powershell
node service.js
```

Open the web panel:

```text
http://127.0.0.1:8765/
```

Start the tray app:

```powershell
powershell -ExecutionPolicy Bypass -File .\tray.ps1
```

Install tray startup after Windows sign-in:

```powershell
.\setup-startup.bat
```

The tray menu provides:

- Open control panel
- AC on/off
- Increase temperature by 1 C
- Decrease temperature by 1 C
- Toggle display
- Reload config
- Quit

## Controls

The web panel includes:

- current AC status
- power on/off
- temperature set and +/- controls
- display on/off
- fan speed: low, medium, high, turbo, auto
- AC mode: fan, heat, cool, dry, auto
- horizontal swing
- vertical swing levels

The web panel does not poll in the background. It reads MQTT status on page load, when you press Refresh, and once after each command.

## Blue Star Protocol

The Android app traffic points at AWS IoT MQTT:

- normal control publish topic: `$aws/things/<thing-id>/shadow/update`
- force-sync topic: `things/<thing-id>/control`
- state topic: `things/<thing-id>/state/reported`
- AWS IoT endpoint: `a26381dl7mudo4-ats.iot.ap-south-1.amazonaws.com`
- AWS region: `ap-south-1`

Normal controls are published as AWS IoT Shadow desired state:

```json
{
  "state": {
    "desired": {
      "pow": 1,
      "ts": 1780500000000,
      "src": "anmq"
    }
  }
}
```

Current status is read by subscribing to `things/<thing-id>/state/reported` and publishing `{ "fpsh": 1 }` to `things/<thing-id>/control`.

## Blue Star Keys

- power: `pow` (`1` on, `0` off)
- display: `display` (`1` on, `0` off)
- set temperature: `stemp`, formatted like `"24.0"`
- current room temperature: `ctemp`
- mode: `mode` (`0` fan, `1` heat, `2` cool, `3` dry, `4` auto)
- fan speed: `fspd` (`2` low, `3` medium, `4` high, `6` turbo, `7` auto)
- horizontal swing: `hswing`
- vertical swing: `vswing`
- timestamp: `ts`, added automatically
- source: `src`, set to `anmq`

## Local API

```text
GET  /api/health
GET  /api/devices
POST /api/reload
GET  /api/devices/ac/status
POST /api/devices/ac/commands
```

Command body:

```json
{
  "command": "setTemperature",
  "value": 24
}
```

Supported AC commands:

- `turnOn`
- `turnOff`
- `setTemperature`
- `setFanSpeed`
- `setMode`
- `setDisplay`
- `setHorizontalSwing`
- `setVerticalSwing`
