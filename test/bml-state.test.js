"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyBmlState,
  reduceBmlState,
  normalizeState,
} = require("../src/lib/bml/state");
const { tinyImplementIndex } = require("../src/lib/bml/skill-chain");

describe("reduceBmlState", () => {
  it("toggles panel", () => {
    let s = emptyBmlState();
    s = reduceBmlState(s, { type: "panel/toggle" });
    assert.equal(s.panelOpen, true);
    s = reduceBmlState(s, { type: "panel/close" });
    assert.equal(s.panelOpen, false);
  });

  it("sets experiment and resets build step", () => {
    let s = reduceBmlState(emptyBmlState(), {
      type: "build/step",
      index: 4,
    });
    s = reduceBmlState(s, {
      type: "experiment/set",
      issue: {
        number: 1083,
        url: "https://example.com/1083",
        title: "Core Value",
        repo: "Book-IQ/bookiqv1-rc",
      },
      stage: "Build",
    });
    assert.equal(s.activeIssue.number, 1083);
    assert.equal(s.stage, "Build");
    assert.equal(s.buildStepIndex, 0);
  });

  it("tiny build jumps to implement", () => {
    const s = reduceBmlState(emptyBmlState(), { type: "build/tiny" });
    assert.equal(s.tinyBuild, true);
    assert.equal(s.buildStepIndex, tinyImplementIndex());
  });

  it("appends measure notes", () => {
    const s = reduceBmlState(emptyBmlState(), {
      type: "measure/note",
      text: "Week 1: 55% open+click",
      value: "55%",
      at: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(s.measure.weekNotes.length, 1);
    assert.equal(s.measure.lastPostedAt, "2026-08-01T00:00:00.000Z");
  });

  it("normalizes garbage input", () => {
    const s = normalizeState({ stage: "Nope", panelOpen: 1, buildStepIndex: -3 });
    assert.equal(s.stage, "Backlog");
    assert.equal(s.panelOpen, true);
    assert.equal(s.buildStepIndex, 0);
  });
});
