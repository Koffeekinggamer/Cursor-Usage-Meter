"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isIdleLabel,
  evaluateFaceDiag,
  syntheticVerifyReading,
} = require("../src/lib/selftest-checks");

describe("isIdleLabel", () => {
  it("treats em-dash and empty as idle", () => {
    assert.equal(isIdleLabel("—"), true);
    assert.equal(isIdleLabel("-"), true);
    assert.equal(isIdleLabel(""), true);
    assert.equal(isIdleLabel(null), true);
  });

  it("treats numeric Auto/API labels as live", () => {
    assert.equal(isIdleLabel("30"), false);
    assert.equal(isIdleLabel("0"), false);
    assert.equal(isIdleLabel("∞"), false);
  });
});

describe("evaluateFaceDiag", () => {
  it("fails closed on idle labels and unpainted cream", () => {
    const r = evaluateFaceDiag({
      hasTokenMeter: true,
      hasMeterPaint: true,
      cursorText: "—",
      otherText: "—",
      canvasW: 200,
      canvasH: 200,
      nonCream: 0,
      total: 100,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => /idle/i.test(f)));
    assert.ok(r.failures.some((f) => /unpainted/i.test(f)));
  });

  it("fails if either needle label is still idle", () => {
    const r = evaluateFaceDiag({
      hasTokenMeter: true,
      hasMeterPaint: true,
      cursorText: "30",
      otherText: "—",
      canvasW: 200,
      canvasH: 200,
      nonCream: 12,
      total: 100,
    });
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => /idle/i.test(f)));
  });

  it("passes for numeric labels and painted dial", () => {
    const r = evaluateFaceDiag({
      hasTokenMeter: true,
      hasMeterPaint: true,
      cursorText: "30",
      otherText: "55",
      canvasW: 200,
      canvasH: 200,
      nonCream: 12,
      total: 100,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.failures, []);
  });
});

describe("syntheticVerifyReading", () => {
  it("provides dual Cursor Auto + API percents", () => {
    const reading = syntheticVerifyReading();
    assert.equal(reading.autoPercentUsed, 30);
    assert.equal(reading.apiPercentUsed, 55);
    assert.equal(reading.isUnlimited, false);
  });
});
