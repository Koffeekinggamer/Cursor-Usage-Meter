"use strict";

/**
 * Optional Cursor SDK inject using model Auto.
 * Falls back silently when @cursor/sdk or CURSOR_API_KEY is unavailable.
 */

/**
 * @param {string} prompt
 * @param {{
 *   cwd?: string,
 *   apiKey?: string,
 *   Agent?: { prompt: Function },
 * }} [opts]
 * @returns {Promise<{ ok: boolean, method: 'sdk-auto'|'unavailable', detail?: string, stdout?: string }>}
 */
async function injectViaCursorSdkAuto(prompt, opts = {}) {
  const apiKey = opts.apiKey || process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      method: "unavailable",
      detail: "CURSOR_API_KEY not set — use clipboard inject.",
    };
  }

  let Agent = opts.Agent;
  if (!Agent) {
    try {
      // Optional dependency — present only when installed.
      // eslint-disable-next-line import/no-extraneous-dependencies
      ({ Agent } = require("@cursor/sdk"));
    } catch {
      return {
        ok: false,
        method: "unavailable",
        detail: "@cursor/sdk not installed — use clipboard inject.",
      };
    }
  }

  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: "auto" },
      local: { cwd: opts.cwd || process.cwd() },
    });
    return {
      ok: true,
      method: "sdk-auto",
      detail: `Cursor SDK Auto finished (${result?.status || "ok"}) in ${opts.cwd || process.cwd()}`,
      stdout: typeof result?.result === "string" ? result.result : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      method: "sdk-auto",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

module.exports = { injectViaCursorSdkAuto };
