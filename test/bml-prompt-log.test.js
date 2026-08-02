"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  writePromptLog,
  readLatestPrompt,
  promptLogPaths,
} = require("../src/lib/bml/prompt-log");

describe("prompt-log", () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let statePath;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-prompt-"));
    statePath = path.join(dir, "bml-state.json");
  });

  after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("writes latest + history and reads latest", () => {
    const paths = promptLogPaths({ statePath });
    assert.ok(paths.latest.includes("bml-prompt-latest"));
    const meta = writePromptLog("Hello from /ask-matt skill body", {
      statePath,
      stepIndex: 0,
      command: "/ask-matt",
      label: "Ask Matt",
      chainPos: "Chain step 1/13",
    });
    assert.equal(meta.command, "/ask-matt");
    assert.ok(meta.charCount > 10);
    assert.ok(fs.existsSync(paths.latest));
    assert.ok(fs.existsSync(paths.history));
    const latest = readLatestPrompt({ statePath });
    assert.ok(latest && latest.includes("Hello from /ask-matt"));
    assert.ok(latest.includes("command: /ask-matt"));
  });
});
