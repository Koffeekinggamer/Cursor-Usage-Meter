"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  listOpenAgentChats,
  sessionFromAgentId,
  resolveHotOpenChatSession,
} = require("../src/lib/bml/open-chats");

describe("open-chats", () => {
  it("lists agent transcripts newest first", () => {
    const chats = listOpenAgentChats({
      home: "/home",
      projectsRoot: "/home/.cursor/projects",
      now: 1_000_000,
      maxAgeMs: 1_000_000,
      readdirSync: (dir, opts) => {
        if (dir === "/home/.cursor/projects") {
          return [
            { name: "proj-a", isDirectory: () => true },
            { name: "proj-b", isDirectory: () => true },
          ];
        }
        if (dir.endsWith("agent-transcripts")) {
          const agent = dir.includes("proj-a") ? "agent-old" : "agent-new";
          return [{ name: agent, isDirectory: () => true }];
        }
        return [{ name: "chat.jsonl", isDirectory: () => false }];
      },
      statSync: (p) => {
        if (String(p).includes("agent-new")) return { mtimeMs: 900_000 };
        if (String(p).includes("agent-old")) return { mtimeMs: 100_000 };
        return { mtimeMs: 50_000 };
      },
    });
    assert.equal(chats[0].agentId, "agent-new");
    assert.equal(chats[1].agentId, "agent-old");
  });

  it("maps local agent membership to cwd", () => {
    const session = sessionFromAgentId({
      agentId: "agent-local",
      home: "/home",
      cwdFromGlassUri: (uri) => uri?.fsPath || null,
      keys: {
        "glass.localAgentProjectMembership.v1": JSON.stringify({
          "agent-local": "proj-1",
        }),
        "glass.localAgentProjects.v1": JSON.stringify([
          {
            id: "proj-1",
            name: "My App",
            workspace: { uri: { fsPath: "/home/my-app" } },
          },
        ]),
        "glass.cloudAgentProjectMembership.v1": "{}",
        "glass.cloudAgentProjects.v1": "[]",
      },
    });
    assert.equal(session.cwd, path.resolve("/home/my-app"));
    assert.equal(session.source, "open_chat_local");
  });

  it("prefers preferred agent when resolving hot open chat", () => {
    const session = resolveHotOpenChatSession({
      home: "/home",
      preferAgentId: "agent-b",
      hotWindowMs: 60_000,
      listChats: () => [
        {
          agentId: "agent-a",
          projectSlug: "a",
          mtimeMs: Date.now(),
          transcriptDir: "/t/a",
        },
        {
          agentId: "agent-b",
          projectSlug: "b",
          mtimeMs: Date.now() - 1000,
          transcriptDir: "/t/b",
        },
      ],
      readKeys: () => ({
        "glass.localAgentProjectMembership.v1": JSON.stringify({
          "agent-a": "pa",
          "agent-b": "pb",
        }),
        "glass.localAgentProjects.v1": JSON.stringify([
          {
            id: "pa",
            name: "A",
            workspace: { uri: { fsPath: "/home/a" } },
          },
          {
            id: "pb",
            name: "B",
            workspace: { uri: { fsPath: "/home/b" } },
          },
        ]),
        "glass.cloudAgentProjectMembership.v1": "{}",
        "glass.cloudAgentProjects.v1": "[]",
      }),
      cwdFromGlassUri: (uri) => uri?.fsPath || null,
      resolveLocalClone: () => null,
      dbPath: "/fake.vscdb",
    });
    assert.equal(session.agentId, "agent-b");
    assert.equal(session.cwd, path.resolve("/home/b"));
  });
});
