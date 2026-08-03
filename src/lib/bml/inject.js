"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getMeterDataDir } = require("../paths");

/**
 * @typedef {{
 *   ok: boolean,
 *   method: 'clipboard'|'sdk-auto'|'unavailable',
 *   detail?: string,
 *   stdout?: string,
 *   needsConfirm?: boolean,
 * }} InjectResult
 */

/** @type {import('child_process').ChildProcess|null} */
let activeChild = null;

/**
 * Kill the in-flight clipboard/activation process (if any). Used by BML Cancel.
 * @returns {boolean} true if a process was signaled
 */
function abortActiveInject() {
  if (!activeChild) return false;
  const child = activeChild;
  activeChild = null;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  // Escalate if still around shortly after
  setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 400);
  return true;
}

/**
 * Run a command and collect stdout/stderr.
 * @param {string} bin
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn, timeoutMs?: number, trackActive?: boolean }} [opts]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, aborted?: boolean }>}
 */
function runCommand(bin, args, opts = {}) {
  const spawnImpl = opts.spawnImpl || spawn;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const trackActive = opts.trackActive !== false;
  return new Promise((resolve) => {
    const child = spawnImpl(bin, args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (trackActive) activeChild = child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      settled = true;
      if (trackActive && activeChild === child) activeChild = null;
      resolve({ code: null, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (trackActive && activeChild === child) activeChild = null;
      resolve({ code: 1, stdout, stderr: String(err.message || err) });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (trackActive && activeChild === child) activeChild = null;
      const aborted = signal === "SIGTERM" || signal === "SIGKILL";
      resolve({
        code,
        stdout,
        stderr: aborted ? (stderr || "") + "\n[aborted]" : stderr,
        aborted,
      });
    });
  });
}

/**
 * Write prompt to Cursor Meter's backup file and copy it on macOS.
 * @param {string} prompt
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   writeFileSync?: typeof fs.writeFileSync,
 *   spawnImpl?: typeof spawn,
 * }} [opts]
 * @returns {Promise<InjectResult>}
 */
async function copyPromptToClipboard(prompt, opts = {}) {
  const env = opts.env ?? process.env;
  const write = opts.writeFileSync || fs.writeFileSync;
  const copyPath =
    env.CUM_COPY_FILE ||
    path.join(getMeterDataDir({ env }), "bml-last-prompt.txt");
  try {
    fs.mkdirSync(path.dirname(copyPath), { recursive: true });
    write(copyPath, prompt, "utf8");
  } catch (err) {
    return {
      ok: false,
      method: "clipboard",
      detail: `Failed to write copy file: ${err instanceof Error ? err.message : err}`,
    };
  }

  // pbcopy reads stdin on macOS
  if (process.platform === "darwin") {
    const r = await new Promise((resolve) => {
      const spawnImpl = opts.spawnImpl || spawn;
      const child = spawnImpl("pbcopy", [], {
        env: { ...process.env, ...env },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (err) => {
        resolve({ code: 1, stderr: String(err.message || err) });
      });
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.write(prompt);
      child.stdin.end();
    });
    if (r.code === 0) {
      return {
        ok: true,
        method: "clipboard",
        needsConfirm: true,
        detail: "Copied.",
      };
    }
  }

  return {
    ok: true,
    method: "clipboard",
    needsConfirm: true,
    detail: "Prompt saved.",
  };
}

/**
 * Whether auto-paste into Cursor Agent is enabled (default on for macOS).
 * @param {NodeJS.ProcessEnv} env
 */
function wantAutoPaste(env) {
  const v = env.CUM_BML_PASTE;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

/**
 * Whether to press Return after paste (default on).
 * @param {NodeJS.ProcessEnv} env
 */
function wantAutoSend(env) {
  const v = env.CUM_BML_SEND;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

/**
 * AppleScript: activate Cursor, focus Agent sidepanel, paste into input, optionally send.
 * Cursor maps ⌘⇧V to "Add clipboard to input box" (plain ⌘V only adds context).
 * Requires Accessibility permission for Cursor Usage Meter / osascript.
 * @param {{ send?: boolean }} [opts]
 * @returns {string}
 */
function buildPasteIntoAgentScript(opts = {}) {
  const send = opts.send !== false;
  const sendLines = send
    ? `
    delay 0.2
    key code 36`
    : "";
  return `
tell application "Cursor" to activate
delay 0.5
tell application "System Events"
  tell process "Cursor"
    set frontmost to true
    -- Focus Agent / sidepanel input (Cmd+I)
    keystroke "i" using {command down}
    delay 0.45
    -- Paste clipboard into the chat/agent input (Cmd+Shift+V)
    keystroke "v" using {command down, shift down}${sendLines}
  end tell
end tell
`.trim();
}

/**
 * Inject a BML skill prompt into Cursor (clipboard + auto-paste into Agent).
 * @param {string} prompt
 * @param {{
 *   preferCwd?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   runCommand?: typeof runCommand,
 *   copyPrompt?: typeof copyPromptToClipboard,
 *   spawnImpl?: typeof spawn,
 *   Agent?: unknown,
 * }} [opts]
 * @returns {Promise<InjectResult>}
 */
async function injectIntoCursor(prompt, opts = {}) {
  const env = opts.env ?? process.env;
  const run = opts.runCommand || runCommand;
  const copy = opts.copyPrompt || copyPromptToClipboard;
  const preferCwd = opts.preferCwd || env.CUM_BML_CWD || process.cwd();

  // 1) Optional Cursor SDK on Auto (opt-in: CUM_BML_SDK=1).
  const wantSdk = env.CUM_BML_SDK === "1" || env.CUM_BML_SDK === "true";
  if (wantSdk) {
    try {
      const { injectViaCursorSdkAuto } = require("./inject-sdk");
      const sdk = await injectViaCursorSdkAuto(prompt, {
        cwd: preferCwd,
        apiKey: env.CURSOR_API_KEY,
        Agent: opts.Agent,
      });
      if (sdk.ok) return sdk;
    } catch {
      // fall through to clipboard
    }
  }

  // 2) Clipboard + activate Cursor Agent + paste/send
  const clip = await copy(prompt, {
    env,
    spawnImpl: opts.spawnImpl,
  });
  if (!clip.ok || process.platform !== "darwin") {
    return {
      ...clip,
      needsConfirm: Boolean(clip.ok),
      detail:
        (clip.detail || "Clipboard inject.") +
        " Paste into Cursor Agent (⌘⇧V), then click Continue.",
    };
  }

  const doPaste = wantAutoPaste(env);
  const doSend = wantAutoSend(env);

  if (!doPaste) {
    const activate = await run(
      "osascript",
      ["-e", 'tell application "Cursor" to activate'],
      { env, spawnImpl: opts.spawnImpl, timeoutMs: 5_000 }
    );
    if (activate.aborted) {
      return { ok: false, method: "clipboard", detail: "Cancelled during inject" };
    }
    return {
      ...clip,
      method: "clipboard",
      needsConfirm: true,
      detail:
        (clip.detail || "Copied.") +
        (activate.code === 0 ? " Cursor activated." : "") +
        " Paste into Agent (⌘⇧V), then click Continue.",
    };
  }

  const script = buildPasteIntoAgentScript({ send: doSend });
  const paste = await run("osascript", ["-e", script], {
    env,
    spawnImpl: opts.spawnImpl,
    timeoutMs: 15_000,
  });
  if (paste.aborted) {
    return { ok: false, method: "clipboard", detail: "Cancelled during inject" };
  }

  if (paste.code !== 0) {
    return {
      ...clip,
      method: "clipboard",
      needsConfirm: true,
      detail:
        (clip.detail || "Copied.") +
        " Auto-paste failed (grant Accessibility to Cursor Usage Meter / osascript)." +
        " Paste into Agent (⌘⇧V), then click Continue." +
        (paste.stderr ? ` ${String(paste.stderr).slice(0, 120)}` : ""),
    };
  }

  return {
    ...clip,
    method: "clipboard",
    needsConfirm: true,
    detail: doSend
      ? "Pasted into Agent and sent. When the skill finishes, click Continue."
      : "Pasted into Agent. Send if needed, then click Continue when done.",
  };
}

module.exports = {
  runCommand,
  copyPromptToClipboard,
  injectIntoCursor,
  buildPasteIntoAgentScript,
  /** @deprecated Use injectIntoCursor. */
  injectIntoGrok: injectIntoCursor,
  abortActiveInject,
};
