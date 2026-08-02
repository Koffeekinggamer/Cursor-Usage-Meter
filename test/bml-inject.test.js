"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { injectIntoCursor, injectIntoGrok } = require("../src/lib/bml/inject");

describe("injectIntoCursor", () => {
  it("copies prompt and optionally activates Cursor", async () => {
    const calls = [];
    const result = await injectIntoCursor("/grill-with-docs\nhello", {
      runCommand: async (bin, args) => {
        calls.push({ bin, args });
        return { code: 0, stdout: "ok", stderr: "" };
      },
      copyPrompt: async () => ({ ok: true, method: "clipboard", detail: "copied" }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "clipboard");
    if (process.platform === "darwin") {
      assert.equal(calls[0].bin, "osascript");
      assert.match(calls[0].args[1], /Cursor/);
    }
  });

  it("keeps injectIntoGrok as a deprecated Cursor alias", async () => {
    const result = await injectIntoGrok("prompt text", {
      runCommand: async () => ({ code: 1, stdout: "", stderr: "locked" }),
      copyPrompt: async () => ({
        ok: true,
        method: "clipboard",
        detail: "copied",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "clipboard");
  });
});
