"use strict";

/**
 * Active project facts for BML Build + Measure planning.
 * Prefers Cursor's active workspace cwd.
 */

const fs = require("fs");
const path = require("path");
const { resolveChatSession } = require("./active-session");

/**
 * @typedef {{
 *   cwd: string,
 *   name: string|null,
 *   description: string|null,
 *   packageManager: string|null,
 *   scripts: string[],
 *   topLevel: string[],
 *   contextMd: string|null,
 *   contextExcerpt: string|null,
 *   readmeExcerpt: string|null,
 *   adrPaths: string[],
 *   gitRemote: string|null,
 *   sessionId: string|null,
 *   sessionLive: boolean,
 *   sessionSource: string|null,
 *   boundToChat: boolean,
 *   buildNatures: string[],
 *   measureNatures: string[],
 *   technicalHints: string[],
 * }} ProjectContext
 */

/**
 * @param {string} p
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readTextSafe(p, io = {}) {
  const exists = io.existsSync || fs.existsSync;
  const read = io.readFileSync || fs.readFileSync;
  try {
    if (!exists(p)) return null;
    return String(read(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} p
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readJsonSafe(p, io = {}) {
  const raw = readTextSafe(p, io);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} text
 * @param {number} max
 */
function excerpt(text, max = 2500) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…[truncated]";
}

/**
 * Infer Build natures from project shape (what kind of smallest test to ship).
 * @param {{
 *   scripts: string[],
 *   topLevel: string[],
 *   hasContextMd: boolean,
 *   pkg: Record<string, unknown>|null,
 * }} info
 * @returns {string[]}
 */
function inferBuildNatures(info) {
  /** @type {string[]} */
  const natures = [];
  const scripts = new Set(info.scripts || []);
  const top = new Set((info.topLevel || []).map((s) => s.toLowerCase()));
  const deps = {
    ...(info.pkg?.dependencies || {}),
    ...(info.pkg?.devDependencies || {}),
  };

  natures.push(
    "Smallest vertical slice that proves the hypothesis in this repo (tracer bullet)."
  );

  if (scripts.has("test") || top.has("test") || top.has("tests") || top.has("__tests__")) {
    natures.push("Test-first slice via /implement → /tdd at existing seams.");
  }
  if (deps.electron || scripts.has("start") && String(info.pkg?.main || "").includes("main")) {
    natures.push("UI/overlay change with a visible acceptance criterion (screenshot or interaction).");
  }
  if (top.has("src") || top.has("lib") || top.has("app")) {
    natures.push("Code change under existing modules; prefer deepening over new packages.");
  }
  if (info.hasContextMd) {
    natures.push(
      "Respect domain language in CONTEXT.md; update glossary/ADRs via /grill-with-docs if terms shift."
    );
  }
  if (top.has("scripts") || top.has("ops") || top.has("sops")) {
    natures.push("Admin/ops automation: smallest script or SOP change that is runnable.");
  }
  if (top.has(".github")) {
    natures.push("If the bet needs tracking, ship issue template / label / project field only as needed.");
  }
  return natures;
}

/**
 * Infer Measure natures (what evidence to collect) from project shape.
 * @param {{
 *   scripts: string[],
 *   topLevel: string[],
 *   pkg: Record<string, unknown>|null,
 *   contextExcerpt: string|null,
 * }} info
 * @returns {string[]}
 */
function inferMeasureNatures(info) {
  /** @type {string[]} */
  const natures = [];
  const scripts = new Set(info.scripts || []);

  natures.push(
    "Pre-register numeric pass AND kill thresholds + duration before Build leaves the column."
  );
  natures.push(
    "Post weekly numbers on the experiment issue — Measure is data collection, not a dev queue."
  );

  if (scripts.has("test")) {
    natures.push("CI/test green rate or failing suite count can back instrumentation (not vanity alone).");
  }
  if (scripts.has("start") || scripts.has("dev")) {
    natures.push("User-visible success: completion rate, time-to-done, or error rate for the admin job.");
  }

  const ctx = String(info.contextExcerpt || "").toLowerCase();
  if (ctx.includes("plan usage") || ctx.includes("context usage") || ctx.includes("meter")) {
    natures.push(
      "Product meter metrics: plan % / context % / fault rate only if they map to the hypothesis."
    );
  }
  if (ctx.includes("watcher") || ctx.includes("session")) {
    natures.push("Session lifecycle signals (start/stop, single-instance) if the bet is reliability.");
  }

  natures.push(
    "Prefer outcome metrics over vanity (logins/pageviews). Kill is success when criteria hit."
  );
  return natures;
}

/**
 * @param {string} cwd
 * @param {{
 *   readdirSync?: typeof fs.readdirSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 * }} [io]
 * @returns {string[]}
 */
function listTopLevel(cwd, io = {}) {
  const readdir = io.readdirSync || fs.readdirSync;
  try {
    return readdir(cwd, { withFileTypes: true })
      .filter(
        (e) =>
          !e.name.startsWith(".") ||
          e.name === ".github" ||
          e.name === ".cursor" ||
          e.name === ".agents"
      )
      .map((e) => e.name)
      .sort()
      .slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * @param {string} cwd
 * @param {{ existsSync?: typeof fs.existsSync, readdirSync?: typeof fs.readdirSync }} [io]
 */
function findAdrPaths(cwd, io = {}) {
  const exists = io.existsSync || fs.existsSync;
  const readdir = io.readdirSync || fs.readdirSync;
  /** @type {string[]} */
  const found = [];
  const candidates = [
    path.join(cwd, "docs", "adr"),
    path.join(cwd, "docs", "adrs"),
    path.join(cwd, "adr"),
    path.join(cwd, "ADRs"),
  ];
  for (const dir of candidates) {
    if (!exists(dir)) continue;
    try {
      for (const name of readdir(dir)) {
        if (/\.md$/i.test(name)) found.push(path.join(dir, name));
      }
    } catch {
      // ignore
    }
  }
  return found.slice(0, 12);
}

/**
 * @param {string} cwd
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 */
function readGitRemote(cwd, io = {}) {
  const cfg = readTextSafe(path.join(cwd, ".git", "config"), io);
  if (!cfg) return null;
  const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
  return m ? m[1].trim() : null;
}

/**
 * Load project context for a cwd.
 * @param {string} cwd
 * @param {{
 *   sessionId?: string|null,
 *   readdirSync?: typeof fs.readdirSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 * }} [opts]
 * @returns {ProjectContext}
 */
function loadProjectAt(cwd, opts = {}) {
  const io = {
    readdirSync: opts.readdirSync,
    readFileSync: opts.readFileSync,
    existsSync: opts.existsSync,
  };
  const root = path.resolve(cwd);
  const pkg = readJsonSafe(path.join(root, "package.json"), io);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object"
    ? Object.keys(/** @type {object} */ (pkg.scripts))
    : [];
  const topLevel = listTopLevel(root, io);
  const contextPath = path.join(root, "CONTEXT.md");
  const contextMd = readTextSafe(contextPath, io);
  const readme =
    readTextSafe(path.join(root, "README.md"), io) ||
    readTextSafe(path.join(root, "readme.md"), io);
  const contextExcerpt = excerpt(contextMd, 3000);
  const hasContextMd = Boolean(contextMd);

  const buildNatures = inferBuildNatures({
    scripts,
    topLevel,
    hasContextMd,
    pkg,
  });
  const measureNatures = inferMeasureNatures({
    scripts,
    topLevel,
    pkg,
    contextExcerpt,
  });

  /** @type {string[]} */
  const technicalHints = [];
  if (hasContextMd) technicalHints.push("@CONTEXT.md");
  if (topLevel.includes("src")) technicalHints.push("@src");
  if (topLevel.includes("scripts")) technicalHints.push("@scripts");
  if (topLevel.includes("test") || topLevel.includes("tests")) {
    technicalHints.push(topLevel.includes("test") ? "@test" : "@tests");
  }
  if (topLevel.includes("docs")) technicalHints.push("@docs");

  let packageManager = null;
  const exists = io.existsSync || fs.existsSync;
  if (exists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (exists(path.join(root, "yarn.lock"))) packageManager = "yarn";
  else if (exists(path.join(root, "package-lock.json"))) packageManager = "npm";

  return {
    cwd: root,
    name: typeof pkg?.name === "string" ? pkg.name : path.basename(root),
    description: typeof pkg?.description === "string" ? pkg.description : null,
    packageManager,
    scripts,
    topLevel,
    contextMd: contextPath,
    contextExcerpt,
    readmeExcerpt: excerpt(readme, 1200),
    adrPaths: findAdrPaths(root, io),
    gitRemote: readGitRemote(root, io),
    sessionId: opts.sessionId || null,
    sessionLive: Boolean(opts.sessionLive),
    sessionSource: opts.sessionSource || null,
    boundToChat: Boolean(opts.boundToChat),
    buildNatures,
    measureNatures,
    technicalHints,
  };
}

/**
 * Resolve project for BML from the active Cursor workspace.
 * Does not use the Meter process cwd unless no chat session exists.
 *
 * @param {{
 *   preferCwd?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   resolveSession?: typeof resolveChatSession,
 *   loadAt?: typeof loadProjectAt,
 * }} [opts]
 * @returns {ProjectContext}
 */
function loadActiveProjectContext(opts = {}) {
  const env = opts.env ?? process.env;
  const resolve = opts.resolveSession || resolveChatSession;
  const loadAt = opts.loadAt || loadProjectAt;

  const prefer =
    opts.preferCwd ||
    env.CUM_BML_CWD ||
    env.GUM_BML_CWD ||
    env.CUM_PROJECT_CWD ||
    null;

  const session = resolve({ env, preferCwd: prefer });

  if (session?.cwd) {
    return loadAt(session.cwd, {
      sessionId: session.session_id || null,
      sessionLive: Boolean(session.live),
      sessionSource: session.source || "active_sessions",
      boundToChat: true,
    });
  }

  // Explicit env override without a live chat row
  if (prefer) {
    return loadAt(prefer, {
      sessionId: null,
      sessionLive: false,
      sessionSource: "env",
      boundToChat: false,
    });
  }

  // Last resort only — Meter process directory (not a chat project)
  return loadAt(process.cwd(), {
    sessionId: null,
    sessionLive: false,
    sessionSource: "meter_cwd",
    boundToChat: false,
  });
}

/**
 * Markdown block for inject prompts — Build/Measure natures from the active project.
 * @param {ProjectContext} project
 * @returns {string}
 */
function formatProjectContextForPrompt(project) {
  if (!project?.cwd) return "";
  const lines = [
    "## Active chat project (source of Build + Measure nature)",
    project.boundToChat
      ? "Bound to Cursor's active workspace — use THIS repo for the experiment."
      : "WARNING: No active Cursor workspace found; falling back. Prefer opening Cursor in the target project.",
    `Path: ${project.cwd}`,
    project.name ? `Name: ${project.name}` : null,
    project.description ? `Description: ${project.description}` : null,
    project.gitRemote ? `Git remote: ${project.gitRemote}` : null,
    project.sessionId
      ? `Cursor workspace: ${project.sessionId}${project.sessionLive ? " (live)" : ""}${project.sessionSource ? ` via ${project.sessionSource}` : ""}`
      : null,
    project.packageManager ? `Package manager: ${project.packageManager}` : null,
    project.scripts?.length
      ? `Scripts: ${project.scripts.slice(0, 20).join(", ")}`
      : null,
    project.topLevel?.length
      ? `Top-level: ${project.topLevel.slice(0, 24).join(", ")}`
      : null,
    project.technicalHints?.length
      ? `Technical Context hints: ${project.technicalHints.join(" ")}`
      : null,
    "",
    "### Build nature (plan the smallest test from THIS repo)",
    ...(project.buildNatures || []).map((n) => `- ${n}`),
    "",
    "### Measure nature (plan evidence from THIS repo's reality)",
    ...(project.measureNatures || []).map((n) => `- ${n}`),
  ].filter((l) => l != null);

  if (project.contextExcerpt) {
    lines.push(
      "",
      "### CONTEXT.md (domain language — use these terms)",
      project.contextExcerpt
    );
  } else {
    lines.push(
      "",
      "### CONTEXT.md",
      "(missing — /grill-with-docs should establish domain language)"
    );
  }

  if (project.readmeExcerpt) {
    lines.push("", "### README excerpt", project.readmeExcerpt);
  }

  if (project.adrPaths?.length) {
    lines.push(
      "",
      "### ADRs present",
      ...project.adrPaths.map((p) => `- ${p}`)
    );
  }

  lines.push(
    "",
    "### Rules",
    "- Build and Measure sections of the experiment ticket MUST reflect this project, not generic advice.",
    "- Prefer existing scripts, modules, and seams listed above.",
    "- Technical Context / References must @ real folders/files from this tree for /grill-with-docs."
  );

  return lines.join("\n");
}

/**
 * Suggest Technical Context string from project.
 * @param {ProjectContext} project
 */
function suggestTechnicalContext(project) {
  const hints = project?.technicalHints?.length
    ? project.technicalHints
    : ["@."];
  return `${hints.join(" ")} (${project?.cwd || "project root"})`;
}

/**
 * Detect Cursor Usage Meter domain from CONTEXT / package.
 * @param {ProjectContext} project
 */
function isCursorUsageMeterProject(project) {
  const blob = [
    project?.name,
    project?.description,
    project?.contextExcerpt,
    project?.readmeExcerpt,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    /cursor-usage-meter|cursor usage meter/.test(blob) ||
    (/auto.*usage/.test(blob) &&
      /api.*usage/.test(blob) &&
      /meter/.test(blob) &&
      /reading/.test(blob))
  );
}

/**
 * Synthesize a full six-section BML ticket from active project facts.
 * Uses domain language from CONTEXT.md and real modules/scripts — not placeholders.
 * @param {ProjectContext} project
 * @returns {import('./template').TicketFields}
 */
function synthesizeTicketFromProject(project) {
  if (isCursorUsageMeterProject(project)) {
    return synthesizeMeterTicket(project);
  }
  return synthesizeGenericTicket(project);
}

/**
 * Product experiment for the Meter as built today.
 * @param {ProjectContext} project
 */
function synthesizeMeterTicket(project) {
  const tech = [
    "@CONTEXT.md",
    "@src/lib/reading.js",
    "@src/lib/meter-state.js",
    "@src/lib/face.js",
    "@src/lib/face-copy.js",
    "@src/renderer/paint.js",
    "@src/renderer/renderer.js",
    "@src/lib/bml/",
    "@src/lib/watcher.js",
    "@scripts/watch-cursor.js",
    "@test/",
    project.cwd ? `(root: ${project.cwd})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    hypothesis:
      "Operators running Cursor keep the Meter visible and act on dual-needle Readings (Auto % blue + API % dark) during real sessions — adjusting work before usage is exhausted, not ignoring the overlay.",
    build:
      "Ship the smallest path that proves the Meter is usable mid-session with no blank dial:\n" +
      "1) Reading path: Cursor state.vscdb → usage API → Face → dual needles (src/lib/reading.js, meter-state.js, face.js, renderer paint).\n" +
      "2) Keep last-good Reading + fault marker when a poll fails (no snap-to-zero).\n" +
      "3) Single-instance overlay + Watcher start/stop with Cursor (pidfile + scripts/watch-cursor.js).\n" +
      "4) BML coach optional for admin bets; do not block the dial.\n" +
      "Acceptance is visual + automated: CUM_SELFTEST / scripts/verify-meter-ui.js + npm test — no new product scope beyond reliability of the Reading→Face pipeline.",
    measure:
      "Over 2 weeks of real Cursor use on this machine:\n" +
      "· Pass: ≥80% of Cursor sessions with Watcher/Meter running show a non-idle dual-needle Face within 5s of session open (numeric labels, not em-dash), and fault rate <10% of polls without last-good fallback.\n" +
      "· Kill: <50% sessions get a usable Face within 5s, OR blank/cream plate with no needles on >20% cold starts, OR operators disable/quit the Meter within 3 sessions.\n" +
      "· Sample: recent Cursor workspace opens + weekly note on the experiment issue (counts: sessions, cold starts, faults, last-good holds).\n" +
      "· Instrumentation: existing takeReading + buildFaceView; optional log line in main refreshUsage; npm test stays green (90+).",
    learn:
      "What did we learn? Persevere (double down on overlay reliability / BML), Pivot (different surface or metrics), or Kill (overlay not worth Watcher complexity). Evidence on the issue + decision label.",
    acceptanceCriteria: [
      "- [ ] npm test green (full suite)",
      "- [ ] Cold start shows dual needles + numeric Auto/API labels within 5s when signed in",
      "- [ ] Last-good Reading held with fault marker when billing/signals fail; no snap-to-zero",
      "- [ ] Single instance only; second launch focuses existing Meter",
      "- [ ] Watcher starts Meter when Cursor opens and quits it when Cursor exits",
      "- [ ] CUM_SELFTEST=1 or scripts/verify-meter-ui.js captures painted dial + labels",
      "- [ ] CONTEXT.md domain terms (Meter, Reading, Cursor models usage, Other models usage, Fault) unchanged or updated via grill",
    ].join("\n"),
    technicalContext: tech,
  };
}

/**
 * Generic admin ticket from project tree + CONTEXT.
 * @param {ProjectContext} project
 */
function synthesizeGenericTicket(project) {
  const name = project.name || path.basename(project.cwd || "project");
  const desc = project.description || "the system under the active Cursor workspace";
  const buildLines = (project.buildNatures || []).slice(0, 5);
  const measureLines = (project.measureNatures || []).slice(0, 5);

  return {
    hypothesis: `For ${name} (${desc}): the riskiest assumption is that the smallest shippable change in this repo will move a pre-registered outcome metric for the admin job — if wrong, we will burn build time without validated learning.`,
    build: [
      `Smallest Build in ${name} at ${project.cwd}:`,
      ...buildLines.map((n) => `- ${n}`),
      project.scripts?.includes("test")
        ? "- Prove with existing test script before expanding scope."
        : "- Add only the minimum check that Measure can observe.",
    ].join("\n"),
    measure: [
      ...measureLines.map((n) => `- ${n}`),
      "- Pass: ≥70% success on the primary outcome · kill <40% · duration 2 weeks · sample = weekly posts on the issue.",
    ].join("\n"),
    learn:
      "What did we learn? Persevere / Pivot / Kill with evidence + decision label (persevere | pivot | kill-candidate).",
    acceptanceCriteria: [
      "- [ ] Hypothesis + numeric kill written before leaving Backlog",
      "- [ ] Smallest Build shipped in this repo (PR or script path named)",
      "- [ ] Measure path exists (test command, log, or manual weekly count)",
      project.scripts?.includes("test") ? "- [ ] npm/pnpm/yarn test (or project test script) green" : null,
      "- [ ] Technical Context @folders point at real paths for /grill-with-docs",
    ]
      .filter(Boolean)
      .join("\n"),
    technicalContext: suggestTechnicalContext(project),
  };
}

module.exports = {
  loadProjectAt,
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  suggestTechnicalContext,
  synthesizeTicketFromProject,
  isCursorUsageMeterProject,
  inferBuildNatures,
  inferMeasureNatures,
  excerpt,
};
