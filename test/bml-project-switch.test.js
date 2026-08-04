"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createBmlCoach } = require("../src/lib/bml/coach");

describe("BML project switch", () => {
  let prevAuto;
  let prevCwd;
  beforeEach(() => {
    prevAuto = process.env.CUM_BML_AUTO_CONTINUE;
    prevCwd = process.env.CUM_BML_CWD;
    process.env.CUM_BML_AUTO_CONTINUE = "0";
    delete process.env.CUM_BML_CWD;
  });
  afterEach(() => {
    if (prevAuto === undefined) delete process.env.CUM_BML_AUTO_CONTINUE;
    else process.env.CUM_BML_AUTO_CONTINUE = prevAuto;
    if (prevCwd === undefined) delete process.env.CUM_BML_CWD;
    else process.env.CUM_BML_CWD = prevCwd;
  });

  it("opens the panel idle without starting the skill chain", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-switch-"));
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
    const opened = await coach.setPanelOpen(true);
    assert.equal(opened.panelOpen, true);
    assert.equal(injects, 0);
    assert.equal(opened.awaitingConfirm, false);
    assert.equal(opened.lastError, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requires a dropdown selection before autoProcess", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-switch-"));
    const statePath = path.join(dir, "bml-state.json");
    const coach = createBmlCoach({
      statePath,
      inject: async () => ({
        ok: true,
        method: "clipboard",
        needsConfirm: true,
        detail: "copied",
      }),
    });
    const opened = await coach.setPanelOpen(true, { autoProcess: true });
    assert.equal(opened.panelOpen, true);
    assert.equal(opened.boundCwd, null);
    assert.match(opened.lastError || "", /Select a project/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rebinds via setSelectedProject; autoProcess starts the chain", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cum-bml-switch-"));
    const statePath = path.join(dir, "bml-state.json");
    const projA = path.join(dir, "proj-a");
    const projB = path.join(dir, "proj-b");
    fs.mkdirSync(projA);
    fs.mkdirSync(projB);
    fs.writeFileSync(
      path.join(projA, "package.json"),
      JSON.stringify({ name: "cursor-usage-meter", description: "Cursor Auto API meter" })
    );
    fs.writeFileSync(
      path.join(projB, "package.json"),
      JSON.stringify({ name: "grok-usage-meter", description: "Grok plan context meter" })
    );
    fs.writeFileSync(
      path.join(projA, "CONTEXT.md"),
      "# Cursor Usage Meter\nAuto API Reading Meter\n"
    );
    fs.writeFileSync(
      path.join(projB, "CONTEXT.md"),
      "# Grok Usage Meter\nPlan Context Reading Meter\n"
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

    const picked = coach.setSelectedProject(projA);
    assert.equal(picked.selectedProjectCwd, path.resolve(projA));
    assert.equal(picked.boundCwd, path.resolve(projA));
    assert.ok(
      (picked.projectChoices || []).some((c) => c.cwd === path.resolve(projA))
    );

    const idle = await coach.setPanelOpen(true);
    assert.equal(idle.panelOpen, true);
    assert.equal(injects, 0, "panel open alone does not inject");

    const started = await coach.runAllSkillSteps();
    assert.equal(started.boundCwd, path.resolve(projA));
    assert.equal(injects, 1);
    assert.equal(started.awaitingConfirm, true);
    assert.match(started.project?.appProfile?.id || "", /cursor/);

    coach.setSelectedProject(projB);
    const again = await coach.runAllSkillSteps();
    assert.equal(again.boundCwd, path.resolve(projB));
    assert.ok(injects >= 2, "new project starts its own copy");
    assert.match(again.project?.appProfile?.id || "", /grok/);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
