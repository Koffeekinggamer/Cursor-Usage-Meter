"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { STAGES } = require("./gates");
const { tinyImplementIndex } = require("./skill-chain");
const { getMeterDataDir } = require("../paths");

/**
 * @typedef {{ number: number, url: string, title: string, repo: string, itemId?: string|null }} ActiveIssue
 * @typedef {{
 *   panelOpen: boolean,
 *   activeIssue: ActiveIssue|null,
 *   stage: import('./gates').Stage,
 *   buildStepIndex: number,
 *   tinyBuild: boolean,
 *   measure: {
 *     weekNotes: Array<{ at: string, text: string, value?: string|null }>,
 *     lastPostedAt: string|null,
 *     durationElapsed: boolean,
 *     killHit: boolean,
 *   },
 *   learn: {
 *     decisionLabel: 'persevere'|'pivot'|'kill-candidate'|null,
 *     evidenceWritten: boolean,
 *   },
 *   build: {
 *     smallestTestShipped: boolean,
 *     measurePathNamed: boolean,
 *   },
 *   fields: import('./template').TicketFields|null,
 *   wipActive: number|null,
 *   lastError: string|null,
 *   lastInject: { ok: boolean, method: string, detail?: string }|null,
 *   lastPrompt: {
 *     at: string|null,
 *     stepIndex: number|null,
 *     command: string|null,
 *     label: string|null,
 *     charCount: number,
 *     preview: string|null,
 *     path: string|null,
 *   }|null,
 *   runCost: {
 *     running: boolean,
 *     step: number,
 *     total: number,
 *     startedAt: number|null,
 *     elapsedMs: number,
 *     tokensIn: number,
 *     tokensOutEst: number,
 *     lastDurationMs: number|null,
 *     lastTokensEst: number|null,
 *   },
 * }} BmlState
 */

/**
 * @returns {BmlState}
 */
function emptyBmlState() {
  return {
    panelOpen: false,
    activeIssue: null,
    stage: "Backlog",
    buildStepIndex: 0,
    tinyBuild: false,
    measure: {
      weekNotes: [],
      lastPostedAt: null,
      durationElapsed: false,
      killHit: false,
    },
    learn: {
      decisionLabel: null,
      evidenceWritten: false,
    },
    build: {
      smallestTestShipped: false,
      measurePathNamed: false,
    },
    fields: null,
    wipActive: null,
    lastError: null,
    lastInject: null,
    lastPrompt: null,
    runCost: {
      running: false,
      step: 0,
      total: 0,
      startedAt: null,
      elapsedMs: 0,
      tokensIn: 0,
      tokensOutEst: 0,
      lastDurationMs: null,
      lastTokensEst: null,
    },
  };
}

/**
 * Resolve path for persisted BML state.
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, appData?: string }} [opts]
 */
function defaultStatePath(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.CUM_BML_STATE || env.GUM_BML_STATE) {
    return env.CUM_BML_STATE || env.GUM_BML_STATE;
  }
  if (env.CUM_DATA_DIR || env.GUM_DATA_DIR) {
    return path.join(env.CUM_DATA_DIR || env.GUM_DATA_DIR, "bml-state.json");
  }
  if (opts.appData) return path.join(opts.appData, "bml-state.json");
  const home = opts.home ?? os.homedir();
  return path.join(getMeterDataDir({ home, env }), "bml-state.json");
}

/**
 * @param {unknown} raw
 * @returns {BmlState}
 */
function normalizeState(raw) {
  const base = emptyBmlState();
  if (!raw || typeof raw !== "object") return base;
  const r = /** @type {Record<string, unknown>} */ (raw);

  const stage = STAGES.includes(/** @type {any} */ (r.stage))
    ? /** @type {import('./gates').Stage} */ (r.stage)
    : base.stage;

  let activeIssue = null;
  if (r.activeIssue && typeof r.activeIssue === "object") {
    const a = /** @type {Record<string, unknown>} */ (r.activeIssue);
    if (typeof a.number === "number" && typeof a.url === "string") {
      activeIssue = {
        number: a.number,
        url: a.url,
        title: typeof a.title === "string" ? a.title : `Issue #${a.number}`,
        repo: typeof a.repo === "string" ? a.repo : "",
        itemId: typeof a.itemId === "string" ? a.itemId : null,
      };
    }
  }

  const measureIn =
    r.measure && typeof r.measure === "object"
      ? /** @type {Record<string, unknown>} */ (r.measure)
      : {};
  const learnIn =
    r.learn && typeof r.learn === "object"
      ? /** @type {Record<string, unknown>} */ (r.learn)
      : {};
  const buildIn =
    r.build && typeof r.build === "object"
      ? /** @type {Record<string, unknown>} */ (r.build)
      : {};

  return {
    panelOpen: Boolean(r.panelOpen),
    activeIssue,
    stage,
    buildStepIndex: Number.isFinite(Number(r.buildStepIndex))
      ? Math.max(0, Math.floor(Number(r.buildStepIndex)))
      : 0,
    tinyBuild: Boolean(r.tinyBuild),
    measure: {
      weekNotes: Array.isArray(measureIn.weekNotes)
        ? measureIn.weekNotes.filter(
            (n) => n && typeof n === "object" && typeof n.text === "string"
          )
        : [],
      lastPostedAt:
        typeof measureIn.lastPostedAt === "string"
          ? measureIn.lastPostedAt
          : null,
      durationElapsed: Boolean(measureIn.durationElapsed),
      killHit: Boolean(measureIn.killHit),
    },
    learn: {
      decisionLabel: ["persevere", "pivot", "kill-candidate"].includes(
        /** @type {any} */ (learnIn.decisionLabel)
      )
        ? /** @type {any} */ (learnIn.decisionLabel)
        : null,
      evidenceWritten: Boolean(learnIn.evidenceWritten),
    },
    build: {
      smallestTestShipped: Boolean(buildIn.smallestTestShipped),
      measurePathNamed: Boolean(buildIn.measurePathNamed),
    },
    fields:
      r.fields && typeof r.fields === "object"
        ? /** @type {any} */ (r.fields)
        : null,
    wipActive: Number.isFinite(Number(r.wipActive))
      ? Number(r.wipActive)
      : null,
    lastError: typeof r.lastError === "string" ? r.lastError : null,
    lastInject:
      r.lastInject && typeof r.lastInject === "object"
        ? /** @type {any} */ (r.lastInject)
        : null,
    lastPrompt: normalizeLastPrompt(r.lastPrompt),
    runCost: normalizeRunCost(r.runCost),
  };
}

/**
 * @param {unknown} raw
 */
function normalizeLastPrompt(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = /** @type {Record<string, unknown>} */ (raw);
  return {
    at: typeof p.at === "string" ? p.at : null,
    stepIndex: Number.isFinite(Number(p.stepIndex))
      ? Math.max(0, Math.floor(Number(p.stepIndex)))
      : null,
    command: typeof p.command === "string" ? p.command : null,
    label: typeof p.label === "string" ? p.label : null,
    charCount: Number.isFinite(Number(p.charCount))
      ? Math.max(0, Number(p.charCount))
      : 0,
    preview: typeof p.preview === "string" ? p.preview : null,
    path: typeof p.path === "string" ? p.path : null,
  };
}

/**
 * @param {unknown} raw
 */
function normalizeRunCost(raw) {
  const base = emptyBmlState().runCost;
  if (!raw || typeof raw !== "object") return base;
  const c = /** @type {Record<string, unknown>} */ (raw);
  return {
    running: Boolean(c.running),
    step: Number.isFinite(Number(c.step)) ? Math.max(0, Math.floor(Number(c.step))) : 0,
    total: Number.isFinite(Number(c.total)) ? Math.max(0, Math.floor(Number(c.total))) : 0,
    startedAt: Number.isFinite(Number(c.startedAt)) ? Number(c.startedAt) : null,
    elapsedMs: Number.isFinite(Number(c.elapsedMs)) ? Math.max(0, Number(c.elapsedMs)) : 0,
    tokensIn: Number.isFinite(Number(c.tokensIn)) ? Math.max(0, Number(c.tokensIn)) : 0,
    tokensOutEst: Number.isFinite(Number(c.tokensOutEst))
      ? Math.max(0, Number(c.tokensOutEst))
      : 0,
    lastDurationMs:
      c.lastDurationMs == null
        ? null
        : Number.isFinite(Number(c.lastDurationMs))
          ? Math.max(0, Number(c.lastDurationMs))
          : null,
    lastTokensEst:
      c.lastTokensEst == null
        ? null
        : Number.isFinite(Number(c.lastTokensEst))
          ? Math.max(0, Number(c.lastTokensEst))
          : null,
  };
}

/**
 * @param {string} filePath
 * @param {{ readFileSync?: typeof fs.readFileSync }} [io]
 * @returns {BmlState}
 */
function loadBmlState(filePath, io = {}) {
  const read = io.readFileSync || fs.readFileSync;
  try {
    const raw = read(filePath, "utf8");
    return normalizeState(JSON.parse(String(raw)));
  } catch {
    return emptyBmlState();
  }
}

/**
 * @param {string} filePath
 * @param {BmlState} state
 * @param {{ writeFileSync?: typeof fs.writeFileSync, mkdirSync?: typeof fs.mkdirSync }} [io]
 */
function saveBmlState(filePath, state, io = {}) {
  const write = io.writeFileSync || fs.writeFileSync;
  const mkdir = io.mkdirSync || fs.mkdirSync;
  const dir = path.dirname(filePath);
  mkdir(dir, { recursive: true });
  write(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Pure reducer for BML coach actions.
 * @param {BmlState|null|undefined} previous
 * @param {{ type: string, [k: string]: unknown }} action
 * @returns {BmlState}
 */
function reduceBmlState(previous, action) {
  const prev = previous ? normalizeState(previous) : emptyBmlState();
  const type = action?.type;

  switch (type) {
    case "panel/open":
      return { ...prev, panelOpen: true, lastError: null };
    case "panel/close":
      return { ...prev, panelOpen: false };
    case "panel/toggle":
      return { ...prev, panelOpen: !prev.panelOpen, lastError: null };
    case "experiment/set":
      return {
        ...prev,
        activeIssue: /** @type {ActiveIssue|null} */ (action.issue ?? null),
        stage: /** @type {any} */ (action.stage) || prev.stage,
        fields: action.fields != null ? /** @type {any} */ (action.fields) : prev.fields,
        buildStepIndex: 0,
        lastError: null,
      };
    case "experiment/clear":
      return {
        ...emptyBmlState(),
        panelOpen: prev.panelOpen,
      };
    case "stage/set":
      return {
        ...prev,
        stage: /** @type {any} */ (action.stage) || prev.stage,
        lastError: null,
      };
    case "build/step":
      return {
        ...prev,
        buildStepIndex: Math.max(0, Math.floor(Number(action.index) || 0)),
      };
    case "build/tiny":
      return {
        ...prev,
        tinyBuild: true,
        buildStepIndex: tinyImplementIndex(),
      };
    case "build/flags":
      return {
        ...prev,
        build: {
          smallestTestShipped:
            action.smallestTestShipped != null
              ? Boolean(action.smallestTestShipped)
              : prev.build.smallestTestShipped,
          measurePathNamed:
            action.measurePathNamed != null
              ? Boolean(action.measurePathNamed)
              : prev.build.measurePathNamed,
        },
      };
    case "measure/note": {
      const note = {
        at: typeof action.at === "string" ? action.at : new Date().toISOString(),
        text: String(action.text || ""),
        value: action.value != null ? String(action.value) : null,
      };
      return {
        ...prev,
        measure: {
          ...prev.measure,
          weekNotes: [...prev.measure.weekNotes, note],
          lastPostedAt: note.at,
        },
      };
    }
    case "measure/flags":
      return {
        ...prev,
        measure: {
          ...prev.measure,
          durationElapsed:
            action.durationElapsed != null
              ? Boolean(action.durationElapsed)
              : prev.measure.durationElapsed,
          killHit:
            action.killHit != null
              ? Boolean(action.killHit)
              : prev.measure.killHit,
        },
      };
    case "learn/decision":
      return {
        ...prev,
        learn: {
          decisionLabel: /** @type {any} */ (action.decisionLabel) || null,
          evidenceWritten:
            action.evidenceWritten != null
              ? Boolean(action.evidenceWritten)
              : prev.learn.evidenceWritten,
        },
      };
    case "fields/set":
      return {
        ...prev,
        fields: action.fields != null ? /** @type {any} */ (action.fields) : null,
      };
    case "wip/set":
      return {
        ...prev,
        wipActive: Number.isFinite(Number(action.wipActive))
          ? Number(action.wipActive)
          : null,
      };
    case "error":
      return {
        ...prev,
        lastError: action.message != null ? String(action.message) : null,
      };
    case "inject/result":
      return {
        ...prev,
        lastInject: {
          ok: Boolean(action.ok),
          method: String(action.method || "unknown"),
          detail: action.detail != null ? String(action.detail) : undefined,
        },
        lastError: action.ok
          ? null
          : action.detail
            ? String(action.detail)
            : prev.lastError,
      };
    case "prompt/set":
      return {
        ...prev,
        lastPrompt:
          action.prompt && typeof action.prompt === "object"
            ? normalizeLastPrompt(action.prompt)
            : null,
      };
    case "run/cost":
      return {
        ...prev,
        runCost: {
          ...prev.runCost,
          ...(action.patch && typeof action.patch === "object"
            ? action.patch
            : {}),
        },
      };
    case "run/reset":
      // Cancel / full process reset: clear progress, timers, inject + prompt
      return {
        ...prev,
        buildStepIndex: 0,
        lastError: null,
        lastInject: null,
        lastPrompt: null,
        runCost: {
          ...emptyBmlState().runCost,
        },
      };
    default:
      return prev;
  }
}

module.exports = {
  emptyBmlState,
  defaultStatePath,
  normalizeState,
  loadBmlState,
  saveBmlState,
  reduceBmlState,
};
