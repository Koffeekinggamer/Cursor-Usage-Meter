"use strict";

/**
 * Keep the Cursor Usage Meter in sync with Cursor:
 * start when Cursor opens, quit when Cursor closes.
 */

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { syncMeterWithCursor } = require("../src/lib/watcher");
const {
  defaultPidPath,
  clearPidFile,
  findMeterPids,
  killOtherMeterInstances,
  isPidAlive,
} = require("../src/lib/pidfile");

const ROOT = path.join(__dirname, "..");
const INTERVAL_MS = Number(process.env.CUM_WATCH_MS) || 5000;
const START_COOLDOWN_MS = Number(process.env.CUM_START_COOLDOWN_MS) || 8_000;
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
  return findMeterPids(ROOT, { selfPid: process.pid });
}

function isMeterRunning() {
  return meterPids().length > 0;
}

let lastStartAt = 0;

function startMeter() {
  const now = Date.now();
  if (now - lastStartAt < START_COOLDOWN_MS) return;
  lastStartAt = now;

  const extras = meterPids();
  if (extras.length > 1) {
    killOtherMeterInstances(ROOT, { selfPid: extras[0] });
  }
  if (isMeterRunning()) {
    console.log("Meter already running — skip spawn");
    return;
  }

  const electronBin = resolveElectronBinary();
  const env = { ...process.env, CUM_METER: "1" };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBin, ["."], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  console.log(`spawned Cursor Meter (launcher pid=${child.pid})`);
}

function stopMeter() {
  const pids = meterPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`stopped Cursor Meter pid=${pid}`);
    } catch (err) {
      console.log(`stop Cursor Meter pid=${pid} failed: ${err.message}`);
    }
  }
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (pids.every((p) => !isPidAlive(p))) break;
  }
  for (const pid of pids) {
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
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
    console.log(
      `syncMeterWithCursor → ${result} (cursor=${isCursorRunning()} meter=${isMeterRunning()})`
    );
  }
}

console.log("watching for Cursor (start on open, stop on close)…");
console.log(`root=${ROOT} interval=${INTERVAL_MS}ms`);
tick();
setInterval(tick, INTERVAL_MS);
