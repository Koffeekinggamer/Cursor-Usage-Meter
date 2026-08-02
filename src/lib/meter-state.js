"use strict";

const { buildFace } = require("./face");

/**
 * @typedef {import('./reading').Reading} Reading
 * @typedef {import('./reading').Fault} Fault
 * @typedef {{
 *   reading: Reading|null,
 *   fault: Fault|null,
 *   showingLastGood: boolean,
 * }} MeterState
 */

/**
 * @returns {MeterState}
 */
function emptyMeterState() {
  return { reading: null, fault: null, showingLastGood: false };
}

/**
 * Reduce a Reading producer event into Meter display state.
 * @param {MeterState|null|undefined} previous
 * @param {{ ok: true, reading: Reading } | { ok: false, fault: Fault }} event
 * @returns {MeterState}
 */
function reduceMeterState(previous, event) {
  const prev = previous || emptyMeterState();

  if (event.ok) {
    return {
      reading: event.reading,
      fault: null,
      showingLastGood: false,
    };
  }

  if (prev.reading) {
    return {
      reading: prev.reading,
      fault: event.fault,
      showingLastGood: true,
    };
  }

  return {
    reading: null,
    fault: event.fault,
    showingLastGood: false,
  };
}

/**
 * @param {MeterState} state
 */
function buildFaceView(state) {
  return buildFace(state);
}

module.exports = {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
};
