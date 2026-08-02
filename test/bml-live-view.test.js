"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { renderBmlLive, costLineFromState } = require("../src/lib/bml/live-view");
const { emptyBmlState } = require("../src/lib/bml/state");

describe("renderBmlLive", () => {
  it("renders title and all 13 chain steps", () => {
    const out = renderBmlLive(emptyBmlState(), { color: false });
    assert.match(out, /BML Process/);
    assert.match(out, /\/ask-matt/);
    assert.match(out, /\/implement/);
    assert.match(out, /\/code-review/);
    assert.match(out, /Est\./);
    assert.match(out, /0\/13/);
  });

  it("marks completed steps and active current", () => {
    const state = {
      ...emptyBmlState(),
      stage: "Build",
      buildStepIndex: 2,
      activeIssue: {
        number: 0,
        url: "",
        title: "BML: demo",
        repo: "/tmp/demo",
        itemId: null,
      },
    };
    const out = renderBmlLive(state, { color: false });
    assert.match(out, /BML: demo/);
    assert.match(out, /2\/13/);
    assert.match(out, /►/);
    assert.match(out, /✓/);
  });

  it("shows running cost with step progress", () => {
    const state = {
      ...emptyBmlState(),
      buildStepIndex: 3,
      runCost: {
        running: true,
        step: 3,
        total: 13,
        startedAt: Date.now() - 90_000,
        elapsedMs: 90_000,
        tokensIn: 10_000,
        tokensOutEst: 20_000,
        lastDurationMs: null,
        lastTokensEst: null,
      },
    };
    const out = renderBmlLive(state, { color: false, now: Date.now() });
    assert.match(out, /running/);
    assert.match(out, /3\/13/);
    assert.match(out, /Elapsed/i);
  });

  it("includes live prompt text when provided", () => {
    const state = {
      ...emptyBmlState(),
      lastPrompt: {
        at: "2026-01-01T00:00:00.000Z",
        stepIndex: 0,
        command: "/ask-matt",
        label: "Ask Matt",
        charCount: 42,
        preview: "short preview",
        path: "/tmp/bml-prompt-latest.txt",
      },
    };
    const out = renderBmlLive(state, {
      color: false,
      promptText: "=== BML prompt ===\n/ask-matt\nhello admin job",
    });
    assert.match(out, /Live prompt/);
    assert.match(out, /ask-matt/);
    assert.match(out, /hello admin job/);
  });
});

describe("costLineFromState", () => {
  it("returns Est. when idle", () => {
    const line = costLineFromState(emptyBmlState());
    assert.match(line, /^Est\./);
  });
});
