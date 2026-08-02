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

/**
 * Resolve Cursor's user-data directory.
 * @param {{ home?: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [opts]
 */
function getCursorUserDataDir(opts = {}) {
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (env.CURSOR_USER_DATA) return env.CURSOR_USER_DATA;
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor");
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Cursor"
    );
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Cursor");
}

/**
 * Resolve Cursor Usage Meter's application-data directory.
 * @param {{ home?: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [opts]
 */
function getMeterDataDir(opts = {}) {
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (env.CUM_DATA_DIR) return env.CUM_DATA_DIR;
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "cursor-usage-meter");
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(home, "AppData", "Roaming"),
      "cursor-usage-meter"
    );
  }
  return path.join(
    env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "cursor-usage-meter"
  );
}

module.exports = { getStateDbPath, getCursorUserDataDir, getMeterDataDir };
