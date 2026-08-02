"use strict";

/**
 * Exact six-section BML ticket template from Practical AI onboarding.
 * @see https://practical-office.github.io/bml-onboarding/module-4.html
 */

const SECTIONS = [
  "Hypothesis",
  "Build",
  "Measure",
  "Learn",
  "Acceptance Criteria",
  "Technical Context / References",
];

const EMPTY_FIELDS = Object.freeze({
  hypothesis: "",
  build: "",
  measure: "",
  learn: "",
  acceptanceCriteria: "",
  technicalContext: "",
});

/** Placeholders tuned for admin / ops jobs as well as product experiments. */
const PLACEHOLDERS = Object.freeze({
  hypothesis:
    "What must be true for this admin job / bet to succeed? (e.g. “Ops can complete X without Y”)",
  build:
    "Smallest change or process we can ship to test that — not the full roadmap.",
  measure:
    "Numeric pass · kill threshold · duration (e.g. “≥90% tasks done in SLA · kill <70% · 2 weeks”)",
  learn: "What did we learn? Persevere / Pivot / Kill + evidence.",
  acceptanceCriteria:
    "- [ ] Observable done for the Build slice (so Measure can start)\n- [ ] …",
  technicalContext:
    "@folders @files for /grill-with-docs (admin scripts, SOPs, dashboards, repos)",
});

/**
 * @typedef {{
 *   hypothesis: string,
 *   build: string,
 *   measure: string,
 *   learn: string,
 *   acceptanceCriteria: string,
 *   technicalContext: string,
 * }} TicketFields
 */

/**
 * Render the six-section issue body from structured fields.
 * @param {Partial<TicketFields>} fields
 * @returns {string}
 */
function formatTicketBody(fields = {}) {
  const f = { ...EMPTY_FIELDS, ...fields };
  return [
    "## Hypothesis",
    f.hypothesis.trim() || PLACEHOLDERS.hypothesis,
    "",
    "## Build",
    f.build.trim() || PLACEHOLDERS.build,
    "",
    "## Measure",
    f.measure.trim() || PLACEHOLDERS.measure,
    "",
    "## Learn",
    f.learn.trim() || PLACEHOLDERS.learn,
    "",
    "## Acceptance Criteria",
    f.acceptanceCriteria.trim() || PLACEHOLDERS.acceptanceCriteria,
    "",
    "## Technical Context / References",
    f.technicalContext.trim() || PLACEHOLDERS.technicalContext,
    "",
  ].join("\n");
}

/**
 * Parse a markdown issue body into the six sections (best-effort).
 * @param {string} body
 * @returns {TicketFields}
 */
function parseTicketBody(body) {
  const text = String(body || "");
  /** @type {Record<string, string>} */
  const out = { ...EMPTY_FIELDS };
  const headingRe =
    /^##\s+(Hypothesis|Build|Measure|Learn|Acceptance Criteria|Technical Context(?:\s*\/\s*References)?)\s*$/gim;

  const matches = [];
  let m;
  while ((m = headingRe.exec(text)) !== null) {
    matches.push({ name: m[1], index: m.index, end: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const stop = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, stop).trim();
    const key = sectionKey(matches[i].name);
    if (key) out[key] = content;
  }

  return /** @type {TicketFields} */ (out);
}

/**
 * @param {string} name
 * @returns {keyof TicketFields|null}
 */
function sectionKey(name) {
  const n = name.toLowerCase();
  if (n === "hypothesis") return "hypothesis";
  if (n === "build") return "build";
  if (n === "measure") return "measure";
  if (n === "learn") return "learn";
  if (n.startsWith("acceptance")) return "acceptanceCriteria";
  if (n.startsWith("technical")) return "technicalContext";
  return null;
}

/**
 * True when Measure text includes a numeric kill threshold (course gate).
 * Accepts: kill <40%, kill: 0.4, kill if < 50, kill on strong pushback is NOT enough alone —
 * requires a digit somewhere near "kill".
 * @param {string} measure
 * @returns {boolean}
 */
function hasNumericKillCriteria(measure) {
  const s = String(measure || "");
  // "kill <40%", "kill: < 40 %", "kill threshold 40", "kill if no difference" fails (no digit)
  if (/\bkill\b[^.\n]{0,40}\d/i.test(s)) return true;
  if (/\d[^.\n]{0,40}\bkill\b/i.test(s)) return true;
  return false;
}

/**
 * True when hypothesis is non-placeholder text.
 * @param {string} hypothesis
 * @returns {boolean}
 */
function hasHypothesis(hypothesis) {
  const s = String(hypothesis || "").trim();
  if (!s) return false;
  if (/^what do we believe/i.test(s)) return false;
  if (/^what must be true/i.test(s)) return false;
  return s.length >= 8;
}

/**
 * Validate fields required before leaving Backlog.
 * @param {Partial<TicketFields>} fields
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateBacklogReady(fields = {}) {
  const f = { ...EMPTY_FIELDS, ...fields };
  /** @type {string[]} */
  const errors = [];
  if (!hasHypothesis(f.hypothesis)) {
    errors.push("Hypothesis must be a written assumption (not the template placeholder).");
  }
  if (!hasNumericKillCriteria(f.measure)) {
    errors.push(
      "Measure must include numeric kill criteria (e.g. “kill <40% · 4 weeks”)."
    );
  }
  const build = String(f.build || "").trim();
  if (
    !build ||
    /^what exactly are we building/i.test(build) ||
    /^smallest change or process/i.test(build)
  ) {
    errors.push("Build must describe the smallest test to ship.");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * @param {Partial<TicketFields>} fields
 * @returns {string}
 */
function experimentTitle(fields = {}) {
  const h = String(fields.hypothesis || "").trim();
  if (!h || /^what do we believe/i.test(h)) return "BML: new experiment";
  const oneLine = h.replace(/\s+/g, " ").slice(0, 72);
  return `BML: ${oneLine}`;
}

module.exports = {
  SECTIONS,
  EMPTY_FIELDS,
  PLACEHOLDERS,
  formatTicketBody,
  parseTicketBody,
  hasNumericKillCriteria,
  hasHypothesis,
  validateBacklogReady,
  experimentTitle,
};
