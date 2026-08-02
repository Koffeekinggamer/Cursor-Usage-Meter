#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { defaultStatePath, loadBmlState } = require("../src/lib/bml/state");
const { renderBmlLive, ANSI } = require("../src/lib/bml/live-view");
const { promptLogPaths, readLatestPrompt } = require("../src/lib/bml/prompt-log");

const once = process.argv.includes("--once");
const noColor = process.argv.includes("--no-color") || process.env.NO_COLOR === "1" || !process.stdout.isTTY;
const statePath = process.env.CUM_BML_STATE || process.env.GUM_BML_STATE || defaultStatePath();
const paths = promptLogPaths({ statePath });

function readState() {
  try { return fs.existsSync(statePath) ? loadBmlState(statePath) : null; } catch { return null; }
}
function frame() {
  const state = readState();
  const body = renderBmlLive(state || {}, {
    color: !noColor, now: Date.now(), width: process.stdout.columns || 72,
    promptText: readLatestPrompt({ statePath, maxChars: 16_000 }),
    maxPromptLines: Math.max(12, Math.min(50, (process.stdout.rows || 40) - 28)),
  });
  if (once || !process.stdout.isTTY) process.stdout.write(body);
  else {
    process.stdout.write(ANSI.clearHome + ANSI.hideCursor + body);
    process.stdout.write(`${noColor ? "" : ANSI.dim}state: ${statePath}\nprompts: ${paths.latest}${noColor ? "" : ANSI.reset}\n`);
  }
  return state;
}
if (once) { frame(); process.exit(0); }
let timer = null;
function tick() { const state = frame(); timer = setTimeout(tick, state?.runCost?.running ? 250 : 500); }
function shutdown() { if (timer) clearTimeout(timer); if (process.stdout.isTTY) process.stdout.write(ANSI.showCursor); process.stdout.write("\n"); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
tick();
for (const file of [path.dirname(statePath), paths.latest]) {
  try { fs.watch(file, { persistent: true }, frame); } catch {}
}
