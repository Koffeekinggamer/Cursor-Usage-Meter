"use strict";

const os = require("os");
const path = require("path");

/**
 * Resolve Cursor's state.vscdb path for the current platform.
 * @param {{ home?: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [opts]
 */
function getStateDbPath(opts = {}) {
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  if (env.CURSOR_STATE_DB) {
    return env.CURSOR_STATE_DB;
  }

  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }

  // Linux / other
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configHome, "Cursor", "User", "globalStorage", "state.vscdb");
}

module.exports = { getStateDbPath };
