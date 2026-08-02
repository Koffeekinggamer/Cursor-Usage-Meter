"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parseUsageSummary,
  fetchUsageSummary,
  percentToNeedleAngle,
} = require("../src/lib/usage");
const {
  stepNeedle,
  colorForPercent,
  dualPercents,
  CURSOR_NEEDLE_COLOR,
} = require("../src/lib/gauge");
const { faceFromReading } = require("../src/lib/face");

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "usage-summary.json"),
    "utf8"
  )
);

describe("parseUsageSummary", () => {
  it("parses the fixture into gauge metrics", () => {
    const usage = parseUsageSummary(fixture);
    assert.equal(usage.percent, 42);
    assert.equal(usage.used, 420);
    assert.equal(usage.limit, 1000);
    assert.equal(usage.membershipType, "pro");
    assert.equal(usage.isUnlimited, false);
  });

  it("derives percent from used/limit when totalPercentUsed missing", () => {
    const usage = parseUsageSummary({
      individualUsage: { plan: { used: 25, limit: 50 } },
    });
    assert.equal(usage.percent, 50);
  });
});

describe("fetchUsageSummary", () => {
  it("sends session cookie and parses JSON", async () => {
    const usage = await fetchUsageSummary({
      sessionCookie: "user%3A%3Atoken",
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://cursor.com/api/usage-summary");
        assert.match(init.headers.Cookie, /WorkosCursorSessionToken=user%3A%3Atoken/);
        return {
          ok: true,
          async json() {
            return fixture;
          },
          async text() {
            return "";
          },
        };
      },
    });
    assert.equal(usage.percent, 42);
  });

  it("surfaces HTTP failures", async () => {
    await assert.rejects(
      () =>
        fetchUsageSummary({
          sessionCookie: "x",
          fetchImpl: async () => ({
            ok: false,
            status: 401,
            async text() {
              return '{"error":"not_authenticated"}';
            },
          }),
        }),
      /401/
    );
  });
});

describe("needle math", () => {
  it("maps 0/50/100 percent to dial angles", () => {
    assert.equal(percentToNeedleAngle(0), -120);
    assert.equal(percentToNeedleAngle(50), 0);
    assert.equal(percentToNeedleAngle(100), 120);
  });

  it("steps spring-damper toward the target", () => {
    let state = { angle: -120, velocity: 0 };
    for (let i = 0; i < 120; i++) {
      state = stepNeedle(state, 0, 1 / 60);
    }
    assert.ok(Math.abs(state.angle) < 5);
  });

  it("picks warning colors by band", () => {
    assert.equal(colorForPercent(10), "#2f6f4e");
    assert.equal(colorForPercent(85), "#d97706");
    assert.equal(colorForPercent(99), "#c23b22");
  });

  it("resolves dual percents for Cursor vs other models", () => {
    const dual = dualPercents({
      percent: 42,
      autoPercentUsed: 30,
      apiPercentUsed: 55,
    });
    assert.equal(dual.cursorPercent, 30);
    assert.equal(dual.otherPercent, 55);
    const face = faceFromReading({
      percent: 42,
      autoPercentUsed: 30,
      apiPercentUsed: 55,
      membershipType: "pro",
      email: "a@b.c",
      isUnlimited: false,
    });
    assert.equal(face.cursor.label, "30");
    assert.equal(face.other.label, "55");
    assert.equal(face.cursor.color, CURSOR_NEEDLE_COLOR);
    assert.equal(face.account, "a@b.c");
  });
});

