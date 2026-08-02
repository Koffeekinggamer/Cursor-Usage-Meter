"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { syncMeterWithCursor } = require("../src/lib/watcher");

describe("syncMeterWithCursor", () => {
  it("stays idle when Cursor and Meter are both down", () => {
    let started = 0;
    let stopped = 0;
    const result = syncMeterWithCursor({
      isCursorRunning: () => false,
      isMeterRunning: () => false,
      startMeter: () => {
        started += 1;
      },
      stopMeter: () => {
        stopped += 1;
      },
    });
    assert.equal(result, "idle");
    assert.equal(started, 0);
    assert.equal(stopped, 0);
  });

  it("starts the Meter when Cursor opens", () => {
    let started = 0;
    const result = syncMeterWithCursor({
      isCursorRunning: () => true,
      isMeterRunning: () => false,
      startMeter: () => {
        started += 1;
      },
      stopMeter: () => {},
    });
    assert.equal(result, "started");
    assert.equal(started, 1);
  });

  it("stops the Meter when Cursor closes", () => {
    let stopped = 0;
    const result = syncMeterWithCursor({
      isCursorRunning: () => false,
      isMeterRunning: () => true,
      startMeter: () => {},
      stopMeter: () => {
        stopped += 1;
      },
    });
    assert.equal(result, "stopped");
    assert.equal(stopped, 1);
  });

  it("leaves a running Meter alone while Cursor stays open", () => {
    let started = 0;
    let stopped = 0;
    const result = syncMeterWithCursor({
      isCursorRunning: () => true,
      isMeterRunning: () => true,
      startMeter: () => {
        started += 1;
      },
      stopMeter: () => {
        stopped += 1;
      },
    });
    assert.equal(result, "already-running");
    assert.equal(started, 0);
    assert.equal(stopped, 0);
  });
});
