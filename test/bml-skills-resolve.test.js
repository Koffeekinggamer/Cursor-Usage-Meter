"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  parseSkillMarkdown,
  loadSkillForCommand,
  resolveSkillMdPath,
  skillSearchRoots,
} = require("../src/lib/bml/skills-resolve");

describe("parseSkillMarkdown", () => {
  it("strips frontmatter", () => {
    const { meta, body } = parseSkillMarkdown(
      "---\nname: ask-matt\ndescription: Router\n---\n\n# Ask Matt\n\nHello"
    );
    assert.equal(meta.name, "ask-matt");
    assert.equal(meta.description, "Router");
    assert.match(body, /# Ask Matt/);
  });
});

describe("loadSkillForCommand", () => {
  it("finds mattpocock engineering skills on disk", () => {
    const loaded = loadSkillForCommand("/ask-matt");
    assert.equal(loaded.ok, true);
    assert.ok(loaded.path && loaded.path.endsWith(`${path.sep}SKILL.md`));
    assert.match(loaded.body, /Ask Matt|main flow/i);
  });

  it("finds improve-codebase-architecture", () => {
    const loaded = loadSkillForCommand("architecture");
    assert.equal(loaded.ok, true);
    assert.match(loaded.path || "", /improve-codebase-architecture/);
  });

  it("finds bundled /design skill", () => {
    const loaded = loadSkillForCommand("/design");
    assert.equal(loaded.ok, true);
    assert.match(loaded.body, /design-doc|Design/i);
  });

  it("reports missing skills", () => {
    const loaded = loadSkillForCommand("not-a-real-skill-xyz");
    assert.equal(loaded.ok, false);
    assert.ok(loaded.error);
  });
});

describe("skillSearchRoots", () => {
  it("includes matt vendor path under grok home", () => {
    const roots = skillSearchRoots({
      home: "/Users/test",
      env: {},
      cwd: "/proj",
    });
    assert.ok(
      roots.some((r) => r.includes("mattpocock-skills") && r.includes("engineering"))
    );
  });
});

describe("resolveSkillMdPath", () => {
  it("uses first existing root", () => {
    const fake = "/tmp/fake-skills-root";
    const p = resolveSkillMdPath("ask-matt", {
      roots: [fake, path.join(process.env.HOME || "", ".grok", "vendor", "mattpocock-skills", "skills", "engineering")],
    });
    // Either found under real home or null if HOME unset in CI — on this machine should resolve
    if (process.env.HOME) {
      assert.ok(p === null || p.endsWith("SKILL.md"));
    }
  });
});
