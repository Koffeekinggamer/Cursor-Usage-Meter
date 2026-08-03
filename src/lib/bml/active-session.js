"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getCursorUserDataDir } = require("../paths");

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
 * Find Cursor workspace folders ordered by recent activity (not just workspace.json mtime).
 * @param {{
 *   userDataDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
 *   latestActivityMs?: typeof latestActivityMs,
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
 * Resolve the Cursor project currently represented by its workspace storage.
 * Env overrides intentionally win for deterministic coaching.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   preferCwd?: string|null,
 *   listWorkspaces?: typeof listCursorWorkspaces,
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
  const workspace = (opts.listWorkspaces || listCursorWorkspaces)({ env })[0];
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
  resolveChatSession,
};
