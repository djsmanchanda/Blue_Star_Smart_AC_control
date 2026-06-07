const statusText = document.querySelector("#service-status");
const acPanel = document.querySelector("#ac-panel");
const refreshButton = document.querySelector("#refresh");

const fanSpeeds = [
  ["Low", 2],
  ["Medium", 3],
  ["High", 4],
  ["Turbo", 6],
  ["Auto", 7],
];

const acModes = [
  ["Fan", 0],
  ["Heat", 1],
  ["Cool", 2],
  ["Dry", 3],
  ["Auto", 4],
];

const horizontalSwingOptions = [
  ["On", 0],
  ["Off", 6],
];

const verticalSwingOptions = [
  ["Swing", 0],
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["4", 4],
  ["5", 5],
  ["Off", 6],
];

const capacityProfileOptions = [
  ["Default", { eco: 0, esave: 0, turbo: 0 }],
  ["100%", { eco: 1, esave: 0, turbo: 0 }],
  ["80%", { eco: 2, esave: 0, turbo: 0 }],
  ["60%", { eco: 3, esave: 0, turbo: 0 }],
  ["40%", { eco: 4, esave: 0, turbo: 0 }],
  ["Eco", { esave: 1, eco: 0, turbo: 0 }],
  ["Turbo", { turbo: 3, eco: 0, esave: 0, fspd: 6, stemp: "16.0" }],
];

const commandLabels = {
  turnOn: "On",
  turnOff: "Off",
  setTemperature: "Temperature",
  setFanSpeed: "Fan speed",
  setMode: "Mode",
  setDisplay: "Display",
  setHorizontalSwing: "Horizontal swing",
  setVerticalSwing: "Vertical swing",
  setCapacityProfile: "Capacity profile",
};

let acDevice;
let currentStatus;

function setStatus(message, tone = "neutral") {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

async function sendCommand(command, value) {
  setStatus(`Sending ${commandLabels[command] || command}...`);
  const payload = { command };
  if (value !== undefined) {
    payload.value = value;
  }
  await api(`/api/devices/${encodeURIComponent(acDevice.id)}/commands`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  updateLocalStatus(command, value);
  renderControls();
  setStatus(`${commandLabels[command] || command} sent`, "ok");
  await loadStatus();
}

function button(label, onClick, className = "") {
  const element = document.createElement("button");
  element.className = `command ${className}`.trim();
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", async () => {
    element.disabled = true;
    try {
      await onClick();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      element.disabled = false;
    }
  });
  return element;
}

function activeClass(isActive) {
  return isActive ? "active" : "";
}

function controlGroup(title, controls) {
  const section = document.createElement("section");
  section.className = "control-group";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const row = document.createElement("div");
  row.className = "control-row";
  row.append(...controls);
  section.append(heading, row);
  return section;
}

function optionButtons(options, command, activeValue) {
  return options.map(([label, value]) => {
    const isActive = activeValue !== undefined && Number(activeValue) === Number(value);
    return button(label, () => sendCommand(command, value), activeClass(isActive));
  });
}

function capacityProfileName(state = {}) {
  if (state.turbo === 3) {
    return "Turbo";
  }
  if (state.esave === 1) {
    return "Eco";
  }
  return Object.fromEntries([
    [0, "Default"],
    [1, "100%"],
    [2, "80%"],
    [3, "60%"],
    [4, "40%"],
  ])[Number(state.eco)] || "Default";
}

function capacityButtons() {
  const currentProfile = capacityProfileName(currentStatus?.state || {});
  return capacityProfileOptions.map(([label, value]) => (
    button(label, () => sendCommand("setCapacityProfile", value), activeClass(label === currentProfile))
  ));
}

function renderStatus() {
  const summary = currentStatus?.summary || {};
  const state = currentStatus?.state || {};
  const items = [
    ["Power", summary.power],
    ["Set temp", summary.temperatureCelsius ? `${summary.temperatureCelsius} C` : "Unknown"],
    ["Room temp", summary.ambientTemperatureCelsius ? `${summary.ambientTemperatureCelsius} C` : "Unknown"],
    ["Mode", summary.mode],
    ["Fan", summary.fanSpeed],
    ["Profile", summary.capacityProfile],
    ["Display", summary.display],
    ["H swing", summary.horizontalSwing],
    ["V swing", summary.verticalSwing],
  ];

  const grid = document.createElement("dl");
  grid.className = "status-grid";
  for (const [label, value] of items) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value ?? "Unknown";
    item.append(dt, dd);
    grid.append(item);
  }

  const raw = document.createElement("pre");
  raw.className = "raw-state";
  raw.textContent = JSON.stringify(state, null, 2);
  return [grid, raw];
}

function updateLocalStatus(command, value) {
  if (!currentStatus) {
    return;
  }
  const state = currentStatus.state || {};
  const summary = currentStatus.summary || {};
  if (command === "turnOn") {
    state.pow = 1;
    summary.power = "On";
  } else if (command === "turnOff") {
    state.pow = 0;
    summary.power = "Off";
  } else if (command === "setTemperature") {
    state.stemp = Number(value).toFixed(1);
    summary.temperatureCelsius = state.stemp;
  } else if (command === "setDisplay") {
    state.display = Number(value);
    summary.display = Number(value) === 1 ? "On" : "Off";
  } else if (command === "setFanSpeed") {
    state.fspd = Number(value);
    summary.fanSpeed = Object.fromEntries(fanSpeeds.map(([label, item]) => [item, label]))[Number(value)] || value;
  } else if (command === "setMode") {
    state.mode = Number(value);
    summary.mode = Object.fromEntries(acModes.map(([label, item]) => [item, label]))[Number(value)] || value;
  } else if (command === "setHorizontalSwing") {
    state.hswing = Number(value);
    summary.horizontalSwing = Object.fromEntries(horizontalSwingOptions.map(([label, item]) => [item, label]))[Number(value)] || value;
  } else if (command === "setVerticalSwing") {
    state.vswing = Number(value);
    summary.verticalSwing = Object.fromEntries(verticalSwingOptions.map(([label, item]) => [item, label]))[Number(value)] || value;
  } else if (command === "setCapacityProfile") {
    Object.assign(state, value);
    if (value.turbo === 3) {
      summary.capacityProfile = "Turbo";
      summary.fanSpeed = "Turbo";
      summary.temperatureCelsius = "16.0";
    } else if (value.esave === 1) {
      summary.capacityProfile = "Eco";
    } else {
      summary.capacityProfile = Object.fromEntries([
        [0, "Default"],
        [1, "100%"],
        [2, "80%"],
        [3, "60%"],
        [4, "40%"],
      ])[Number(value.eco)] || value.eco;
    }
  }
}

function renderControls() {
  const temperature = document.createElement("input");
  temperature.type = "number";
  temperature.min = "16";
  temperature.max = "30";
  temperature.step = "1";
  temperature.value = Number.parseFloat(currentStatus?.state?.stemp) || acDevice.defaultTemperatureCelsius || 24;
  temperature.setAttribute("aria-label", "AC temperature");
  const state = currentStatus?.state || {};

  acPanel.replaceChildren(
    controlGroup("Status", [
      button("Refresh", loadStatus, "primary"),
      button("On", () => sendCommand("turnOn"), activeClass(state.pow === 1)),
      button("Off", () => sendCommand("turnOff"), activeClass(state.pow === 0)),
    ]),
    ...renderStatus(),
    controlGroup("Temperature", [
      button("-1 C", () => sendCommand("setTemperature", Number(temperature.value) - 1)),
      temperature,
      button("+1 C", () => sendCommand("setTemperature", Number(temperature.value) + 1)),
      button("Set", () => sendCommand("setTemperature", Number(temperature.value)), "primary"),
    ]),
    controlGroup("Display", [
      button("Display on", () => sendCommand("setDisplay", 1), activeClass(state.display === 1)),
      button("Display off", () => sendCommand("setDisplay", 0), activeClass(state.display === 0)),
    ]),
    controlGroup("Capacity", capacityButtons()),
    controlGroup("Fan Speed", optionButtons(fanSpeeds, "setFanSpeed", state.fspd)),
    controlGroup("AC Mode", optionButtons(acModes, "setMode", state.mode)),
    controlGroup("Horizontal Swing", optionButtons(horizontalSwingOptions, "setHorizontalSwing", state.hswing)),
    controlGroup("Vertical Swing", optionButtons(verticalSwingOptions, "setVerticalSwing", state.vswing)),
  );
}

async function loadStatus() {
  const { status } = await api(`/api/devices/${encodeURIComponent(acDevice.id)}/status`);
  currentStatus = status;
  renderControls();
  setStatus("AC status refreshed.", "ok");
}

async function loadApp() {
  setStatus("Checking local service...");
  const [{ devices }] = await Promise.all([api("/api/devices"), api("/api/health")]);
  acDevice = devices.find((device) => device.id === "ac") || devices.find((device) => device.type === "thermostat");
  if (!acDevice) {
    throw new Error("AC device is not configured.");
  }
  await loadStatus();
}

refreshButton.addEventListener("click", async () => {
  try {
    await api("/api/reload", { method: "POST" });
    await loadApp();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

loadApp().catch((error) => {
  setStatus(`Service unavailable: ${error.message}`, "error");
});
