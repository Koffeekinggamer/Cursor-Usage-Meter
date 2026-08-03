"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  injectIntoCursor,
  injectIntoGrok,
  buildPasteIntoAgentScript,
} = require("../src/lib/bml/inject");

describe("injectIntoCursor", () => {
  it("copies prompt and pastes into Cursor Agent on macOS", async () => {
    const calls = [];
    const result = await injectIntoCursor("/grill-with-docs\nhello", {
      runCommand: async (bin, args) => {
        calls.push({ bin, args });
        return { code: 0, stdout: "ok", stderr: "" };
      },
      copyPrompt: async () => ({ ok: true, method: "clipboard", detail: "Copied." }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "clipboard");
    assert.equal(result.needsConfirm, true);
    if (process.platform === "darwin") {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].bin, "osascript");
      const script = calls[0].args[1];
      assert.match(script, /Cursor/);
      assert.match(script, /shift down/);
      assert.match(script, /keystroke "i"/);
      assert.match(script, /key code 36/);
      assert.match(result.detail, /Pasted into Agent/);
    }
  });

  it("skips paste when CUM_BML_PASTE=0", async () => {
    const calls = [];
    const result = await injectIntoCursor("prompt", {
      env: { ...process.env, CUM_BML_PASTE: "0" },
      runCommand: async (bin, args) => {
        calls.push({ bin, args });
        return { code: 0, stdout: "", stderr: "" };
      },
      copyPrompt: async () => ({ ok: true, method: "clipboard", detail: "Copied." }),
    });
    assert.equal(result.ok, true);
    if (process.platform === "darwin") {
      assert.equal(calls[0].bin, "osascript");
      assert.match(calls[0].args[1], /activate/);
      assert.doesNotMatch(calls[0].args[1], /shift down/);
    }
  });

  it("keeps injectIntoGrok as a deprecated Cursor alias", async () => {
    const result = await injectIntoGrok("prompt text", {
      env: { ...process.env, CUM_BML_PASTE: "0" },
      runCommand: async () => ({ code: 1, stdout: "", stderr: "locked" }),
      copyPrompt: async () => ({
        ok: true,
        method: "clipboard",
        detail: "Copied.",
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "clipboard");
  });

  it("buildPasteIntoAgentScript uses Cmd+Shift+V for Agent input", () => {
    const script = buildPasteIntoAgentScript({ send: true });
    assert.match(script, /command down, shift down/);
    assert.match(script, /key code 36/);
  });
});
