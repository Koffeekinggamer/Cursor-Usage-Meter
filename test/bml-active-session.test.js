"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  cwdFromFolderUri,
  listCursorWorkspaces,
  resolveChatSession,
  meterSelfRoots,
} = require("../src/lib/bml/active-session");
const {
  cwdFromGlassUri,
  repoBasename,
  resolveLocalClone,
  resolveGlassSelectedSession,
} = require("../src/lib/bml/glass-session");

describe("Cursor workspace resolution", () => {
  it("decodes Cursor workspace folder URIs", () => {
    assert.equal(
      cwdFromFolderUri("file:///Users/me/Cursor%20Project"),
      "/Users/me/Cursor Project"
    );
  });

  it("selects the newest valid workspace.json folder", () => {
    const entries = [
      { name: "old", isDirectory: () => true },
      { name: "new", isDirectory: () => true },
    ];
    const workspaces = listCursorWorkspaces({
      userDataDir: "/cursor",
      env: {},
      excludeCwds: new Set(),
      readdirSync: (dir, opts) => {
        if (dir.endsWith("workspaceStorage")) return entries;
        return [];
      },
      statSync: (file) => ({ mtimeMs: String(file).includes("new") ? 20 : 10 }),
      readFileSync: (file) =>
        JSON.stringify({
          folder: String(file).includes("new")
            ? "file:///new-project"
            : "file:///old-project",
        }),
      latestActivityMs: (dir) => (String(dir).includes("new") ? 20 : 10),
    });
    assert.equal(workspaces[0].cwd, "/new-project");
  });

  it("ignores non-file workspace URIs", () => {
    const workspaces = listCursorWorkspaces({
      userDataDir: "/cursor",
      env: {},
      excludeCwds: new Set(),
      readdirSync: () => [{ name: "remote", isDirectory: () => true }],
      statSync: () => ({ mtimeMs: 1 }),
      readFileSync: () =>
        JSON.stringify({
          folder: "vscode-remote://background-composer/workspace",
        }),
      latestActivityMs: () => 1,
    });
    assert.equal(workspaces.length, 0);
  });

  it("prefers CUM_BML_CWD over workspace discovery", () => {
    const session = resolveChatSession({
      env: { CUM_BML_CWD: "/Users/me/target" },
      listWorkspaces: () => [{ cwd: "/other", mtimeMs: 1 }],
      resolveGlass: () => null,
    });
    assert.deepEqual(session, {
      session_id: "cursor-workspace",
      cwd: "/Users/me/target",
      live: true,
      source: "env",
    });
  });

  it("prefers Glass selected Agent over hottest workspaceStorage", () => {
    const session = resolveChatSession({
      env: {},
      resolveGlass: () => ({
        session_id: "agent-1",
        cwd: "/Users/me/faf-pricelist-2.0",
        live: true,
        source: "glass_selected_cloud",
        agentId: "bc-abc",
        projectName: "faf-pricelist-2.0",
        kind: "cloud",
      }),
      resolveHotChat: () => null,
      listWorkspaces: () => [
        { cwd: "/Users/me/Cursor Usage Meter", mtimeMs: 999 },
      ],
    });
    assert.equal(session.cwd, "/Users/me/faf-pricelist-2.0");
    assert.equal(session.source, "glass_selected_cloud");
    assert.equal(session.agentId, "bc-abc");
  });

  it("prefers hot open chat over stale selectedAgent", () => {
    const session = resolveChatSession({
      env: {},
      resolveGlass: () => ({
        session_id: "bc-stale",
        cwd: "/Users/me/faf",
        live: true,
        source: "glass_selected_cloud",
        agentId: "bc-stale",
        kind: "cloud",
      }),
      resolveHotChat: () => ({
        session_id: "agent-live",
        cwd: "/Users/me/Cursor-Usage-Meter",
        live: true,
        source: "open_chat_local",
        agentId: "agent-live",
        kind: "local",
        mtimeMs: Date.now(),
      }),
      listWorkspaces: () => [],
    });
    assert.equal(session.cwd, "/Users/me/Cursor-Usage-Meter");
    assert.equal(session.agentId, "agent-live");
    assert.equal(session.source, "open_chat_local");
  });

  it("returns the newest Cursor workspace when no override exists", () => {
    const session = resolveChatSession({
      env: {},
      resolveGlass: () => null,
      resolveHotChat: () => null,
      listWorkspaces: () => [{ cwd: "/Users/me/target", mtimeMs: 1 }],
    });
    assert.equal(session.cwd, "/Users/me/target");
    assert.equal(session.source, "cursor_workspace");
  });

  it("excludes Meter self roots from fallback ranking", () => {
    const roots = meterSelfRoots({
      CUM_METER_ROOT: "/Users/me/Cursor Usage Meter",
    });
    assert.ok(roots.has(path.resolve("/Users/me/Cursor Usage Meter")));
    assert.ok(
      roots.has(
        path.resolve(path.join(require("os").homedir(), "Developer", "Cursor-Usage-Meter"))
      )
    );
  });
});

describe("glass-session", () => {
  it("decodes glass file URIs", () => {
    assert.equal(
      cwdFromGlassUri({
        fsPath: "/Users/me/Token Usage Meter",
        scheme: "file",
      }),
      "/Users/me/Token Usage Meter"
    );
  });

  it("parses repo basenames", () => {
    assert.equal(
      repoBasename("github.com/koffeekinggamer/faf-pricelist-2.0"),
      "faf-pricelist-2.0"
    );
  });

  it("resolves local clones by repo name", () => {
    const cwd = resolveLocalClone({
      repoUrl: "github.com/koffeekinggamer/faf-pricelist-2.0",
      home: "/home",
      existsSync: (p) => p === "/home/FAF-pricelist-2.0",
      readdirSync: () => ["FAF-pricelist-2.0", "other"],
    });
    assert.equal(cwd, path.resolve("/home/FAF-pricelist-2.0"));
  });

  it("maps selected local agent to project cwd", () => {
    const session = resolveGlassSelectedSession({
      dbPath: "/fake.vscdb",
      home: "/home",
      readKeys: () => ({
        "cursor/glass.selectedAgent": "agent-local",
        "glass.localAgentProjectMembership.v1": JSON.stringify({
          "agent-local": "proj-1",
        }),
        "glass.localAgentProjects.v1": JSON.stringify([
          {
            id: "proj-1",
            name: "My App",
            workspace: {
              uri: { fsPath: "/home/my-app", scheme: "file" },
            },
          },
        ]),
        "glass.cloudAgentProjectMembership.v1": "{}",
        "glass.cloudAgentProjects.v1": "[]",
      }),
    });
    assert.equal(session.cwd, path.resolve("/home/my-app"));
    assert.equal(session.source, "glass_selected_local");
  });

  it("maps selected cloud agent to local clone via repoUrl", () => {
    const session = resolveGlassSelectedSession({
      dbPath: "/fake.vscdb",
      home: "/home",
      readKeys: () => ({
        "cursor/glass.selectedAgent": "bc-ffff",
        "glass.localAgentProjectMembership.v1": "{}",
        "glass.localAgentProjects.v1": "[]",
        "glass.cloudAgentProjectMembership.v1": JSON.stringify({
          "bc-ffff": "cloud-proj",
        }),
        "glass.cloudAgentProjects.v1": JSON.stringify([
          { id: "cloud-proj", name: "koffeekinggamer/faf-pricelist-2.0" },
        ]),
        "cloudAgentRepository.agents": JSON.stringify([
          {
            bcId: "bc-ffff",
            name: "FAF work",
            repoUrl: "github.com/koffeekinggamer/faf-pricelist-2.0",
          },
        ]),
      }),
      resolveLocalClone: () => "/home/FAF-pricelist-2.0",
    });
    assert.equal(session.cwd, "/home/FAF-pricelist-2.0");
    assert.equal(session.source, "glass_selected_cloud");
    assert.equal(session.kind, "cloud");
  });
});
