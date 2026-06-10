#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const configPath = path.join(root, "config.json");
const fallbackConfigPath = path.join(root, "config.example.json");

function loadConfig() {
  const source = fs.existsSync(configPath) ? configPath : fallbackConfigPath;
  return JSON.parse(fs.readFileSync(source, "utf8"));
}

const config = loadConfig();
const host = config.host || "127.0.0.1";
const port = Number(config.port || 8765);
const baseUrl = `http://${host}:${port}`;
const deviceId = "ac";

function usage() {
  return [
    "Usage:",
    "  ac on",
    "  ac off",
    "  ac display on",
    "  ac display off",
    "  ac 1+",
    "  ac 1-",
    "  ac 3+",
    "  ac 3-",
    "  ac set 27",
    "  ac on 1h",
    "  ac off 5m",
    "  ac timer 1h",
    "  ac timer 5m",
    "  ac timer 1h 5m",
  ].join("\n");
}

async function api(pathname, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    throw new Error(`Local AC service is unavailable at ${baseUrl}. Start it with: npm start`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

async function sendCommand(command, value) {
  const payload = { command };
  if (value !== undefined) {
    payload.value = value;
  }
  await api(`/api/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function getCurrentTemperature() {
  const fallback = (config.devices || []).find((device) => device.id === deviceId)?.defaultTemperatureCelsius || 24;
  const { status } = await api(`/api/devices/${encodeURIComponent(deviceId)}/status`);
  const temperature = Number(status?.state?.stemp);
  return Number.isFinite(temperature) ? temperature : fallback;
}

function parseDuration(parts) {
  if (!parts.length) {
    throw new Error("Timer duration is required.");
  }

  let totalSeconds = 0;
  for (const part of parts) {
    const match = String(part).trim().match(/^(\d+)([hm])$/i);
    if (!match) {
      throw new Error(`Invalid timer duration: ${part}`);
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    totalSeconds += unit === "h" ? amount * 60 * 60 : amount * 60;
  }

  if (!Number.isSafeInteger(totalSeconds) || totalSeconds <= 0) {
    throw new Error("Timer duration must be greater than zero.");
  }
  return totalSeconds;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  return parts.join(" ") || `${totalSeconds}s`;
}

async function scheduleTimer(parts) {
  const kind = ["on", "off"].includes(parts[0]) ? parts.shift() : "off";
  return scheduleTimerKind(kind, parts);
}

async function scheduleTimerKind(kind, parts) {
  const durationSeconds = parseDuration(parts);
  const result = await api(`/api/devices/${encodeURIComponent(deviceId)}/timers/${kind}`, {
    method: "POST",
    body: JSON.stringify({ durationSeconds }),
  });
  const due = result.timer?.dueAt ? ` at ${new Date(result.timer.dueAt).toLocaleString()}` : "";
  console.log(`AC ${kind} timer set for ${formatDuration(durationSeconds)}${due}.`);
}

function parseTemperature(value) {
  const temperature = Number(value);
  if (!Number.isFinite(temperature)) {
    throw new Error(`Invalid temperature: ${value}`);
  }
  if (temperature < 16 || temperature > 30) {
    throw new Error("Temperature must be between 16 C and 30 C.");
  }
  return temperature;
}

async function main() {
  const args = process.argv.slice(2).map((arg) => arg.toLowerCase());

  if (args.length > 1 && ["on", "off"].includes(args[0])) {
    await scheduleTimerKind(args[0], args.slice(1));
    return;
  }

  if (args.length === 1 && args[0] === "on") {
    await sendCommand("turnOn");
    console.log("AC on.");
    return;
  }

  if (args.length === 1 && args[0] === "off") {
    await sendCommand("turnOff");
    console.log("AC off.");
    return;
  }

  if (args.length === 2 && args[0] === "display" && ["on", "off"].includes(args[1])) {
    await sendCommand("setDisplay", args[1] === "on" ? 1 : 0);
    console.log(`AC display ${args[1]}.`);
    return;
  }

  const temperatureStep = args.length === 1 ? args[0].match(/^(\d+)([+-])$/) : null;
  if (temperatureStep) {
    const amount = Number(temperatureStep[1]);
    const delta = temperatureStep[2] === "+" ? amount : -amount;
    const temperature = (await getCurrentTemperature()) + delta;
    parseTemperature(temperature);
    await sendCommand("setTemperature", temperature);
    console.log(`AC temperature set to ${temperature} C.`);
    return;
  }

  if (args.length === 2 && args[0] === "set") {
    const temperature = parseTemperature(args[1]);
    await sendCommand("setTemperature", temperature);
    console.log(`AC temperature set to ${temperature} C.`);
    return;
  }

  if (args[0] === "timer") {
    await scheduleTimer(args.slice(1));
    return;
  }

  throw new Error(usage());
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
