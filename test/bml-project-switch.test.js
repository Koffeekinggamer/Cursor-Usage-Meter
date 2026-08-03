"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createBmlCoach } = require("../src/lib/bml/coach");

describe("BML project switch", () => {
  it("rebinds and auto-processes when the panel opens", async () => {
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

    let cwd = projA;
    let injects = 0;
    const coach = createBmlCoach({
      statePath,
      inject: async () => {
        injects += 1;
        return {
          ok: true,
          method: "clipboard",
          needsConfirm: true,
          detail: `copied for ${cwd}`,
        };
      },
    });
    // Monkeypatch active project via env
    process.env.CUM_BML_CWD = projA;
    const opened = await coach.setPanelOpen(true, { autoProcess: true });
    assert.equal(opened.panelOpen, true);
    assert.equal(opened.boundCwd, path.resolve(projA));
    assert.equal(injects, 1);
    assert.equal(opened.awaitingConfirm, true);
    assert.match(opened.project?.appProfile?.id || "", /cursor/);

    cwd = projB;
    process.env.CUM_BML_CWD = projB;
    const synced = coach.syncActiveProject();
    assert.equal(synced.changed, true);
    assert.equal(path.resolve(synced.project.cwd), path.resolve(projB));

    const reopened = await coach.setPanelOpen(true, { autoProcess: true });
    assert.equal(reopened.boundCwd, path.resolve(projB));
    assert.ok(injects >= 2, "new project starts its own copy");
    assert.match(reopened.project?.appProfile?.id || "", /grok/);

    delete process.env.CUM_BML_CWD;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
