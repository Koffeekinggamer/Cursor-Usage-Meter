"use strict";

const { validateBacklogReady, parseTicketBody } = require("./template");

/** Max active cards in Build + Measure combined (team of 3). */
const WIP_LIMIT = 3;

/** @typedef {'Backlog'|'Build'|'Measure'|'Learn'|'Done'} Stage */

const STAGES = Object.freeze([
  "Backlog",
  "Build",
  "Measure",
  "Learn",
  "Done",
]);

/**
 * @typedef {{
 *   stage: Stage,
 *   body?: string|null,
 *   fields?: import('./template').TicketFields|null,
 *   hasExperimentLabel?: boolean,
 *   wipActive?: number,
 *   smallestTestShipped?: boolean,
 *   measurePathNamed?: boolean,
 *   weeklyNumbersPosted?: boolean,
 *   durationElapsed?: boolean,
 *   killHit?: boolean,
 *   decisionLabel?: 'persevere'|'pivot'|'kill-candidate'|null,
 *   evidenceWritten?: boolean,
 * }} GateContext
 */

/**
 * @param {Stage} from
 * @param {Stage} to
 * @returns {boolean}
 */
function isForwardTransition(from, to) {
  const a = STAGES.indexOf(from);
  const b = STAGES.indexOf(to);
  return a >= 0 && b === a + 1;
}

/**
 * Check whether a stage transition is allowed.
 * @param {Stage} from
 * @param {Stage} to
 * @param {GateContext} [ctx]
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function canAdvanceStage(from, to, ctx = {}) {
  /** @type {string[]} */
  const errors = [];

  if (!STAGES.includes(from) || !STAGES.includes(to)) {
    return { ok: false, errors: ["Unknown stage."] };
  }
  if (from === to) return { ok: true };
  if (!isForwardTransition(from, to)) {
    return {
      ok: false,
      errors: [`Can only move forward one column (${from} → next).`],
    };
  }

  const fields =
    ctx.fields ||
    (ctx.body ? parseTicketBody(ctx.body) : null) ||
    undefined;

  if (from === "Backlog" && to === "Build") {
    if (ctx.hasExperimentLabel === false) {
      errors.push("Issue must have the experiment label.");
    }
    const wip = Number(ctx.wipActive);
    if (Number.isFinite(wip) && wip >= WIP_LIMIT) {
      errors.push(
        `WIP limit: max ${WIP_LIMIT} active in Build + Measure (currently ${wip}).`
      );
    }
    if (fields) {
      const v = validateBacklogReady(fields);
      if (!v.ok) errors.push(...v.errors);
    } else {
      errors.push("Hypothesis + numeric kill criteria required on the issue.");
    }
  }

  if (from === "Build" && to === "Measure") {
    if (ctx.smallestTestShipped === false) {
      errors.push("Confirm the smallest test has shipped (or link a PR).");
    }
    if (ctx.measurePathNamed === false) {
      errors.push("Name the measure path (events or manual log) before Measure.");
    }
  }

  if (from === "Measure" && to === "Learn") {
    const timeOrKill = ctx.durationElapsed === true || ctx.killHit === true;
    if (!timeOrKill) {
      errors.push("Duration must elapse or kill threshold must be hit.");
    }
    if (ctx.weeklyNumbersPosted === false) {
      errors.push("Post weekly numbers on the issue before Learn.");
    }
  }

  if (from === "Learn" && to === "Done") {
    const label = ctx.decisionLabel;
    if (!label || !["persevere", "pivot", "kill-candidate"].includes(label)) {
      errors.push(
        "Apply a Learn decision label: persevere, pivot, or kill-candidate."
      );
    }
    if (ctx.evidenceWritten === false) {
      errors.push("Write Decision + Evidence on the issue.");
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Default next stage name.
 * @param {Stage} from
 * @returns {Stage|null}
 */
function nextStage(from) {
  const i = STAGES.indexOf(from);
  if (i < 0 || i >= STAGES.length - 1) return null;
  return /** @type {Stage} */ (STAGES[i + 1]);
}

module.exports = {
  WIP_LIMIT,
  STAGES,
  canAdvanceStage,
  nextStage,
  isForwardTransition,
};
