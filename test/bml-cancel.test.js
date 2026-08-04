"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createBmlCoach } = require("../src/lib/bml/coach");

describe("BML cancel", () => {
  it("cancelRun stops chain before remaining skills", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-cancel-"));
    const statePath = path.join(dir, "bml-state.json");
    const proj = path.join(dir, "app");
    fs.mkdirSync(proj);
    fs.writeFileSync(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "cancel-app" })
    );
    let injects = 0;
    /** @type {ReturnType<typeof createBmlCoach>} */
    let coach;
    const inject = async () => {
      injects += 1;
      if (injects === 1) {
        // Cancel mid-chain after first skill starts
        setTimeout(() => coach.cancelRun(), 0);
        await new Promise((r) => setTimeout(r, 20));
      }
      return { ok: true, method: "headless", detail: "ok" };
    };
    coach = createBmlCoach({ statePath, inject });
    coach.setSelectedProject(proj);
    const view = await coach.runAllSkillSteps();
    assert.ok(injects >= 1);
    assert.ok(injects < 6, `expected early stop, got ${injects} injects`);
    assert.equal(view.runCost.running, false);
    assert.equal(view.buildStepIndex, 0, "strikethroughs cleared");
    assert.equal(view.runCost.elapsedMs, 0);
    assert.equal(view.runCost.lastDurationMs, null);
    assert.equal(view.runCost.startedAt, null);
    assert.equal(view.lastInject, null);
    assert.equal(view.lastError, null);
    assert.equal(view.lastPrompt, null);
    assert.ok(view.skillChain.every((s) => !s.done), "no done strikethroughs");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("cancelRun resets progress, timers, and process when idle or mid-progress", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-cancel-idle-"));
    const statePath = path.join(dir, "bml-state.json");
    const coach = createBmlCoach({
      statePath,
      inject: async () => ({ ok: true, method: "headless", detail: "ok" }),
    });
    // Simulate mid-chain progress + running timer
    coach.setStep(5);
    coach.getState(); // ensure loaded
    // force runCost via cancel after manual-ish path: set step then cancel
    const mid = coach.setStep(4);
    assert.equal(mid.buildStepIndex, 4);
    const view = coach.cancelRun();
    assert.equal(view.runCost.running, false);
    assert.equal(view.buildStepIndex, 0);
    assert.equal(view.runCost.elapsedMs, 0);
    assert.equal(view.runCost.lastDurationMs, null);
    assert.equal(view.runCost.tokensIn, 0);
    assert.equal(view.lastInject, null);
    assert.equal(view.lastError, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
