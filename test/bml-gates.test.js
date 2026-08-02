"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { canAdvanceStage, nextStage, WIP_LIMIT } = require("../src/lib/bml/gates");

const readyFields = {
  hypothesis: "Customers act on weekly insights.",
  build: "Ship events only.",
  measure: "≥60% · kill <40% · 4 weeks",
  learn: "",
  acceptanceCriteria: "- [ ] events",
  technicalContext: "@src",
};

describe("canAdvanceStage", () => {
  it("blocks Backlog → Build without kill criteria", () => {
    const r = canAdvanceStage("Backlog", "Build", {
      fields: { ...readyFields, measure: "we will see" },
      hasExperimentLabel: true,
      wipActive: 0,
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /kill/i);
  });

  it("allows Backlog → Build when ready and under WIP", () => {
    const r = canAdvanceStage("Backlog", "Build", {
      fields: readyFields,
      hasExperimentLabel: true,
      wipActive: 2,
    });
    assert.equal(r.ok, true);
  });

  it("blocks when WIP at limit", () => {
    const r = canAdvanceStage("Backlog", "Build", {
      fields: readyFields,
      hasExperimentLabel: true,
      wipActive: WIP_LIMIT,
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /WIP/i);
  });

  it("requires Measure evidence before Learn", () => {
    const r = canAdvanceStage("Measure", "Learn", {
      durationElapsed: false,
      killHit: false,
      weeklyNumbersPosted: true,
    });
    assert.equal(r.ok, false);
  });

  it("allows Measure → Learn when kill hit and numbers posted", () => {
    const r = canAdvanceStage("Measure", "Learn", {
      killHit: true,
      weeklyNumbersPosted: true,
    });
    assert.equal(r.ok, true);
  });

  it("requires decision label for Learn → Done", () => {
    const r = canAdvanceStage("Learn", "Done", {
      decisionLabel: null,
      evidenceWritten: true,
    });
    assert.equal(r.ok, false);
  });

  it("nextStage walks the board", () => {
    assert.equal(nextStage("Backlog"), "Build");
    assert.equal(nextStage("Done"), null);
  });
});
