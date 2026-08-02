"use strict";

/**
 * Sync the Meter with Cursor: start when Cursor opens, stop when Cursor closes.
 *
 * @param {{
 *   isCursorRunning: () => boolean,
 *   isMeterRunning: () => boolean,
 *   startMeter: () => void,
 *   stopMeter: () => void,
 * }} adapters
 * @returns {'started'|'stopped'|'already-running'|'idle'}
 */
function syncMeterWithCursor(adapters) {
  const cursorUp = adapters.isCursorRunning();
  const meterUp = adapters.isMeterRunning();

  if (cursorUp && !meterUp) {
    adapters.startMeter();
    return "started";
  }

  if (!cursorUp && meterUp) {
    adapters.stopMeter();
    return "stopped";
  }

  if (cursorUp && meterUp) {
    return "already-running";
  }

  return "idle";
}

/** @deprecated use syncMeterWithCursor */
function ensureMeterRunning(adapters) {
  const result = syncMeterWithCursor({
    ...adapters,
    stopMeter: adapters.stopMeter || (() => {}),
  });
  if (result === "idle" || result === "stopped") return "cursor-down";
  return result;
}

module.exports = { syncMeterWithCursor, ensureMeterRunning };
