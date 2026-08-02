"use strict";

const { percentToNeedleAngle } = require("./usage");
const {
  dualPercents,
  colorForPercent,
  CURSOR_NEEDLE_COLOR,
  OTHER_NEEDLE_COLOR,
} = require("./gauge");
const {
  LEGEND,
  faultPlan,
  planLine,
  titleHint,
  legendText,
} = require("./face-copy");

/**
 * @typedef {{
 *   percent: number,
 *   label: string,
 *   targetAngle: number,
 *   color: string,
 *   arcColor: string,
 * }} NeedleFace
 *
 * @typedef {{
 *   cursor: NeedleFace,
 *   other: NeedleFace,
 *   plan: string,
 *   legend: { cursor: string, other: string },
 *   legendText: string,
 *   titleHint: string,
 *   showingLastGood: boolean,
 *   hasFault: boolean,
 *   account: string,
 * }} Face
 */

/**
 * Reading → face targets (angles, colors, labels). No animation state.
 * @param {import('./reading').Reading} reading
 * @returns {Omit<Face, 'showingLastGood'|'hasFault'>}
 */
function faceFromReading(reading) {
  const legend = { ...LEGEND };
  const { cursorPercent, otherPercent } = dualPercents(reading);

  if (reading.isUnlimited) {
    return {
      cursor: {
        percent: 0,
        label: "∞",
        targetAngle: -120,
        color: CURSOR_NEEDLE_COLOR,
        arcColor: CURSOR_NEEDLE_COLOR,
      },
      other: {
        percent: 0,
        label: "∞",
        targetAngle: -120,
        color: OTHER_NEEDLE_COLOR,
        arcColor: "#2f6f4e",
      },
      plan: planLine(reading),
      legend,
      legendText: legendText(legend),
      titleHint: titleHint(legend),
      account: reading.email || "",
    };
  }

  return {
    cursor: {
      percent: cursorPercent,
      label: String(Math.round(cursorPercent)),
      targetAngle: percentToNeedleAngle(cursorPercent),
      color: CURSOR_NEEDLE_COLOR,
      arcColor: CURSOR_NEEDLE_COLOR,
    },
    other: {
      percent: otherPercent,
      label: String(Math.round(otherPercent)),
      targetAngle: percentToNeedleAngle(otherPercent),
      color: OTHER_NEEDLE_COLOR,
      arcColor: colorForPercent(otherPercent),
    },
    plan: planLine(reading),
    legend,
    legendText: legendText(legend),
    titleHint: titleHint(legend),
    account: reading.email || "",
  };
}

/**
 * Cold Fault face (no last-good Reading).
 * @param {import('./reading').Fault|null} fault
 * @returns {Face}
 */
function faultFace(fault) {
  const legend = { ...LEGEND };
  return {
    cursor: {
      percent: 0,
      label: "!",
      targetAngle: -120,
      color: "#c23b22",
      arcColor: "#c23b22",
    },
    other: {
      percent: 0,
      label: "!",
      targetAngle: -120,
      color: OTHER_NEEDLE_COLOR,
      arcColor: "#c23b22",
    },
    plan: faultPlan(fault),
    legend,
    legendText: "",
    titleHint: titleHint(legend),
    showingLastGood: false,
    hasFault: true,
    account: "",
  };
}

/**
 * Meter state → Face DTO (single IPC interface).
 * @param {{
 *   reading: import('./reading').Reading|null,
 *   fault: import('./reading').Fault|null,
 *   showingLastGood: boolean,
 * }} state
 * @returns {Face}
 */
function buildFace(state) {
  if (!state.reading) {
    return faultFace(state.fault);
  }

  const base = faceFromReading(state.reading);
  return {
    ...base,
    plan: planLine(state.reading, { showingLastGood: state.showingLastGood }),
    showingLastGood: state.showingLastGood,
    hasFault: Boolean(state.fault),
  };
}

/**
 * Paint/animation frame derived from Face + live needle angles.
 * @param {Face} face
 * @param {{ cursor: number, other: number }} angles
 */
function faceFrame(face, angles) {
  return {
    cursorAngle: angles.cursor,
    otherAngle: angles.other,
    cursorColor: face.cursor.color,
    otherColor: face.other.color,
    otherArcColor: face.other.arcColor,
    cursorArcColor: face.cursor.arcColor,
    hasFault: face.hasFault,
  };
}

module.exports = {
  faceFromReading,
  faultFace,
  buildFace,
  faceFrame,
};
