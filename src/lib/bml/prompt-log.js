"use strict";

/**
 * Persist BML inject prompts for live terminal tailing.
 * Files sit next to bml-state.json:
 *   bml-prompt-latest.txt  — current/last full prompt
 *   bml-prompts.log        — append-only history
 */

const fs = require("fs");
const path = require("path");
const { defaultStatePath } = require("./state");

/**
 * @param {{ statePath?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function promptLogPaths(opts = {}) {
  const env = opts.env ?? process.env;
  if (env.CUM_BML_PROMPT_LOG || env.GUM_BML_PROMPT_LOG) {
    const p = env.CUM_BML_PROMPT_LOG || env.GUM_BML_PROMPT_LOG;
    return {
      latest: p,
      history: p.replace(/(\.log|\.txt)?$/, "") + "-history.log",
      dir: path.dirname(p),
    };
  }
  const statePath = opts.statePath || defaultStatePath({ env });
  const dir = path.dirname(statePath);
  return {
    latest: path.join(dir, "bml-prompt-latest.txt"),
    history: path.join(dir, "bml-prompts.log"),
    dir,
  };
}

/**
 * @param {string} prompt
 * @param {{
 *   stepIndex?: number,
 *   command?: string,
 *   label?: string,
 *   chainPos?: string,
 *   statePath?: string,
 *   env?: NodeJS.ProcessEnv,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   appendFileSync?: typeof fs.appendFileSync,
 *   mkdirSync?: typeof fs.mkdirSync,
 * }} [opts]
 */
function writePromptLog(prompt, opts = {}) {
  const write = opts.writeFileSync || fs.writeFileSync;
  const append = opts.appendFileSync || fs.appendFileSync;
  const mkdir = opts.mkdirSync || fs.mkdirSync;
  const paths = promptLogPaths({
    statePath: opts.statePath,
    env: opts.env,
  });
  const at = new Date().toISOString();
  const step =
    opts.stepIndex != null ? Number(opts.stepIndex) + 1 : "?";
  const cmd = opts.command || "?";
  const label = opts.label || "";
  const header = [
    `=== BML prompt ${at} ===`,
    `step: ${step}`,
    `command: ${cmd}`,
    label ? `label: ${label}` : null,
    opts.chainPos ? `chain: ${opts.chainPos}` : null,
    `chars: ${String(prompt || "").length}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");
  const body = `${header}\n${prompt || ""}\n\n`;

  try {
    mkdir(paths.dir, { recursive: true });
    write(paths.latest, body, "utf8");
    append(paths.history, body, "utf8");
  } catch {
    // best effort — inject still proceeds
  }

  return {
    at,
    path: paths.latest,
    historyPath: paths.history,
    stepIndex: opts.stepIndex ?? null,
    command: cmd,
    label,
    charCount: String(prompt || "").length,
    preview: String(prompt || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240),
  };
}

/**
 * @param {{ statePath?: string, env?: NodeJS.ProcessEnv, readFileSync?: typeof fs.readFileSync, maxChars?: number }} [opts]
 * @returns {string|null}
 */
function readLatestPrompt(opts = {}) {
  const read = opts.readFileSync || fs.readFileSync;
  const max = opts.maxChars ?? 12_000;
  const { latest } = promptLogPaths({
    statePath: opts.statePath,
    env: opts.env,
  });
  try {
    const text = read(latest, "utf8");
    if (text.length <= max) return text;
    return text.slice(0, max) + "\n… [truncated for terminal]\n";
  } catch {
    return null;
  }
}

module.exports = {
  promptLogPaths,
  writePromptLog,
  readLatestPrompt,
};
