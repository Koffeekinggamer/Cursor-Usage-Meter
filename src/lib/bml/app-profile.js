"use strict";

/**
 * Detect which app/product a BML project is, so Auto can route the right
 * skill version and ticket shape (Cursor meter vs Grok meter vs generic).
 */

/**
 * @typedef {'cursor-usage-meter'|'grok-usage-meter'|'token-usage-meter'|'generic'} AppProfileId
 *
 * @typedef {{
 *   id: AppProfileId,
 *   label: string,
 *   host: 'cursor'|'grok'|'unknown',
 *   needles: string,
 *   preferSkills: string[],
 *   routerHint: string,
 * }} AppProfile
 */

/**
 * @param {{
 *   name?: string|null,
 *   description?: string|null,
 *   contextExcerpt?: string|null,
 *   readmeExcerpt?: string|null,
 *   cwd?: string|null,
 *   gitRemote?: string|null,
 * }} project
 * @returns {string}
 */
function projectBlob(project) {
  return [
    project?.name,
    project?.description,
    project?.contextExcerpt,
    project?.readmeExcerpt,
    project?.cwd,
    project?.gitRemote,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/**
 * @param {{
 *   name?: string|null,
 *   description?: string|null,
 *   contextExcerpt?: string|null,
 *   readmeExcerpt?: string|null,
 *   cwd?: string|null,
 *   gitRemote?: string|null,
 * }} project
 * @returns {AppProfile}
 */
function detectAppProfile(project) {
  const blob = projectBlob(project);
  const cwd = String(project?.cwd || "").toLowerCase();

  if (
    /cursor-usage-meter|cursor usage meter/.test(blob) ||
    /cursor usage meter/.test(cwd) ||
    (/cursor/.test(blob) &&
      /meter/.test(blob) &&
      /auto/.test(blob) &&
      /api/.test(blob) &&
      /reading/.test(blob))
  ) {
    return {
      id: "cursor-usage-meter",
      label: "Cursor Usage Meter",
      host: "cursor",
      needles: "Auto (blue) · API (dark)",
      preferSkills: [
        "/ask-matt",
        "/grill-with-docs",
        "/improve-codebase-architecture",
        "/implement",
        "/code-review",
      ],
      routerHint:
        "This is the Cursor-only meter (state.vscdb + usage-summary, Auto/API needles, Cursor Watcher, Cursor BML clipboard inject). Do not apply Grok/Terminal-Grok session or billing paths. Prefer Cursor domain language from CONTEXT.md.",
    };
  }

  if (
    /grok-4\.5-usage-meter|grok-usage-meter|grok usage meter/.test(blob) ||
    /grok usage meter/.test(cwd) ||
    (/grok/.test(blob) &&
      /meter/.test(blob) &&
      (/plan/.test(blob) || /context/.test(blob)) &&
      /reading/.test(blob))
  ) {
    return {
      id: "grok-usage-meter",
      label: "Grok 4.5 Usage Meter",
      host: "grok",
      needles: "Plan (blue) · Ctx/OD (dark)",
      preferSkills: [
        "/ask-matt",
        "/grill-with-docs",
        "/improve-codebase-architecture",
        "/implement",
        "/code-review",
      ],
      routerHint:
        "This is the Terminal Grok meter (~/.grok auth/billing/signals, Plan/Ctx needles, Grok Watcher, Grok CLI inject). Do not rewrite it as the Cursor meter. Prefer Grok domain language from that repo's CONTEXT.md. If work belongs on the Cursor app instead, say so and stop.",
    };
  }

  if (
    /token-usage-meter|token usage meter/.test(blob) ||
    /token usage meter/.test(cwd)
  ) {
    return {
      id: "token-usage-meter",
      label: "Token Usage Meter (legacy Cursor)",
      host: "cursor",
      needles: "Auto (blue) · API (dark)",
      preferSkills: ["/ask-matt", "/triage", "/implement", "/code-review"],
      routerHint:
        "Legacy Cursor meter. Prefer migrating useful fixes into Cursor-Usage-Meter rather than deepening this fork, unless the job is explicitly about Token Usage Meter.",
    };
  }

  return {
    id: "generic",
    label: project?.name || "active project",
    host: "unknown",
    needles: "n/a",
    preferSkills: [
      "/ask-matt",
      "/triage",
      "/grill-with-docs",
      "/to-spec",
      "/to-tickets",
      "/implement",
    ],
    routerHint:
      "Generic repo under Cursor. Infer the smallest BML path from CONTEXT.md, package scripts, and tree. Do not assume Meter/Grok APIs exist.",
  };
}

/**
 * Auto-facing block: model + app profile routing.
 * @param {AppProfile} profile
 * @param {{ command?: string }} [opts]
 * @returns {string}
 */
function formatAutoRouterBlock(profile, opts = {}) {
  const command = opts.command || "/ask-matt";
  return [
    "## Cursor Auto routing",
    "Run this step as **Cursor Auto** (model picker: Auto). Auto chooses the implementation depth;",
    "you still follow the installed SKILL.md body exactly for this command.",
    "",
    `Detected app profile: **${profile.label}** (\`${profile.id}\`, host=${profile.host})`,
    `Needle / usage language: ${profile.needles}`,
    profile.routerHint,
    "",
    "### Version selection rules",
    "- If the active project is Cursor Usage Meter → use Cursor auth/API/Watcher/BML clipboard paths only.",
    "- If the active project is Grok 4.5 Usage Meter → keep Grok paths; do not “Cursor-ify” that repo.",
    "- If the projects are siblings, never mix their inject/auth/watcher code.",
    "- Prefer the skill path that matches this profile; skip on-ramps that do not fit unless the job needs them.",
    `Suggested chain bias for this app: ${profile.preferSkills.join(" → ")}`,
    "",
    command === "/ask-matt"
      ? "As /ask-matt: name the single next skill (or tiny-build → /implement) for THIS app profile and why."
      : `As ${command}: keep work inside the detected app profile; refuse cross-app rewrites.`,
  ].join("\n");
}

module.exports = {
  detectAppProfile,
  formatAutoRouterBlock,
  projectBlob,
};
