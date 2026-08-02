"use strict";

/**
 * Terminal-friendly rendering of the BML Process (skill chain + cost + prompts).
 * Used by `scripts/bml-live.js` and tests — pure string output, no I/O for core
 * render (optional prompt text is passed in).
 */

const {
  SKILL_CHAIN,
  estimateChainCost,
  formatCostEstimate,
  formatDuration,
  formatTokens,
} = require("./skill-chain");
const { normalizeState } = require("./state");

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  strike: "\x1b[9m",
  clearHome: "\x1b[H\x1b[2J",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

/**
 * Build cost line from normalized state (mirrors coach.getView cost logic).
 * @param {import('./state').BmlState} state
 * @param {number} [now]
 */
function costLineFromState(state, now = Date.now()) {
  const pre = estimateChainCost({ fromIndex: 0 });
  const rc = state.runCost || {};
  if (rc.running) {
    let elapsedMs = rc.elapsedMs || 0;
    if (rc.startedAt) elapsedMs = Math.max(elapsedMs, now - rc.startedAt);
    const tok = (rc.tokensIn || 0) + (rc.tokensOutEst || 0);
    return formatCostEstimate({
      running: true,
      stepIndex: Math.min(rc.step || 0, rc.total || SKILL_CHAIN.length),
      steps: rc.total || SKILL_CHAIN.length,
      seconds: elapsedMs / 1000,
      tokens: tok,
    });
  }
  if (rc.lastDurationMs != null && rc.lastTokensEst != null) {
    return `Last ${formatDuration(rc.lastDurationMs / 1000)} · ~${formatTokens(rc.lastTokensEst)}  ·  Est. ${pre.label}`;
  }
  return `Est. ${pre.label}`;
}

/**
 * @param {unknown} rawState
 * @param {{
 *   color?: boolean,
 *   now?: number,
 *   width?: number,
 *   promptText?: string|null,
 *   maxPromptLines?: number,
 * }} [opts]
 * @returns {string}
 */
function renderBmlLive(rawState, opts = {}) {
  const color = opts.color !== false;
  const now = opts.now ?? Date.now();
  const state = normalizeState(rawState);
  const c = color ? ANSI : null;
  const wrap = (code, text) => (c ? `${code}${text}${c.reset}` : text);
  const cols = Math.max(48, Math.min(100, opts.width || 72));

  const idx = Math.max(0, Math.min(SKILL_CHAIN.length, state.buildStepIndex || 0));
  const rc = state.runCost || {};
  const running = Boolean(rc.running);
  let liveElapsedMs = rc.elapsedMs || 0;
  if (running && rc.startedAt) {
    liveElapsedMs = Math.max(liveElapsedMs, now - rc.startedAt);
  }

  const title = state.activeIssue?.title || "BML Process";
  const repo = state.activeIssue?.repo || "";
  const stage = state.stage || "Backlog";

  const lines = [];
  lines.push(wrap(c ? c.bold + c.cyan : "", "BML Process — live"));
  lines.push(wrap(c ? c.dim : "", "─".repeat(cols)));
  lines.push(
    `${wrap(c ? c.bold : "", "Stage")}  ${stage}` +
      (running
        ? wrap(c ? c.blue : "", "  ● running (carte blanche)")
        : wrap(c ? c.dim : "", "  ○ idle"))
  );
  lines.push(`${wrap(c ? c.bold : "", "Job")}    ${title}`);
  if (repo) lines.push(`${wrap(c ? c.dim : "", "Cwd")}    ${repo}`);

  // Prominent wall-clock elapsed for the whole run
  if (running) {
    lines.push(
      `${wrap(c ? c.bold + c.blue : "", "Elapsed")} ${formatDuration(liveElapsedMs / 1000)}` +
        wrap(
          c ? c.dim : "",
          `  (whole run · step ${Math.min(rc.step || idx + 1, rc.total || SKILL_CHAIN.length)}/${rc.total || SKILL_CHAIN.length})`
        )
    );
    const tok = (rc.tokensIn || 0) + (rc.tokensOutEst || 0);
    lines.push(
      `${wrap(c ? c.bold : "", "Tokens")} ~${formatTokens(tok)}` +
        wrap(c ? c.dim : "", " in+out est")
    );
  } else {
    lines.push(`${wrap(c ? c.bold : "", "Cost")}   ${costLineFromState(state, now)}`);
  }
  lines.push("");

  const doneCount = Math.min(idx, SKILL_CHAIN.length);
  const pct =
    SKILL_CHAIN.length > 0
      ? Math.round((doneCount / SKILL_CHAIN.length) * 100)
      : 0;
  const barW = 24;
  const filled = Math.round((doneCount / SKILL_CHAIN.length) * barW) || 0;
  const bar =
    "[" +
    "█".repeat(Math.max(0, filled)) +
    "░".repeat(Math.max(0, barW - filled)) +
    "]";
  lines.push(
    `${wrap(c ? c.bold : "", "Progress")} ${bar} ${doneCount}/${SKILL_CHAIN.length} (${pct}%)`
  );
  lines.push("");

  for (let i = 0; i < SKILL_CHAIN.length; i++) {
    const step = SKILL_CHAIN[i];
    const n = String(i + 1).padStart(2, " ");
    const done = i < idx;
    const active = i === idx && idx < SKILL_CHAIN.length;
    let mark;
    let row;
    const text = `${n} ${step.command.padEnd(30)} ${step.label}`;
    if (done) {
      mark = wrap(c ? c.green : "", "✓");
      row = wrap(c ? c.dim + c.strike : "", text);
    } else if (active) {
      mark = wrap(c ? c.blue + c.bold : "", "►");
      row = wrap(c ? c.blue + c.bold : "", text);
    } else {
      mark = wrap(c ? c.dim : "", "·");
      row = wrap(c ? c.dim : "", text);
    }
    lines.push(` ${mark} ${row}`);
  }

  lines.push("");
  if (state.lastError) {
    lines.push(wrap(c ? c.red : "", `Error  ${state.lastError}`));
  }
  if (state.lastInject) {
    const inj = state.lastInject;
    const ok = inj.ok ? wrap(c ? c.green : "", "ok") : wrap(c ? c.red : "", "fail");
    const detail = (inj.detail || "").replace(/\s+/g, " ").slice(0, 100);
    lines.push(
      `${wrap(c ? c.dim : "", "Inject")} ${ok} · ${inj.method || "—"} · ${detail}`
    );
  }

  // Live prompt section — full text the coach copies for Cursor Agent
  const lp = state.lastPrompt;
  lines.push("");
  lines.push(wrap(c ? c.bold + c.yellow : "", "Live prompt → Cursor Agent"));
  lines.push(wrap(c ? c.dim : "", "─".repeat(cols)));
  if (lp?.command) {
    lines.push(
      wrap(
        c ? c.cyan : "",
        `step ${lp.stepIndex != null ? lp.stepIndex + 1 : "?"} ${lp.command}` +
          (lp.label ? ` (${lp.label})` : "") +
          (lp.charCount ? ` · ${lp.charCount} chars` : "")
      )
    );
    if (lp.at) lines.push(wrap(c ? c.dim : "", lp.at));
  }

  const promptText = opts.promptText != null ? opts.promptText : null;
  if (promptText && String(promptText).trim()) {
    const maxLines = opts.maxPromptLines ?? 40;
    const pLines = String(promptText).split(/\r?\n/);
    const slice =
      pLines.length > maxLines
        ? pLines.slice(0, maxLines).concat([`… (${pLines.length - maxLines} more lines)`])
        : pLines;
    for (const pl of slice) {
      lines.push(wrap(c ? c.dim : "", pl.length > cols ? pl.slice(0, cols - 1) + "…" : pl));
    }
  } else if (lp?.preview) {
    lines.push(wrap(c ? c.dim : "", lp.preview));
    if (lp.path) {
      lines.push(wrap(c ? c.dim : "", `full: ${lp.path}`));
    }
  } else {
    lines.push(wrap(c ? c.dim : "", "(no prompt yet — run a skill from the Meter)"));
  }

  lines.push(wrap(c ? c.dim : "", "─".repeat(cols)));
  lines.push(
    wrap(
      c ? c.dim : "",
      running
        ? "Live elapsed ticks every 250ms · prompts refresh on each inject · Ctrl+C quit"
        : "Watching bml-state + prompt log · click a skill in Meter or Run all · Ctrl+C quit"
    )
  );

  return lines.join("\n") + "\n";
}

module.exports = {
  ANSI,
  renderBmlLive,
  costLineFromState,
};
