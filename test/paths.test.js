"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { getStateDbPath, getCursorUserDataDir, getMeterDataDir } = require("../src/lib/paths");

describe("getStateDbPath", () => {
  it("uses CURSOR_STATE_DB when set", () => {
    const p = getStateDbPath({
      env: { CURSOR_STATE_DB: "/tmp/custom.vscdb" },
      home: "/Users/test",
      platform: "darwin",
    });
    assert.equal(p, "/tmp/custom.vscdb");
  });

  it("resolves macOS Application Support path", () => {
    const p = getStateDbPath({
      env: {},
      home: "/Users/judson",
      platform: "darwin",
    });
    assert.equal(
      p,
      path.join(
        "/Users/judson",
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );
  });

  it("resolves Windows APPDATA path", () => {
    const p = getStateDbPath({
      env: { APPDATA: "C:\\\\Users\\\\j\\\\AppData\\\\Roaming" },
      home: "C:\\\\Users\\\\j",
      platform: "win32",
    });
    assert.match(p, /Cursor[/\\]User[/\\]globalStorage[/\\]state\.vscdb$/);
  });

  it("resolves Linux XDG path", () => {
    const p = getStateDbPath({
      env: { XDG_CONFIG_HOME: "/home/j/.config" },
      home: "/home/j",
      platform: "linux",
    });
    assert.equal(
      p,
      path.join(
        "/home/j/.config",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );
  });
});

describe("Cursor data directories", () => {
  it("honors Cursor and Meter overrides", () => {
    assert.equal(getCursorUserDataDir({ env: { CURSOR_USER_DATA: "/tmp/cursor" } }), "/tmp/cursor");
    assert.equal(getMeterDataDir({ env: { CUM_DATA_DIR: "/tmp/meter" } }), "/tmp/meter");
  });

  it("resolves the macOS application-data paths", () => {
    const opts = { env: {}, home: "/Users/judson", platform: "darwin" };
    assert.equal(getCursorUserDataDir(opts), "/Users/judson/Library/Application Support/Cursor");
    assert.equal(getMeterDataDir(opts), "/Users/judson/Library/Application Support/cursor-usage-meter");
  });
});
