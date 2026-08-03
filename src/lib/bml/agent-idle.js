"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { latestActivityMs } = require("./active-session");

/**
 * Cursor project folder slug under ~/.cursor/projects.
 * /Users/foo/Bar Baz → Users-foo-Bar-Baz
 * @param {string} cwd
 */
function cursorProjectSlug(cwd) {
  const resolved = path.resolve(String(cwd || ""));
  return resolved.replace(/^\//, "").replace(/[/\\]+/g, "-").replace(/\s+/g, "-");
}

/**
 * @param {string} cwd
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function agentActivityRoots(cwd, opts = {}) {
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  const slug = cursorProjectSlug(cwd);
  const roots = [];
  if (env.CUM_BML_ACTIVITY_DIR) roots.push(env.CUM_BML_ACTIVITY_DIR);
  roots.push(path.join(home, ".cursor", "projects", slug, "agent-transcripts"));
  roots.push(path.join(home, ".cursor", "projects", slug));
  return roots;
}

/**
 * Newest mtime across known Cursor activity roots for a workspace.
 * @param {string} cwd
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   latestActivityMs?: typeof latestActivityMs,
 *   roots?: string[],
 * }} [opts]
 */
function latestAgentActivityMs(cwd, opts = {}) {
  const activity = opts.latestActivityMs || latestActivityMs;
  const roots = opts.roots || agentActivityRoots(cwd, opts);
  let latest = 0;
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const ms = activity(root, { maxEntries: 120 });
      if (ms > latest) latest = ms;
    } catch {
      // ignore
    }
  }
  return latest;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until Agent activity for cwd goes quiet long enough to treat the skill as done.
 * @param {{
 *   cwd?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   isCancelled?: () => boolean,
 *   onTick?: (info: { elapsedMs: number, quietMs: number, detail: string }) => void,
 *   latestAgentActivityMs?: typeof latestAgentActivityMs,
 *   sleep?: typeof sleep,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function waitForAgentIdle(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd || env.CUM_BML_CWD || process.cwd();
  const quietMs = Math.max(3_000, Number(env.CUM_BML_IDLE_MS) || 12_000);
  const minMs = Math.max(2_000, Number(env.CUM_BML_MIN_SKILL_MS) || 8_000);
  const maxMs = Math.max(minMs, Number(env.CUM_BML_MAX_SKILL_MS) || 45 * 60_000);
  const pollMs = Math.max(500, Number(env.CUM_BML_IDLE_POLL_MS) || 1_500);
  const startGraceMs = Math.max(500, Number(env.CUM_BML_START_GRACE_MS) || 2_500);
  const activityFn = opts.latestAgentActivityMs || latestAgentActivityMs;
  const wait = opts.sleep || sleep;

  const startedAt = Date.now();
  let baseline = activityFn(cwd, { env, home: opts.home });
  let lastChange = startedAt;
  let sawChange = false;

  await wait(startGraceMs);
  if (opts.isCancelled?.()) return { ok: false, reason: "cancel" };

  while (Date.now() - startedAt < maxMs) {
    if (opts.isCancelled?.()) return { ok: false, reason: "cancel" };

    const now = Date.now();
    const activity = activityFn(cwd, { env, home: opts.home });
    if (activity > baseline) {
      baseline = activity;
      lastChange = now;
      sawChange = true;
    }

    const elapsed = now - startedAt;
    const quietFor = now - lastChange;
    if (opts.onTick) {
      opts.onTick({
        elapsedMs: elapsed,
        quietMs: quietFor,
        detail: sawChange
          ? `Agent working… quiet ${Math.round(quietFor / 1000)}s`
          : `Waiting for Agent… ${Math.round(elapsed / 1000)}s`,
      });
    }

    if (elapsed >= minMs && quietFor >= quietMs) {
      return {
        ok: true,
        reason: sawChange ? "idle" : "idle-no-activity",
      };
    }

    await wait(pollMs);
  }

  return { ok: true, reason: "timeout" };
}

/**
 * Auto-continue after each pasted skill (default on).
 * @param {NodeJS.ProcessEnv} [env]
 */
function wantAutoContinue(env = process.env) {
  const v = env.CUM_BML_AUTO_CONTINUE;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

module.exports = {
  cursorProjectSlug,
  agentActivityRoots,
  latestAgentActivityMs,
  waitForAgentIdle,
  wantAutoContinue,
};
