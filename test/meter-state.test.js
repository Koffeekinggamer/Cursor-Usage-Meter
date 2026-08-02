"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("../src/lib/meter-state");
const { CURSOR_NEEDLE_COLOR } = require("../src/lib/gauge");

const reading = {
  percent: 42,
  used: 42,
  limit: 100,
  remaining: 58,
  autoPercentUsed: 30,
  apiPercentUsed: 55,
  onDemandUsed: null,
  membershipType: "pro",
  isUnlimited: false,
  billingCycleStart: null,
  billingCycleEnd: null,
  displayMessage: null,
  email: "a@b.c",
};

describe("reduceMeterState", () => {
  it("stores a successful Reading", () => {
    const next = reduceMeterState(emptyMeterState(), {
      ok: true,
      reading,
    });
    assert.equal(next.reading.percent, 42);
    assert.equal(next.fault, null);
    assert.equal(next.showingLastGood, false);
  });

  it("keeps last-good reading on fault", () => {
    const good = reduceMeterState(emptyMeterState(), { ok: true, reading });
    const held = reduceMeterState(good, {
      ok: false,
      fault: { kind: "http", message: "usage-summary failed (500)" },
    });
    assert.equal(held.reading.percent, 42);
    assert.equal(held.showingLastGood, true);
    assert.equal(held.fault.kind, "http");
  });

  it("shows fault with no reading when nothing is held", () => {
    const next = reduceMeterState(emptyMeterState(), {
      ok: false,
      fault: { kind: "unsigned-in", message: "sign in" },
    });
    assert.equal(next.reading, null);
    assert.equal(next.showingLastGood, false);
    assert.equal(next.fault.kind, "unsigned-in");
  });

  it("buildFaceView exposes Face DTO without snap-to-zero", () => {
    const good = reduceMeterState(emptyMeterState(), { ok: true, reading });
    const held = reduceMeterState(good, {
      ok: false,
      fault: { kind: "http", message: "boom" },
    });
    const face = buildFaceView(held);
    assert.equal(face.cursor.label, "30");
    assert.equal(face.other.label, "55");
    assert.match(face.plan, /held/);
    assert.equal(face.hasFault, true);
    assert.notEqual(face.cursor.targetAngle, -120);
  });
});

describe("buildFaceView", () => {
  it("maps dual needles from auto and api percents", () => {
    const face = buildFaceView({
      reading,
      fault: null,
      showingLastGood: false,
    });
    assert.equal(face.cursor.label, "30");
    assert.equal(face.other.label, "55");
    assert.equal(face.legend.cursor, "Auto");
    assert.equal(face.plan, "pro");
    assert.equal(face.cursor.color, CURSOR_NEEDLE_COLOR);
    assert.equal(face.cursor.targetAngle, -120 + (240 * 30) / 100);
    assert.equal(face.other.targetAngle, -120 + (240 * 55) / 100);
  });

  it("renders cold fault without a reading", () => {
    const face = buildFaceView({
      reading: null,
      fault: { kind: "unsigned-in", message: "x" },
      showingLastGood: false,
    });
    assert.equal(face.cursor.label, "!");
    assert.equal(face.plan, "Sign in");
    assert.equal(face.cursor.targetAngle, -120);
    assert.equal(face.other.targetAngle, -120);
  });
});
