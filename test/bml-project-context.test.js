"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadProjectAt,
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  suggestTechnicalContext,
  synthesizeTicketFromProject,
  isCursorUsageMeterProject,
  inferBuildNatures,
  inferMeasureNatures,
} = require("../src/lib/bml/project-context");
const { validateBacklogReady } = require("../src/lib/bml/template");

describe("inferBuildNatures / inferMeasureNatures", () => {
  it("mentions tdd when tests exist", () => {
    const b = inferBuildNatures({
      scripts: ["test", "start"],
      topLevel: ["src", "test"],
      hasContextMd: true,
      pkg: { name: "demo" },
    });
    assert.ok(b.some((n) => /tdd|test/i.test(n)));
    assert.ok(b.some((n) => /CONTEXT/i.test(n)));

    const m = inferMeasureNatures({
      scripts: ["test"],
      topLevel: ["src"],
      pkg: {},
      contextExcerpt: "Plan usage and context usage on the Meter.",
    });
    assert.ok(m.some((n) => /pass AND kill|kill/i.test(n)));
    assert.ok(m.some((n) => /plan %|meter/i.test(n)));
  });
});

describe("loadProjectAt", () => {
  it("reads package.json and CONTEXT.md from a fixture tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-proj-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "admin-tools",
          description: "Ops automation",
          scripts: { test: "node --test", start: "node ." },
        })
      );
      fs.writeFileSync(
        path.join(dir, "CONTEXT.md"),
        "# Domain\n\n**Meter**: always-on-top overlay\n"
      );
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "test"));

      const p = loadProjectAt(dir);
      assert.equal(p.name, "admin-tools");
      assert.equal(p.description, "Ops automation");
      assert.ok(p.scripts.includes("test"));
      assert.ok(p.contextExcerpt && p.contextExcerpt.includes("Meter"));
      assert.ok(p.buildNatures.length >= 2);
      assert.ok(p.measureNatures.length >= 2);
      assert.ok(p.technicalHints.includes("@CONTEXT.md"));
      assert.ok(p.technicalHints.includes("@src"));

      const block = formatProjectContextForPrompt(p);
      assert.match(block, /Active chat project/);
      assert.match(block, /Build nature/);
      assert.match(block, /Measure nature/);
      assert.match(block, /admin-tools/);
      assert.match(block, /CONTEXT\.md/);

      assert.match(suggestTechnicalContext(p), /@CONTEXT\.md|@src/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadActiveProjectContext", () => {
  it("binds to chat session cwd (not meter process cwd)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gum-sess-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "from-chat" })
      );
      const p = loadActiveProjectContext({
        resolveSession: () => ({
          session_id: "s1",
          cwd: dir,
          live: true,
          source: "active_sessions",
        }),
      });
      assert.equal(p.cwd, path.resolve(dir));
      assert.equal(p.name, "from-chat");
      assert.equal(p.sessionId, "s1");
      assert.equal(p.boundToChat, true);
      assert.equal(p.sessionLive, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("synthesizeTicketFromProject", () => {
  it("builds a backlog-ready Meter experiment from this repo", () => {
    const project = loadProjectAt(path.join(__dirname, ".."));
    assert.equal(isCursorUsageMeterProject(project), true);
    const ticket = synthesizeTicketFromProject(project);
    const ready = validateBacklogReady(ticket);
    assert.equal(ready.ok, true, ready.ok ? "" : ready.errors.join("; "));
    assert.match(ticket.hypothesis, /Meter|Reading|Auto|API/i);
    assert.match(ticket.build, /reading\.js|meter-state|Watcher/i);
    assert.match(ticket.measure, /kill/i);
    assert.match(ticket.measure, /\d+/);
    assert.match(ticket.acceptanceCriteria, /npm test|SELFTEST|last-good/i);
    assert.match(ticket.technicalContext, /@src\/lib\/reading\.js|@CONTEXT\.md/);
  });
});
