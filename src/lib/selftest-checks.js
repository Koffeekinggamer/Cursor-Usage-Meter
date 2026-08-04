"use strict";

/**
 * Pure pass/fail checks for Meter Face UI proof (CUM_SELFTEST / verify-meter-ui).
 * Asserts dual-needle Face is non-idle and the dial canvas is painted — not blank cream.
 */

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function isIdleLabel(text) {
  if (text == null) return true;
  const t = String(text).trim();
  return !t || t === "—" || t === "-" || t === "–" || t === "―";
}

/**
 * @param {{
 *   hasTokenMeter?: boolean,
 *   hasMeterPaint?: boolean,
 *   cursorText?: string|null,
 *   otherText?: string|null,
 *   canvasW?: number,
 *   canvasH?: number,
 *   nonCream?: number,
 *   total?: number,
 * }} diag
 * @returns {{ ok: boolean, failures: string[] }}
 */
function evaluateFaceDiag(diag) {
  /** @type {string[]} */
  const failures = [];
  if (!diag || typeof diag !== "object") {
    return { ok: false, failures: ["diag missing"] };
  }
  if (!diag.hasTokenMeter) failures.push("tokenMeter missing (preload failed)");
  if (!diag.hasMeterPaint) failures.push("MeterPaint.drawMeterFace missing");
  if (!diag.canvasW || !diag.canvasH) failures.push("canvas has zero size");
  if (isIdleLabel(diag.cursorText) && isIdleLabel(diag.otherText)) {
    failures.push(
      `labels still idle (cursor=${diag.cursorText} other=${diag.otherText})`
    );
  }
  const nonCream = Number(diag.nonCream) || 0;
  if (nonCream < 3) {
    failures.push(
      `canvas looks unpainted (nonCream=${nonCream}/${diag.total ?? "?"})`
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Synthetic Reading used when live Cursor usage-summary is unavailable.
 * Dual percents exercise Auto (blue) + API (dark) needles.
 * @returns {import('./reading').Reading}
 */
function syntheticVerifyReading() {
  return {
    percent: 42,
    used: 42,
    limit: 100,
    remaining: 58,
    autoPercentUsed: 30,
    apiPercentUsed: 55,
    onDemandUsed: null,
    membershipType: "pro",
    isUnlimited: false,
    billingCycleStart: null,
    billingCycleEnd: null,
    displayMessage: null,
    email: "verify@cursor-usage-meter.test",
  };
}

module.exports = {
  isIdleLabel,
  evaluateFaceDiag,
  syntheticVerifyReading,
};
