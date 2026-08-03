"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getCursorUserDataDir } = require("../paths");
const { resolveGlassSelectedSession } = require("./glass-session");

/**
 * Decode a file URI from Cursor's workspace storage.
 * @param {string} uri
 * @returns {string|null}
 */
function cwdFromFolderUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  try {
    let pathname = decodeURIComponent(new URL(uri).pathname);
    // Windows file URIs arrive as /C:/...
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

/**
 * Newest mtime under a directory (shallow+nested, capped).
 * @param {string} root
 * @param {{
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   maxEntries?: number,
 * }} [opts]
 */
function latestActivityMs(root, opts = {}) {
  const readdir = opts.readdirSync || fs.readdirSync;
  const stat = opts.statSync || fs.statSync;
  const maxEntries = opts.maxEntries ?? 80;
  let latest = 0;
  let seen = 0;
  /** @type {string[]} */
  const queue = [root];
  while (queue.length && seen < maxEntries) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen >= maxEntries) break;
      const full = path.join(dir, entry.name);
      seen += 1;
      try {
        const st = stat(full);
        if (st.mtimeMs > latest) latest = st.mtimeMs;
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          queue.push(full);
        }
      } catch {
        // ignore
      }
    }
  }
  return latest;
}

/**
 * Paths that are the Meter app itself — too hot from BML to mean "active task".
 * @param {NodeJS.ProcessEnv} env
 * @returns {Set<string>}
 */
function meterSelfRoots(env = process.env) {
  const roots = new Set();
  const add = (p) => {
    if (!p) return;
    try {
      roots.add(path.resolve(String(p)));
    } catch {
      // ignore
    }
  };
  add(env.CUM_METER_ROOT);
  add(env.CUM_APP_ROOT);
  // Common install / checkout names
  add(path.join(os.homedir(), "Cursor Usage Meter"));
  try {
    add(path.join(__dirname, "..", "..", ".."));
  } catch {
    // ignore
  }
  return roots;
}

/**
 * Find Cursor workspace folders ordered by recent activity (not just workspace.json mtime).
 * @param {{
 *   userDataDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   latestActivityMs?: typeof latestActivityMs,
 *   excludeCwds?: Set<string>|string[],
 * }} [opts]
 */
function listCursorWorkspaces(opts = {}) {
  const env = opts.env ?? process.env;
  const root =
    opts.userDataDir ||
    getCursorUserDataDir({ home: opts.home ?? os.homedir(), env });
  const storage = path.join(root, "User", "workspaceStorage");
  const readdir = opts.readdirSync || fs.readdirSync;
  const stat = opts.statSync || fs.statSync;
  const read = opts.readFileSync || fs.readFileSync;
  const activity = opts.latestActivityMs || latestActivityMs;
  const exclude = new Set(
    [...(opts.excludeCwds || meterSelfRoots(env))].map((p) => {
      try {
        return path.resolve(String(p));
      } catch {
        return String(p);
      }
    })
  );
  try {
    return readdir(storage, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dir = path.join(storage, entry.name);
        const file = path.join(dir, "workspace.json");
        try {
          const raw = JSON.parse(String(read(file, "utf8")));
          const cwd = cwdFromFolderUri(raw.folder);
          if (!cwd) return null;
          if (exclude.has(path.resolve(cwd))) return null;
          const fileMtime = stat(file).mtimeMs;
          const activeMs = Math.max(
            fileMtime,
            activity(dir, { readdirSync: readdir, statSync: stat })
          );
          return { cwd, mtimeMs: activeMs, storageId: entry.name };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

/**
 * Resolve the Cursor project for the focused Agent / open task.
 * Priority: env override → Glass selectedAgent → hottest non-Meter workspaceStorage.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   preferCwd?: string|null,
 *   listWorkspaces?: typeof listCursorWorkspaces,
 *   resolveGlass?: typeof resolveGlassSelectedSession,
 *   home?: string,
 * }} [opts]
 */
function resolveChatSession(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd =
    opts.preferCwd ||
    env.CUM_BML_CWD ||
    env.GUM_BML_CWD ||
    env.CUM_PROJECT_CWD ||
    null;
  if (cwd) {
    return {
      session_id: "cursor-workspace",
      cwd: path.resolve(cwd),
      live: true,
      source: "env",
    };
  }

  const resolveGlass = opts.resolveGlass || resolveGlassSelectedSession;
  try {
    const glass = resolveGlass({
      env,
      home: opts.home ?? os.homedir(),
    });
    if (glass?.cwd) {
      return {
        session_id: glass.session_id || glass.agentId || "glass-agent",
        cwd: glass.cwd,
        live: true,
        source: glass.source || "glass_selected",
        agentId: glass.agentId,
        projectName: glass.projectName || null,
        repoUrl: glass.repoUrl || null,
        kind: glass.kind,
      };
    }
  } catch {
    // fall through to workspaceStorage
  }

  const workspace = (opts.listWorkspaces || listCursorWorkspaces)({
    env,
    home: opts.home,
  })[0];
  if (!workspace) return null;
  return {
    session_id: workspace.storageId || "cursor-workspace",
    cwd: workspace.cwd,
    live: true,
    source: "cursor_workspace",
  };
}

module.exports = {
  cwdFromFolderUri,
  latestActivityMs,
  listCursorWorkspaces,
  meterSelfRoots,
  resolveChatSession,
};
