"use strict";

const { percentToNeedleAngle } = require("./usage");

/** Blue needle — Cursor / Auto models (`autoPercentUsed`). */
const CURSOR_NEEDLE_COLOR = "#2563eb";

/** Dark needle body for other / API models. */
const OTHER_NEEDLE_COLOR = "#1c1917";

/**
 * Spring-damper step toward a target needle angle.
 * @param {{ angle: number, velocity: number }} state
 * @param {number} targetAngle
 * @param {number} dtSeconds
 * @param {{ stiffness?: number, damping?: number }} [opts]
 */
function stepNeedle(state, targetAngle, dtSeconds, opts = {}) {
  const stiffness = opts.stiffness ?? 48;
  const damping = opts.damping ?? 10;
  const dt = Math.max(0, Math.min(dtSeconds, 0.05));
  const displacement = targetAngle - state.angle;
  const acceleration = stiffness * displacement - damping * state.velocity;
  const velocity = state.velocity + acceleration * dt;
  const angle = state.angle + velocity * dt;
  return { angle, velocity };
}

/**
 * Color for a usage percent band (used on the other-models arc).
 * @param {number} percent
 */
function colorForPercent(percent) {
  if (percent >= 95) return "#c23b22";
  if (percent >= 80) return "#d97706";
  if (percent >= 50) return "#ca8a04";
  return "#2f6f4e";
}

/**
 * Resolve Cursor-models % (Auto) and other-models % (API/named).
 * @param {{
 *   percent?: number,
 *   autoPercentUsed?: number|null,
 *   apiPercentUsed?: number|null,
 *   isUnlimited?: boolean,
 * }} usage
 */
function dualPercents(usage) {
  if (usage.isUnlimited) {
    return { cursorPercent: 0, otherPercent: 0 };
  }
  const cursorPercent = Number.isFinite(Number(usage.autoPercentUsed))
    ? Number(usage.autoPercentUsed)
    : Number(usage.percent) || 0;
  const otherPercent = Number.isFinite(Number(usage.apiPercentUsed))
    ? Number(usage.apiPercentUsed)
    : 0;
  return {
    cursorPercent: Math.max(0, Math.min(cursorPercent, 150)),
    otherPercent: Math.max(0, Math.min(otherPercent, 150)),
  };
}

module.exports = {
  stepNeedle,
  colorForPercent,
  dualPercents,
  percentToNeedleAngle,
  CURSOR_NEEDLE_COLOR,
  OTHER_NEEDLE_COLOR,
};
