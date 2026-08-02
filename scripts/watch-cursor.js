"use strict";

/**
 * Keep the Token Usage Meter in sync with Cursor:
 * start when Cursor opens, quit when Cursor closes.
 */

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { syncMeterWithCursor } = require("../src/lib/watcher");
const {
  defaultPidPath,
  readPidFile,
  clearPidFile,
  isPidAlive,
} = require("../src/lib/pidfile");

const ROOT = path.join(__dirname, "..");
const INTERVAL_MS = Number(process.env.TUM_WATCH_MS) || 5000;
const START_COOLDOWN_MS = Number(process.env.TUM_START_COOLDOWN_MS) || 15_000;
const pidFile = defaultPidPath(ROOT);

function resolveElectronBinary() {
  const fromPackage = require("electron");
  if (typeof fromPackage === "string" && fs.existsSync(fromPackage)) {
    return fromPackage;
  }
  const pathTxt = path.join(ROOT, "node_modules", "electron", "path.txt");
  if (fs.existsSync(pathTxt)) {
    const rel = fs.readFileSync(pathTxt, "utf8").trim();
    const candidate = path.join(ROOT, "node_modules", "electron", "dist", rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Electron binary not found — run npm install");
}

function isCursorRunning() {
  try {
    const out = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to (name of processes) contains "Cursor"',
      ],
      { encoding: "utf8" }
    ).trim();
    return out === "true";
  } catch {
    try {
      const out = execFileSync("ps", ["-axo", "args="], { encoding: "utf8" });
      return out
        .split("\n")
        .some(
          (line) =>
            line.includes("Cursor.app/Contents/MacOS/Cursor") &&
            !line.includes("Cursor Helper")
        );
    } catch {
      return false;
    }
  }
}

function meterPids() {
  const pids = new Set();
  const fromFile = readPidFile(pidFile);
  if (fromFile != null && isPidAlive(fromFile)) pids.add(fromFile);

  try {
    const out = execFileSync("pgrep", ["-fl", "Electron"], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      if (!line.includes(ROOT)) continue;
      if (!/Electron\.app\/Contents\/MacOS\/Electron/.test(line)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (Number.isFinite(pid)) pids.add(pid);
    }
  } catch {
    // none
  }
  return [...pids];
}

function isMeterRunning() {
  return meterPids().length > 0;
}

let lastStartAt = 0;

function startMeter() {
  const now = Date.now();
  if (now - lastStartAt < START_COOLDOWN_MS) return;
  lastStartAt = now;

  const electronBin = resolveElectronBinary();
  const env = { ...process.env, TUM_METER: "1" };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBin, ["."], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  console.log(`spawned Meter (launcher pid=${child.pid})`);
}

function stopMeter() {
  const pids = meterPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`stopped Meter pid=${pid}`);
    } catch (err) {
      console.log(`stop Meter pid=${pid} failed: ${err.message}`);
    }
  }
  clearPidFile(pidFile);
}

function tick() {
  const result = syncMeterWithCursor({
    isCursorRunning,
    isMeterRunning,
    startMeter,
    stopMeter,
  });
  if (result === "started" || result === "stopped") {
    console.log(`syncMeterWithCursor → ${result}`);
  }
}

console.log("watching for Cursor (start on open, stop on close)…");
tick();
setInterval(tick, INTERVAL_MS);
