"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Map slash command / step id → skill folder name under mattpocock or bundled skills.
 */
const SKILL_FOLDERS = Object.freeze({
  "ask-matt": "ask-matt",
  architecture: "improve-codebase-architecture",
  "improve-codebase-architecture": "improve-codebase-architecture",
  design: "design-an-interface",
  "design-an-interface": "design-an-interface",
  grill: "grill-with-docs",
  "grill-with-docs": "grill-with-docs",
  "to-spec": "to-spec",
  "to-tickets": "to-tickets",
  implement: "implement",
  tdd: "tdd",
  "code-review": "code-review",
  triage: "triage",
  "diagnosing-bugs": "diagnosing-bugs",
  wayfinder: "wayfinder",
  research: "research",
  prototype: "prototype",
  "domain-modeling": "domain-modeling",
  "codebase-design": "codebase-design",
  grilling: "grilling",
});

/**
 * Search roots for installed Matt / Cursor skills (in priority order).
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 * @returns {string[]}
 */
function skillSearchRoots(opts = {}) {
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  const grokHome = path.join(home, ".grok");
  const cwd = opts.cwd || process.cwd();
  /** @type {string[]} */
  const roots = [];
  if (env.CUM_SKILLS_ROOT || env.GUM_SKILLS_ROOT) {
    roots.push(env.CUM_SKILLS_ROOT || env.GUM_SKILLS_ROOT);
  }
  // Project-local skills
  roots.push(path.join(cwd, ".cursor", "skills"));
  roots.push(path.join(cwd, ".agents", "skills"));
  roots.push(path.join(cwd, "skills"));
  // Meter install roots, then compatibility fallbacks for Matt's pack.
  roots.push(path.join(__dirname, "..", "..", "..", ".cursor", "skills"));
  roots.push(path.join(__dirname, "..", "..", "..", ".agents", "skills"));
  roots.push(path.join(grokHome, "vendor", "mattpocock-skills", "skills", "engineering"));
  roots.push(path.join(grokHome, "vendor", "mattpocock-skills", "skills", "productivity"));
  roots.push(path.join(grokHome, "skills"));
  roots.push(path.join(grokHome, "bundled", "skills"));
  return roots;
}

/**
 * Resolve a skill folder name to an absolute SKILL.md path, or null.
 * @param {string} folderName
 * @param {{ roots?: string[], existsSync?: typeof fs.existsSync }} [opts]
 * @returns {string|null}
 */
function resolveSkillMdPath(folderName, opts = {}) {
  const name = String(folderName || "").trim();
  if (!name) return null;
  const roots = opts.roots || skillSearchRoots();
  const exists = opts.existsSync || fs.existsSync;
  for (const root of roots) {
    const candidate = path.join(root, name, "SKILL.md");
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Strip YAML frontmatter from a SKILL.md body.
 * @param {string} raw
 * @returns {{ meta: Record<string, string>, body: string }}
 */
function parseSkillMarkdown(raw) {
  const text = String(raw || "");
  if (!text.startsWith("---")) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: text.trim() };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body };
}

/**
 * Load installed skill definition for a step command or id.
 * @param {string} commandOrId e.g. "/ask-matt" or "grill"
 * @param {{
 *   roots?: string[],
 *   readFileSync?: typeof fs.readFileSync,
 *   existsSync?: typeof fs.existsSync,
 *   maxChars?: number,
 * }} [opts]
 * @returns {{
 *   ok: boolean,
 *   folder: string|null,
 *   path: string|null,
 *   name: string|null,
 *   description: string|null,
 *   body: string,
 *   error?: string,
 * }}
 */
function loadSkillForCommand(commandOrId, opts = {}) {
  const key = String(commandOrId || "")
    .trim()
    .replace(/^\//, "")
    .toLowerCase();
  const folder = SKILL_FOLDERS[key] || key;
  const mdPath = resolveSkillMdPath(folder, opts);
  if (!mdPath) {
    return {
      ok: false,
      folder,
      path: null,
      name: folder,
      description: null,
      body: "",
      error: `Skill not found on disk for "${commandOrId}" (looked for ${folder}/SKILL.md under Matt/Cursor skill roots).`,
    };
  }
  try {
    const read = opts.readFileSync || fs.readFileSync;
    const raw = String(read(mdPath, "utf8"));
    const { meta, body } = parseSkillMarkdown(raw);
    const max = opts.maxChars ?? 14_000;
    return {
      ok: true,
      folder,
      path: mdPath,
      name: meta.name || folder,
      description: meta.description || null,
      body: body.length > max ? body.slice(0, max) + "\n\n…[skill truncated for inject size]" : body,
    };
  } catch (err) {
    return {
      ok: false,
      folder,
      path: mdPath,
      name: folder,
      description: null,
      body: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

module.exports = {
  SKILL_FOLDERS,
  skillSearchRoots,
  resolveSkillMdPath,
  parseSkillMarkdown,
  loadSkillForCommand,
};
