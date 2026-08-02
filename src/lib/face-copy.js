"use strict";

/**
 * Canonical Meter face copy (Cursor models usage / Other models usage).
 * HTML and CSS are adapters — change labels here.
 */

const LEGEND = Object.freeze({
  cursor: "Auto",
  other: "API",
});

/**
 * @param {import('./reading').Fault|null|undefined} fault
 */
function faultPlan(fault) {
  if (!fault) return "Unavailable";
  switch (fault.kind) {
    case "missing-db":
      return "No Cursor DB";
    case "unsigned-in":
      return "Sign in";
    case "http":
      return "API error";
    case "parse":
      return "Bad data";
    default:
      return "Fault";
  }
}

/**
 * @param {{ membershipType?: string|null, isUnlimited?: boolean }} reading
 * @param {{ showingLastGood?: boolean }} [opts]
 */
function planLine(reading, opts = {}) {
  if (reading.isUnlimited) {
    return opts.showingLastGood ? "Unlimited · held" : "Unlimited";
  }
  const base = reading.membershipType || "";
  if (opts.showingLastGood) {
    return base ? `${base} · held` : "Plan · held";
  }
  return base;
}

/**
 * @param {{ cursor: string, other: string }} legend
 */
function titleHint(legend = LEGEND) {
  return `Blue ${legend.cursor} = Cursor models · Dark ${legend.other} = other models · drag · double-click refresh`;
}

/**
 * @param {{ cursor: string, other: string }} legend
 */
function legendText(legend = LEGEND) {
  return `${legend.cursor} · ${legend.other}`;
}

module.exports = {
  LEGEND,
  faultPlan,
  planLine,
  titleHint,
  legendText,
};
