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
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return null;
  }
}

/**
 * Find the newest Cursor workspace folder.
 * @param {{
 *   userDataDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   readdirSync?: typeof fs.readdirSync,
 *   statSync?: typeof fs.statSync,
 *   readFileSync?: typeof fs.readFileSync,
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
  try {
    return readdir(storage, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const file = path.join(storage, entry.name, "workspace.json");
        try {
          const raw = JSON.parse(String(read(file, "utf8")));
          const cwd = cwdFromFolderUri(raw.folder);
          return cwd ? { cwd, mtimeMs: stat(file).mtimeMs } : null;
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
      cwd,
      live: true,
      source: "env",
    };
  }
  const workspace = (opts.listWorkspaces || listCursorWorkspaces)({ env })[0];
  if (!workspace) return null;
  return {
    session_id: "cursor-workspace",
    cwd: workspace.cwd,
    live: true,
    source: "cursor_workspace",
  };
}

module.exports = {
  cwdFromFolderUri,
  listCursorWorkspaces,
  resolveChatSession,
};
