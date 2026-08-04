"use strict";

/**
 * Discover live open Cursor Agent chats from on-disk transcript activity.
 * Glass selectedAgent can lag behind the chat you are typing in; transcript
 * mtimes under ~/.cursor/projects/<slug>/agent-transcripts/<agentId> track real work.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * @param {string} home
 * @returns {string}
 */
function projectsRoot(home = os.homedir()) {
  return path.join(home, ".cursor", "projects");
}

/**
 * List Agent chats that have a local transcript folder, newest first.
 * @param {{
 *   home?: string,
 *   projectsRoot?: string,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   maxAgeMs?: number,
 *   now?: number,
 * }} [opts]
 * @returns {{ agentId: string, projectSlug: string, mtimeMs: number, transcriptDir: string }[]}
 */
function listOpenAgentChats(opts = {}) {
  const home = opts.home ?? os.homedir();
  const root = opts.projectsRoot || projectsRoot(home);
  const readdir = opts.readdirSync || fs.readdirSync;
  const stat = opts.statSync || fs.statSync;
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
  /** @type {{ agentId: string, projectSlug: string, mtimeMs: number, transcriptDir: string }[]} */
  const out = [];

  let projectDirs;
  try {
    projectDirs = readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const transcripts = path.join(root, entry.name, "agent-transcripts");
    let agents;
    try {
      agents = readdir(transcripts, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const agentId = agent.name;
      if (!agentId || agentId.startsWith(".")) continue;
      const transcriptDir = path.join(transcripts, agentId);
      let mtimeMs = 0;
      try {
        mtimeMs = Math.max(mtimeMs, stat(transcriptDir).mtimeMs);
      } catch {
        continue;
      }
      // Prefer nested transcript file mtime when present
      try {
        const nested = readdir(transcriptDir, { withFileTypes: true });
        for (const f of nested) {
          try {
            const st = stat(path.join(transcriptDir, f.name));
            if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
      if (maxAgeMs > 0 && now - mtimeMs > maxAgeMs) continue;
      out.push({
        agentId,
        projectSlug: entry.name,
        mtimeMs,
        transcriptDir,
      });
    }
  }

  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Map a Glass agent id to a session via membership + project catalogs.
 * @param {{
 *   agentId: string,
 *   keys: Record<string, string|null>,
 *   home?: string,
 *   resolveLocalClone?: Function,
 *   cwdFromGlassUri?: Function,
 * }} opts
 */
function sessionFromAgentId(opts) {
  const {
    agentId,
    keys,
    home = os.homedir(),
    resolveLocalClone,
    cwdFromGlassUri,
  } = opts;
  if (!agentId || !keys) return null;

  const parse = (raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const localMembership = parse(keys["glass.localAgentProjectMembership.v1"]) || {};
  const localProjects = parse(keys["glass.localAgentProjects.v1"]) || [];
  const cloudMembership = parse(keys["glass.cloudAgentProjectMembership.v1"]) || {};
  const cloudProjects = parse(keys["glass.cloudAgentProjects.v1"]) || [];
  const cloudAgents = parse(keys["cloudAgentRepository.agents"]) || [];

  const findLocal = (id) =>
    (Array.isArray(localProjects) ? localProjects : []).find((p) => p && p.id === id) ||
    null;
  const findCloud = (id) =>
    (Array.isArray(cloudProjects) ? cloudProjects : []).find((p) => p && p.id === id) ||
    null;
  const findCloudAgent = (id) => {
    if (!Array.isArray(cloudAgents)) return null;
    const bare = String(id || "").replace(/^bc-/, "");
    return (
      cloudAgents.find((a) => a && (a.bcId === id || a.bcId === `bc-${bare}`)) ||
      null
    );
  };

  const localProjectId = localMembership[agentId];
  if (localProjectId && cwdFromGlassUri) {
    const project = findLocal(localProjectId);
    const cwd = cwdFromGlassUri(project?.workspace?.uri);
    if (cwd) {
      return {
        session_id: agentId,
        cwd: path.resolve(cwd),
        live: true,
        source: "open_chat_local",
        agentId,
        projectName: project?.name || null,
        kind: /** @type {const} */ ("local"),
      };
    }
  }

  const cloudProjectId =
    cloudMembership[agentId] ||
    cloudMembership[`bc-${String(agentId).replace(/^bc-/, "")}`];
  const cloudRec =
    findCloudAgent(agentId) ||
    findCloudAgent(`bc-${String(agentId).replace(/^bc-/, "")}`);
  const cloudProject = cloudProjectId ? findCloud(cloudProjectId) : null;
  const repoUrl =
    cloudRec?.repoUrl ||
    cloudRec?.repoUrls?.[0] ||
    cloudRec?.transportRepoUrls?.[0] ||
    null;
  const projectName = cloudProject?.name || cloudRec?.name || null;
  if (resolveLocalClone) {
    const cwd = resolveLocalClone({ repoUrl, projectName, home });
    if (cwd) {
      return {
        session_id: agentId,
        cwd,
        live: true,
        source: "open_chat_cloud",
        agentId,
        projectName,
        repoUrl,
        kind: /** @type {const} */ ("cloud"),
      };
    }
  }

  return null;
}

/**
 * Resolve the hottest open chat that maps to a local project cwd.
 * @param {{
 *   home?: string,
 *   listChats?: typeof listOpenAgentChats,
 *   readKeys?: Function,
 *   dbPath?: string,
 *   resolveLocalClone?: Function,
 *   cwdFromGlassUri?: Function,
 *   preferAgentId?: string|null,
 *   hotWindowMs?: number,
 * }} [opts]
 */
function resolveHotOpenChatSession(opts = {}) {
  const home = opts.home ?? os.homedir();
  const list = opts.listChats || listOpenAgentChats;
  const chats = list({ home });
  if (!chats.length) return null;

  const hotWindowMs = opts.hotWindowMs ?? 15 * 60 * 1000;
  const now = Date.now();

  // Prefer an explicit agent (e.g. selectedAgent) when it is still hot.
  const prefer = opts.preferAgentId ? String(opts.preferAgentId) : null;
  /** @type {typeof chats} */
  const ordered = prefer
    ? [
        ...chats.filter((c) => c.agentId === prefer),
        ...chats.filter((c) => c.agentId !== prefer),
      ]
    : chats;

  // Lazy-load glass helpers to avoid circular requires at module load.
  const glass = require("./glass-session");
  const readKeys = opts.readKeys || glass.readStateDbKeys;
  const cwdFromGlassUri = opts.cwdFromGlassUri || glass.cwdFromGlassUri;
  const resolveLocalClone = opts.resolveLocalClone || glass.resolveLocalClone;
  const dbPath = opts.dbPath || require("../paths").getStateDbPath({ home });

  const keys = readKeys(dbPath, glass.GLASS_KEYS);

  for (const chat of ordered) {
    // Skip stale transcripts unless it is the preferred selected agent.
    const isPrefer = prefer && chat.agentId === prefer;
    if (!isPrefer && now - chat.mtimeMs > hotWindowMs) continue;

    const session = sessionFromAgentId({
      agentId: chat.agentId,
      keys,
      home,
      resolveLocalClone,
      cwdFromGlassUri,
    });
    if (session?.cwd) {
      return {
        ...session,
        mtimeMs: chat.mtimeMs,
        projectSlug: chat.projectSlug,
      };
    }
  }

  return null;
}

module.exports = {
  projectsRoot,
  listOpenAgentChats,
  sessionFromAgentId,
  resolveHotOpenChatSession,
};
