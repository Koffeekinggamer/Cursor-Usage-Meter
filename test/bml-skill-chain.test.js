"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  SKILL_CHAIN,
  SKILL_ALTERNATES,
  stepAt,
  nextStepIndex,
  tinyImplementIndex,
  canSkipStep,
  buildSkillPrompt,
  isMeasureAllowedCommand,
  resolveChainForView,
  resolveAlternatesForView,
  findSkillById,
  estimateChainCost,
  formatDuration,
  formatTokens,
} = require("../src/lib/bml/skill-chain");

describe("skill chain", () => {
  it("Start chain is the training main flow order", () => {
    assert.deepEqual(
      SKILL_CHAIN.map((s) => s.command),
      [
        "/grill-with-docs",
        "/to-spec",
        "/to-tickets",
        "/implement",
        "/code-review",
      ]
    );
  });

  it("alternates hold router and on-ramps (not in Start)", () => {
    const cmds = SKILL_ALTERNATES.map((s) => s.command);
    assert.ok(cmds.includes("/ask-matt"));
    assert.ok(cmds.includes("/triage"));
    assert.ok(cmds.includes("/diagnosing-bugs"));
    assert.ok(cmds.includes("/research"));
    assert.ok(cmds.includes("/wayfinder"));
    assert.ok(cmds.includes("/improve-codebase-architecture"));
    assert.ok(cmds.includes("/prototype"));
    assert.ok(cmds.includes("/design"));
    for (const c of cmds) {
      assert.equal(
        SKILL_CHAIN.some((s) => s.command === c),
        false,
        `${c} must not be in Start chain`
      );
    }
  });

  it("main flow steps are not skippable", () => {
    for (let i = 0; i < SKILL_CHAIN.length; i++) {
      assert.equal(canSkipStep(i), false, SKILL_CHAIN[i].command);
    }
  });

  it("findSkillById resolves main and alternate skills", () => {
    assert.equal(findSkillById("grill")?.command, "/grill-with-docs");
    assert.equal(findSkillById("/ask-matt")?.id, "ask-matt");
    assert.equal(findSkillById("nope"), null);
  });

  it("tiny build jumps to implement", () => {
    assert.equal(stepAt(tinyImplementIndex()).command, "/implement");
    assert.equal(nextStepIndex(0, { tinyBuild: true }), tinyImplementIndex());
  });

  it("embeds installed Matt SKILL.md body into inject prompts", () => {
    const grill = stepAt(SKILL_CHAIN.findIndex((s) => s.id === "grill"));
    const built = buildSkillPrompt(grill, {
      issueUrl: "https://github.com/Book-IQ/bookiqv1-rc/issues/1083",
      issueTitle: "Admin job",
      jobBrief: "Ops can finish weekly close without manual spreadsheets",
      bodyExcerpt: "## Hypothesis\nClose is automated",
      projectBlock:
        "## Active project\nPath: /repo\n### Build nature\n- tracer bullet\n### Measure nature\n- pass/kill",
    });
    assert.match(built.prompt, /^\/grill-with-docs/);
    assert.match(built.prompt, /SKILL\.md body|Installed skill/i);
    assert.match(built.prompt, /Admin job|Build-Measure-Learn/);
    assert.match(built.prompt, /1083/);
    assert.match(built.prompt, /Active project|Build nature|Measure nature/);
    assert.equal(built.skillOk, true);
    assert.ok(built.skillPath && built.skillPath.includes("SKILL.md"));
    assert.ok(
      built.skillPath.includes("grill-with-docs") ||
        built.skillPath.includes("mattpocock")
    );
  });

  it("loads ask-matt from Matt pack", () => {
    const built = buildSkillPrompt("/ask-matt", {});
    assert.equal(built.skillOk, true);
    assert.match(built.prompt, /Ask Matt|main flow|grill-with-docs/i);
  });

  it("restricts Measure to implement/research/review", () => {
    assert.equal(isMeasureAllowedCommand("/implement"), true);
    assert.equal(isMeasureAllowedCommand("/research"), true);
    assert.equal(isMeasureAllowedCommand("/code-review"), true);
    assert.equal(isMeasureAllowedCommand("/design"), false);
  });

  it("resolveChainForView marks skill presence", () => {
    const chain = resolveChainForView();
    const grill = chain.find((s) => s.id === "grill");
    assert.ok(grill);
    assert.equal(grill.skillOk, true);
    assert.ok(grill.skillPath && path.isAbsolute(grill.skillPath));
  });

  it("resolveAlternatesForView lists manual skills", () => {
    const alts = resolveAlternatesForView();
    assert.equal(alts.length, SKILL_ALTERNATES.length);
    const ask = alts.find((s) => s.id === "ask-matt");
    assert.ok(ask);
    assert.equal(ask.skillOk, true);
  });

  it("estimates chain time and tokens", () => {
    const est = estimateChainCost();
    assert.equal(est.steps, SKILL_CHAIN.length);
    assert.ok(est.secondsMin > 0 && est.secondsMax > est.secondsMin);
    assert.ok(est.tokensMin > 0 && est.tokensMax > est.tokensMin);
    assert.match(est.label, /m|s/);
    assert.match(est.label, /k|M|\d/);
    assert.equal(formatDuration(90), "1m 30s");
    assert.match(formatTokens(18000), /18k|k/);
  });
});
