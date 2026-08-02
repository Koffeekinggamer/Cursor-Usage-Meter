"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  cwdFromFolderUri,
  listCursorWorkspaces,
  resolveChatSession,
} = require("../src/lib/bml/active-session");

describe("Cursor workspace resolution", () => {
  it("decodes Cursor workspace folder URIs", () => {
    assert.equal(
      cwdFromFolderUri("file:///Users/me/Cursor%20Project"),
      "/Users/me/Cursor Project"
    );
  });

  it("selects the newest valid workspace.json folder", () => {
    const entries = [{ name: "old", isDirectory: () => true }, { name: "new", isDirectory: () => true }];
    const workspaces = listCursorWorkspaces({
      userDataDir: "/cursor",
      readdirSync: () => entries,
      statSync: (file) => ({ mtimeMs: file.includes("new") ? 20 : 10 }),
      readFileSync: (file) => JSON.stringify({
        folder: file.includes("new") ? "file:///new-project" : "file:///old-project",
      }),
    });
    assert.equal(workspaces[0].cwd, "/new-project");
  });

  it("prefers CUM_BML_CWD over workspace discovery", () => {
    const session = resolveChatSession({
      env: { CUM_BML_CWD: "/Users/me/target" },
      listWorkspaces: () => [{ cwd: "/other", mtimeMs: 1 }],
    });
    assert.deepEqual(session, {
      session_id: "cursor-workspace",
      cwd: "/Users/me/target",
      live: true,
      source: "env",
    });
  });

  it("returns the newest Cursor workspace when no override exists", () => {
    const session = resolveChatSession({
      env: {},
      listWorkspaces: () => [{ cwd: "/Users/me/target", mtimeMs: 1 }],
    });
    assert.equal(session.cwd, "/Users/me/target");
    assert.equal(session.source, "cursor_workspace");
  });
});
