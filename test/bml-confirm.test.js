"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createBmlCoach } = require("../src/lib/bml/coach");

describe("BML clipboard confirm gate", () => {
  it("does not advance the chain after clipboard copy until confirm", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-confirm-"));
    const statePath = path.join(dir, "bml-state.json");
    let injects = 0;
    const coach = createBmlCoach({
      statePath,
      inject: async () => {
        injects += 1;
        return {
          ok: true,
          method: "clipboard",
          needsConfirm: true,
          detail: "copied",
        };
      },
    });

    const paused = await coach.runAllSkillSteps();
    assert.equal(injects, 1, "only first skill copied");
    assert.equal(paused.awaitingConfirm, true);
    assert.equal(paused.buildStepIndex, 0, "not struck through yet");
    assert.ok(paused.skillChain.every((s) => !s.done));

    const after = await coach.confirmInjectedStep({ continueChain: true });
    assert.equal(injects, 2, "next skill copied after confirm");
    assert.equal(after.buildStepIndex, 1);
    assert.equal(after.skillChain[0].done, true);
    assert.equal(after.awaitingConfirm, true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("advances immediately when inject does not need confirm (sdk)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-sdk-"));
    const statePath = path.join(dir, "bml-state.json");
    let injects = 0;
    const coach = createBmlCoach({
      statePath,
      inject: async () => {
        injects += 1;
        return { ok: true, method: "sdk-auto", detail: "ran" };
      },
    });
    const view = await coach.runSkillStep(0, { trackCost: true });
    assert.equal(injects, 1);
    assert.equal(view.awaitingConfirm, false);
    assert.equal(view.buildStepIndex, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
