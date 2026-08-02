"use strict";

/**
 * Run BML /ask-matt on Cursor Auto for the active (or preferred) app workspace.
 * Auto receives the app profile so it can choose Cursor vs Grok vs generic skill path.
 *
 *   CUM_BML_CWD=/path/to/app node scripts/bml-run-auto.js
 */

const path = require("path");
const {
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  synthesizeTicketFromProject,
} = require("../src/lib/bml/project-context");
const { buildSkillPrompt, stepAt } = require("../src/lib/bml/skill-chain");
const { injectIntoCursor } = require("../src/lib/bml/inject");
const { detectAppProfile } = require("../src/lib/bml/app-profile");

async function main() {
  const prefer =
    process.env.CUM_BML_CWD ||
    process.env.CUM_PROJECT_CWD ||
    path.join(__dirname, "..");

  const project = loadActiveProjectContext({ preferCwd: prefer });
  const profile = project.appProfile || detectAppProfile(project);
  const ticket = synthesizeTicketFromProject(project);
  const projectBlock = formatProjectContextForPrompt(project);
  const ask = stepAt(0); // /ask-matt

  const built = buildSkillPrompt(ask, {
    jobBrief: `Route BML for ${profile.label}. Choose the next skill/version for this app only.`,
    issueTitle: `BML Auto route: ${profile.label}`,
    bodyExcerpt: [
      ticket.hypothesis,
      "",
      "Build:",
      ticket.build,
      "",
      "Measure:",
      ticket.measure,
    ].join("\n"),
    stage: "Build",
    cwd: project.cwd,
    projectBlock,
    appProfile: profile,
    extra: [
      "Start with /ask-matt routing only.",
      "Name the single next skill for THIS app profile and why.",
      "If the workspace is Cursor Usage Meter, do not emit Grok-only work.",
      "If the workspace is Grok Usage Meter, do not Cursor-ify that repo.",
    ].join("\n"),
  });

  console.log(`app=${profile.id} host=${profile.host} cwd=${project.cwd}`);
  console.log(`skillOk=${built.skillOk} path=${built.skillPath || "(missing)"}`);

  const result = await injectIntoCursor(built.prompt, {
    preferCwd: project.cwd,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
