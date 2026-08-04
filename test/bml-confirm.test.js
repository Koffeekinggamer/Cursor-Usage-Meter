"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createBmlCoach } = require("../src/lib/bml/coach");

describe("BML clipboard confirm gate", () => {
  let prevAuto;
  beforeEach(() => {
    prevAuto = process.env.CUM_BML_AUTO_CONTINUE;
  });
  afterEach(() => {
    if (prevAuto === undefined) delete process.env.CUM_BML_AUTO_CONTINUE;
    else process.env.CUM_BML_AUTO_CONTINUE = prevAuto;
  });

  it("does not advance the chain after clipboard copy until confirm when auto-continue is off", async () => {
    process.env.CUM_BML_AUTO_CONTINUE = "0";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-confirm-"));
    const statePath = path.join(dir, "bml-state.json");
    const proj = path.join(dir, "app");
    fs.mkdirSync(proj);
    fs.writeFileSync(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "confirm-app" })
    );
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
    coach.setSelectedProject(proj);

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

  it("auto-continues to the next skill after idle wait", async () => {
    process.env.CUM_BML_AUTO_CONTINUE = "1";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-auto-"));
    const statePath = path.join(dir, "bml-state.json");
    const proj = path.join(dir, "app");
    fs.mkdirSync(proj);
    fs.writeFileSync(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "auto-app" })
    );
    let injects = 0;
    let waits = 0;
    const coach = createBmlCoach({
      statePath,
      inject: async () => {
        injects += 1;
        return {
          ok: true,
          method: "clipboard",
          needsConfirm: true,
          detail: "pasted",
        };
      },
      waitForAgentIdle: async () => {
        waits += 1;
        // Stop after two skills so the test stays fast
        if (waits >= 2) {
          coach.cancelRun();
          return { ok: false, reason: "cancel" };
        }
        return { ok: true, reason: "idle" };
      },
    });
    coach.setSelectedProject(proj);

    await coach.runAllSkillSteps();
    assert.equal(injects, 2, "second skill started after auto-continue");
    assert.equal(waits, 2, "idle wait ran twice");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("advances immediately when inject does not need confirm (sdk)", async () => {
    process.env.CUM_BML_AUTO_CONTINUE = "0";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-sdk-"));
    const statePath = path.join(dir, "bml-state.json");
    const proj = path.join(dir, "app");
    fs.mkdirSync(proj);
    fs.writeFileSync(
      path.join(proj, "package.json"),
      JSON.stringify({ name: "sdk-app" })
    );
    let injects = 0;
    const coach = createBmlCoach({
      statePath,
      inject: async () => {
        injects += 1;
        return { ok: true, method: "sdk-auto", detail: "ran" };
      },
    });
    coach.setSelectedProject(proj);
    const view = await coach.runSkillStep(0, { trackCost: true });
    assert.equal(injects, 1);
    assert.equal(view.awaitingConfirm, false);
    assert.equal(view.buildStepIndex, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("agent-idle helpers", () => {
  it("exports wantAutoContinue defaulting to on", () => {
    const { wantAutoContinue } = require("../src/lib/bml/agent-idle");
    assert.equal(wantAutoContinue({}), true);
    assert.equal(wantAutoContinue({ CUM_BML_AUTO_CONTINUE: "0" }), false);
  });

  it("builds Cursor project slug", () => {
    const { cursorProjectSlug } = require("../src/lib/bml/agent-idle");
    assert.equal(
      cursorProjectSlug("/Users/lordjudsonmiller/Cursor Usage Meter"),
      "Users-lordjudsonmiller-Cursor-Usage-Meter"
    );
  });
});
