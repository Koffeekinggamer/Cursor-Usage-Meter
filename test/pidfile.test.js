"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  defaultPidPath,
  writePidFile,
  readPidFile,
  clearPidFile,
  isPidAlive,
  findMeterPids,
  claimMeterSingleton,
} = require("../src/lib/pidfile");

describe("pidfile basics", () => {
  it("round-trips pid files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-pid-"));
    const p = defaultPidPath(dir);
    writePidFile(p, 12345);
    assert.equal(readPidFile(p), 12345);
    clearPidFile(p);
    assert.equal(readPidFile(p), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects the current process as alive", () => {
    assert.equal(isPidAlive(process.pid), true);
  });
});

describe("findMeterPids / claimMeterSingleton", () => {
  it("does not include self in findMeterPids", () => {
    const root = path.join(__dirname, "..");
    const pids = findMeterPids(root, { selfPid: process.pid });
    assert.ok(!pids.includes(process.pid));
  });

  it("claimMeterSingleton writes our pid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-claim-"));
    // Use a temp root with no real Electron processes
    claimMeterSingleton(dir, process.pid);
    assert.equal(readPidFile(defaultPidPath(dir)), process.pid);
    clearPidFile(defaultPidPath(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
