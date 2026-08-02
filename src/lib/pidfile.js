"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function defaultPidPath(root) {
  return path.join(root, ".meter.pid");
}

/**
 * @param {string} pidPath
 * @param {number} pid
 */
function writePidFile(pidPath, pid) {
  fs.writeFileSync(pidPath, String(pid));
}

/**
 * @param {string} pidPath
 */
function clearPidFile(pidPath) {
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
}

/**
 * @param {string} pidPath
 * @returns {number|null}
 */
function readPidFile(pidPath) {
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals|number} [signal]
 */
function killPid(pid, signal = "SIGTERM") {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover running Meter main Electron processes for this install.
 * Excludes Helper/GPU/Renderer processes and the current process.
 *
 * @param {string} root Absolute path to the Meter project root
 * @param {{ selfPid?: number }} [opts]
 * @returns {number[]}
 */
function findMeterPids(root, opts = {}) {
  const selfPid = opts.selfPid ?? process.pid;
  const rootResolved = path.resolve(root);
  const pids = new Set();

  const fromFile = readPidFile(defaultPidPath(rootResolved));
  if (fromFile != null && fromFile !== selfPid && isPidAlive(fromFile)) {
    pids.add(fromFile);
  }

  try {
    const out = execFileSync("pgrep", ["-fl", "Electron"], {
      encoding: "utf8",
    });
    for (const line of out.split("\n")) {
      if (!line.includes(rootResolved)) continue;
      if (!/Electron\.app\/Contents\/MacOS\/Electron/.test(line)) continue;
      if (/Helper/.test(line)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (!Number.isFinite(pid) || pid === selfPid) continue;
      pids.add(pid);
    }
  } catch {
    // pgrep exit 1 = none
  }

  // Linux / non-app Electron binary
  try {
    const out = execFileSync("pgrep", ["-fl", "electron"], {
      encoding: "utf8",
    });
    for (const line of out.split("\n")) {
      if (!line.includes(rootResolved)) continue;
      if (/Helper|type=renderer|type=gpu/i.test(line)) continue;
      // Prefer main process lines that include the project path
      if (!/\belectron\b/i.test(line)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (!Number.isFinite(pid) || pid === selfPid) continue;
      pids.add(pid);
    }
  } catch {
    // none
  }

  return [...pids];
}

/**
 * Kill every other Meter instance for this install so only one overlay shows.
 * @param {string} root
 * @param {{ selfPid?: number, graceMs?: number }} [opts]
 * @returns {number[]} pids that were signaled
 */
function killOtherMeterInstances(root, opts = {}) {
  const selfPid = opts.selfPid ?? process.pid;
  const graceMs = opts.graceMs ?? 400;
  const others = findMeterPids(root, { selfPid });

  for (const pid of others) {
    killPid(pid, "SIGTERM");
  }

  if (others.length && graceMs > 0) {
    const end = Date.now() + graceMs;
    while (Date.now() < end) {
      if (others.every((p) => !isPidAlive(p))) break;
    }
    for (const pid of others) {
      if (isPidAlive(pid)) killPid(pid, "SIGKILL");
    }
  }

  return others;
}

/**
 * Claim the Meter singleton: kill orphans, write our pid.
 * @param {string} root
 * @param {number} pid
 * @returns {{ killed: number[] }}
 */
function claimMeterSingleton(root, pid) {
  const killed = killOtherMeterInstances(root, { selfPid: pid });
  writePidFile(defaultPidPath(root), pid);
  return { killed };
}

module.exports = {
  defaultPidPath,
  writePidFile,
  clearPidFile,
  readPidFile,
  isPidAlive,
  killPid,
  findMeterPids,
  killOtherMeterInstances,
  claimMeterSingleton,
};
