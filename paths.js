const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = __dirname;
const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
const configDir = process.env.AC_CONTROL_CONFIG_DIR || path.join(configHome, "ac-control");
const stateDir = process.env.AC_CONTROL_STATE_DIR || path.join(stateHome, "ac-control");

module.exports = {
  projectRoot,
  configDir,
  stateDir,
  configPath: process.env.AC_CONTROL_CONFIG
    || (process.platform === "win32" && fs.existsSync(path.join(projectRoot, "config.json"))
      ? path.join(projectRoot, "config.json")
      : path.join(configDir, "config.json")),
  fallbackConfigPath: path.join(projectRoot, "config.example.json"),
  envPaths: [path.join(configDir, ".env"), path.join(projectRoot, ".env")],
  logPath: path.join(stateDir, "service.log"),
};
