"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  detectAppProfile,
  formatAutoRouterBlock,
} = require("../src/lib/bml/app-profile");
const { buildSkillPrompt } = require("../src/lib/bml/skill-chain");
const { loadProjectAt } = require("../src/lib/bml/project-context");
const path = require("path");

describe("detectAppProfile", () => {
  it("detects Cursor Usage Meter", () => {
    const p = detectAppProfile({
      name: "cursor-usage-meter",
      description: "Always-on-top analog needle overlay for Cursor plan usage",
      contextExcerpt: "Cursor models usage Auto API Reading Meter",
      cwd: "/Users/me/Cursor Usage Meter",
    });
    assert.equal(p.id, "cursor-usage-meter");
    assert.equal(p.host, "cursor");
  });

  it("detects Grok Usage Meter", () => {
    const p = detectAppProfile({
      name: "grok-usage-meter",
      description: "Terminal Grok 4.5 plan + context usage",
      contextExcerpt: "Plan usage Context usage Reading Meter Grok",
      cwd: "/Users/me/Grok Usage Meter",
    });
    assert.equal(p.id, "grok-usage-meter");
    assert.equal(p.host, "grok");
  });

  it("falls back to generic", () => {
    const p = detectAppProfile({
      name: "shop-app",
      description: "retail",
      cwd: "/tmp/shop",
    });
    assert.equal(p.id, "generic");
  });
});

describe("Auto router in prompts", () => {
  it("embeds Auto + profile into ask-matt prompt", () => {
    const profile = detectAppProfile({
      name: "cursor-usage-meter",
      cwd: "/Users/me/Cursor Usage Meter",
      contextExcerpt: "Cursor Auto API Meter Reading",
    });
    const built = buildSkillPrompt("/ask-matt", {
      cwd: profile.routerHint,
      appProfile: profile,
      projectBlock: "Path: /Users/me/Cursor Usage Meter",
      loadSkill: () => ({
        ok: true,
        folder: "ask-matt",
        path: "/tmp/ask-matt/SKILL.md",
        name: "ask-matt",
        description: "router",
        body: "Route the job.",
      }),
    });
    assert.match(built.prompt, /Cursor Auto/);
    assert.match(built.prompt, /cursor-usage-meter/);
    assert.match(built.prompt, /Do not apply Grok/);
  });

  it("loadProjectAt attaches appProfile for this repo", () => {
    const project = loadProjectAt(path.join(__dirname, ".."));
    assert.equal(project.appProfile.id, "cursor-usage-meter");
    assert.match(formatAutoRouterBlock(project.appProfile), /Cursor Auto routing/);
  });
});
