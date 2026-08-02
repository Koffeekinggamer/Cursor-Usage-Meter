"use strict";

/**
 * Normalize a usage-summary API payload into gauge-friendly metrics.
 * @param {any} summary
 */
function parseUsageSummary(summary) {
  if (!summary || typeof summary !== "object") {
    throw new Error("usage-summary response is empty");
  }

  const plan = summary.individualUsage?.plan ?? {};
  const onDemand = summary.individualUsage?.onDemand ?? {};

  let percent = Number(plan.totalPercentUsed);
  if (!Number.isFinite(percent)) {
    const used = Number(plan.used);
    const limit = Number(plan.limit);
    if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
      percent = (used / limit) * 100;
    } else {
      percent = 0;
    }
  }

  percent = Math.max(0, Math.min(percent, 150));

  return {
    percent,
    used: plan.used ?? null,
    limit: plan.limit ?? null,
    remaining: plan.remaining ?? null,
    autoPercentUsed: Number.isFinite(Number(plan.autoPercentUsed))
      ? Number(plan.autoPercentUsed)
      : null,
    apiPercentUsed: Number.isFinite(Number(plan.apiPercentUsed))
      ? Number(plan.apiPercentUsed)
      : null,
    onDemandUsed: onDemand.enabled ? onDemand.used ?? null : null,
    membershipType: summary.membershipType ?? null,
    isUnlimited: Boolean(summary.isUnlimited),
    billingCycleStart: summary.billingCycleStart ?? null,
    billingCycleEnd: summary.billingCycleEnd ?? null,
    displayMessage:
      summary.autoModelSelectedDisplayMessage ||
      summary.namedModelSelectedDisplayMessage ||
      null,
  };
}

/**
 * Fetch Cursor usage for the signed-in account.
 * @param {{ sessionCookie: string, fetchImpl?: typeof fetch, endpoint?: string }} opts
 */
async function fetchUsageSummary(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node runtime");
  }

  const endpoint = opts.endpoint || "https://cursor.com/api/usage-summary";
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      Cookie: `WorkosCursorSessionToken=${opts.sessionCookie}`,
      Accept: "application/json",
      "User-Agent": "TokenUsageMeter/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `usage-summary failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }

  const json = await response.json();
  return parseUsageSummary(json);
}

/**
 * Map percent used to needle angle.
 * Face sweeps from -120° (0%) to +120° (100%); overshoot to +150° at 125%+.
 * @param {number} percent
 */
function percentToNeedleAngle(percent) {
  const p = Math.max(0, Math.min(Number(percent) || 0, 125));
  const start = -120;
  const end = 120;
  const t = p / 100;
  return start + (end - start) * Math.min(t, 1) + (t > 1 ? ((t - 1) / 0.25) * 30 : 0);
}

module.exports = {
  parseUsageSummary,
  fetchUsageSummary,
  percentToNeedleAngle,
};
