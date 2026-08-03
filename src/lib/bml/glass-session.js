"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { getStateDbPath } = require("../paths");

const GLASS_KEYS = [
  "cursor/glass.selectedAgent",
  "glass.localAgentProjectMembership.v1",
  "glass.localAgentProjects.v1",
  "glass.cloudAgentProjectMembership.v1",
  "glass.cloudAgentProjects.v1",
];

/**
 * Read ItemTable values from a temp copy of state.vscdb (avoids Cursor WAL locks).
 * @param {string} dbPath
 * @param {string[]} keys
 * @param {{ execFileSync?: typeof execFileSync, copyFileSync?: typeof fs.copyFileSync }} [io]
 * @returns {Record<string, string|null>}
 */
function readStateDbKeys(dbPath, keys, io = {}) {
  const exec = io.execFileSync || execFileSync;
  const copy = io.copyFileSync || fs.copyFileSync;
  const tmp = path.join(
    os.tmpdir(),
    `cum-glass-${process.pid}-${Date.now()}.vscdb`
  );
  /** @type {Record<string, string|null>} */
  const out = {};
  for (const key of keys) out[key] = null;
  try {
    copy(dbPath, tmp);
  } catch {
    return out;
  }
  try {
    for (const key of keys) {
      try {
        const sql = `SELECT value FROM ItemTable WHERE key='${String(key).replace(/'/g, "''")}';`;
        const raw = exec("sqlite3", [tmp, sql], {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          timeout: 4_000,
        });
        const text = String(raw || "").trim();
        out[key] = text || null;
      } catch {
        out[key] = null;
      }
    }
    // cloud agent repo catalog (auth-scoped key)
    try {
      const keyList = String(
        exec(
          "sqlite3",
          [
            tmp,
            "SELECT key FROM ItemTable WHERE key LIKE 'cloudAgentRepository.agents.%' LIMIT 3;",
          ],
          { encoding: "utf8", timeout: 4_000 }
        ) || ""
      )
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const repoKey of keyList) {
        const raw = String(
          exec(
            "sqlite3",
            [
              tmp,
              `SELECT value FROM ItemTable WHERE key='${repoKey.replace(/'/g, "''")}';`,
            ],
            {
              encoding: "utf8",
              maxBuffer: 20 * 1024 * 1024,
              timeout: 4_000,
            }
          ) || ""
        ).trim();
        if (raw) {
          out[repoKey] = raw;
          out["cloudAgentRepository.agents"] = raw;
          break;
        }
      }
    } catch {
      // optional
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
  return out;
}

/**
 * @param {string|null|undefined} raw
 * @returns {any}
 */
function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {any} uri
 * @returns {string|null}
 */
function cwdFromGlassUri(uri) {
  if (!uri || typeof uri !== "object") return null;
  if (typeof uri.fsPath === "string" && uri.fsPath) return uri.fsPath;
  if (typeof uri.path === "string" && uri.scheme === "file") return uri.path;
  if (typeof uri.external === "string" && uri.external.startsWith("file://")) {
    try {
      let pathname = decodeURIComponent(new URL(uri.external).pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {string} repoUrl
 * @returns {string} repo basename (e.g. faf-pricelist-2.0)
 */
function repoBasename(repoUrl) {
  const cleaned = String(repoUrl || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^git@/i, "")
    .replace(/\.git$/i, "")
    .replace(/^github\.com[/:]/i, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

/**
 * Find a local checkout matching a GitHub repo URL / project name.
 * @param {{
 *   repoUrl?: string|null,
 *   projectName?: string|null,
 *   home?: string,
 *   existsSync?: typeof fs.existsSync,
 *   readdirSync?: typeof fs.readdirSync,
 * }} opts
 * @returns {string|null}
 */
function resolveLocalClone(opts) {
  const home = opts.home ?? os.homedir();
  const exists = opts.existsSync || fs.existsSync;
  const readdir = opts.readdirSync || fs.readdirSync;
  /** @type {string[]} */
  const needles = [];
  if (opts.repoUrl) needles.push(repoBasename(opts.repoUrl));
  if (opts.projectName) {
    const name = String(opts.projectName);
    needles.push(name);
    if (name.includes("/")) needles.push(name.split("/").pop() || name);
  }
  const unique = [...new Set(needles.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return null;

  /** @type {string[]} */
  const candidates = [];
  for (const n of unique) {
    candidates.push(path.join(home, n));
    candidates.push(path.join(home, n.replace(/-/g, " ")));
    // Common Judson variants
    if (/^faf/i.test(n)) {
      candidates.push(path.join(home, "FAF-pricelist-2.0"));
      candidates.push(path.join(home, "FAF-pricebook"));
      candidates.push(path.join(home, "faf-pricelist-2.0"));
    }
  }
  try {
    for (const entry of readdir(home)) {
      const lower = String(entry).toLowerCase();
      if (
        unique.some((n) => {
          const nl = n.toLowerCase();
          return lower === nl || lower.replace(/-/g, "") === nl.replace(/-/g, "");
        })
      ) {
        candidates.push(path.join(home, entry));
      }
    }
  } catch {
    // ignore
  }

  for (const c of candidates) {
    if (!c || !exists(c)) continue;
    return path.resolve(c);
  }
  return null;
}

/**
 * @param {any[]} agents
 * @param {string} agentId
 */
function findCloudAgentRecord(agents, agentId) {
  if (!Array.isArray(agents)) return null;
  const id = String(agentId || "");
  const bare = id.replace(/^bc-/, "");
  return (
    agents.find((a) => a && (a.bcId === id || a.bcId === `bc-${bare}`)) || null
  );
}

/**
 * Resolve the focused Cursor Glass agent → local project cwd.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   dbPath?: string,
 *   readKeys?: typeof readStateDbKeys,
 *   resolveLocalClone?: typeof resolveLocalClone,
 * }} [opts]
 * @returns {{
 *   session_id: string,
 *   cwd: string,
 *   live: boolean,
 *   source: string,
 *   agentId: string,
 *   projectName?: string|null,
 *   repoUrl?: string|null,
 *   kind: 'local'|'cloud',
 * }|null}
 */
function resolveGlassSelectedSession(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const dbPath = opts.dbPath || getStateDbPath({ home, env });
  if (!fs.existsSync(dbPath) && !opts.readKeys) return null;

  const read = opts.readKeys || readStateDbKeys;
  const keys = read(dbPath, GLASS_KEYS);
  const agentId = String(keys["cursor/glass.selectedAgent"] || "").trim();
  if (!agentId) return null;

  const localMembership = parseJson(keys["glass.localAgentProjectMembership.v1"]) || {};
  const localProjects = parseJson(keys["glass.localAgentProjects.v1"]) || [];
  const cloudMembership = parseJson(keys["glass.cloudAgentProjectMembership.v1"]) || {};
  const cloudProjects = parseJson(keys["glass.cloudAgentProjects.v1"]) || [];
  const cloudAgents = parseJson(keys["cloudAgentRepository.agents"]) || [];

  const findLocalProject = (projectId) =>
    (Array.isArray(localProjects) ? localProjects : []).find(
      (p) => p && p.id === projectId
    ) || null;
  const findCloudProject = (projectId) =>
    (Array.isArray(cloudProjects) ? cloudProjects : []).find(
      (p) => p && p.id === projectId
    ) || null;

  // Local agent → file workspace
  const localProjectId = localMembership[agentId];
  if (localProjectId) {
    const project = findLocalProject(localProjectId);
    const cwd = cwdFromGlassUri(project?.workspace?.uri);
    if (cwd) {
      return {
        session_id: agentId,
        cwd: path.resolve(cwd),
        live: true,
        source: "glass_selected_local",
        agentId,
        projectName: project?.name || null,
        kind: "local",
      };
    }
  }

  // Cloud agent (bc-…) → repo → local clone
  const cloudProjectId =
    cloudMembership[agentId] ||
    cloudMembership[`bc-${agentId.replace(/^bc-/, "")}`];
  const cloudRec =
    findCloudAgentRecord(cloudAgents, agentId) ||
    findCloudAgentRecord(cloudAgents, `bc-${agentId.replace(/^bc-/, "")}`);
  const cloudProject = cloudProjectId ? findCloudProject(cloudProjectId) : null;
  const repoUrl =
    cloudRec?.repoUrl ||
    cloudRec?.repoUrls?.[0] ||
    cloudRec?.transportRepoUrls?.[0] ||
    null;
  const projectName = cloudProject?.name || cloudRec?.name || null;
  const resolveClone = opts.resolveLocalClone || resolveLocalClone;
  const cwd = resolveClone({
    repoUrl,
    projectName,
    home,
  });
  if (cwd) {
    return {
      session_id: agentId,
      cwd,
      live: true,
      source: "glass_selected_cloud",
      agentId,
      projectName,
      repoUrl,
      kind: "cloud",
    };
  }

  return null;
}

module.exports = {
  GLASS_KEYS,
  readStateDbKeys,
  cwdFromGlassUri,
  repoBasename,
  resolveLocalClone,
  resolveGlassSelectedSession,
};
