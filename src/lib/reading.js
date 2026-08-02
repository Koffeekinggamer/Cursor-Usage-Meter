"use strict";

const { readCursorAccount } = require("./auth");
const { fetchUsageSummary } = require("./usage");

/**
 * @typedef {{ kind: 'missing-db'|'unsigned-in'|'http'|'parse'|'unknown', message: string }} Fault
 * @typedef {{
 *   percent: number,
 *   used: unknown,
 *   limit: unknown,
 *   remaining: unknown,
 *   autoPercentUsed: number|null,
 *   apiPercentUsed: number|null,
 *   onDemandUsed: unknown,
 *   membershipType: string|null,
 *   isUnlimited: boolean,
 *   billingCycleStart: string|null,
 *   billingCycleEnd: string|null,
 *   displayMessage: string|null,
 *   email: string|null,
 * }} Reading
 */

/**
 * Classify a thrown error into a Fault.
 * @param {unknown} err
 * @returns {Fault}
 */
function classifyFault(err) {
  const message = err instanceof Error ? err.message : String(err);

  if (/state database not found/i.test(message)) {
    return { kind: "missing-db", message };
  }
  if (/accessToken|sign in to Cursor/i.test(message)) {
    return { kind: "unsigned-in", message };
  }
  if (/usage-summary failed/i.test(message)) {
    return { kind: "http", message };
  }
  if (/usage-summary response is empty|Invalid JWT|missing a sub/i.test(message)) {
    return { kind: "parse", message };
  }
  return { kind: "unknown", message };
}

/**
 * Produce a Reading for the signed-in account, or a Fault.
 * @param {{
 *   dbPath?: string,
 *   fetchImpl?: typeof fetch,
 *   endpoint?: string,
 *   readAccount?: typeof readCursorAccount,
 *   fetchUsage?: typeof fetchUsageSummary,
 * }} [opts]
 * @returns {Promise<{ ok: true, reading: Reading } | { ok: false, fault: Fault }>}
 */
async function takeReading(opts = {}) {
  const readAccount = opts.readAccount || readCursorAccount;
  const fetchUsage = opts.fetchUsage || fetchUsageSummary;

  try {
    const account = await readAccount({ dbPath: opts.dbPath });
    const usage = await fetchUsage({
      sessionCookie: account.sessionCookie,
      fetchImpl: opts.fetchImpl,
      endpoint: opts.endpoint,
    });

    return {
      ok: true,
      reading: {
        percent: usage.percent,
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
        autoPercentUsed: usage.autoPercentUsed,
        apiPercentUsed: usage.apiPercentUsed,
        onDemandUsed: usage.onDemandUsed,
        membershipType: usage.membershipType || account.membershipType || null,
        isUnlimited: usage.isUnlimited,
        billingCycleStart: usage.billingCycleStart,
        billingCycleEnd: usage.billingCycleEnd,
        displayMessage: usage.displayMessage,
        email: account.email,
      },
    };
  } catch (err) {
    return { ok: false, fault: classifyFault(err) };
  }
}

module.exports = {
  classifyFault,
  takeReading,
};
