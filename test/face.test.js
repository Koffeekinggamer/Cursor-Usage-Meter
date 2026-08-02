"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildFace, faceFromReading, faceFrame } = require("../src/lib/face");
const { CURSOR_NEEDLE_COLOR } = require("../src/lib/gauge");
const { LEGEND } = require("../src/lib/face-copy");

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

describe("faceFromReading", () => {
  it("builds dual needle targets without alias fields", () => {
    const face = faceFromReading(reading);
    assert.equal(face.cursor.label, "30");
    assert.equal(face.other.label, "55");
    assert.equal(face.cursor.color, CURSOR_NEEDLE_COLOR);
    assert.equal(face.legend.cursor, LEGEND.cursor);
    assert.equal(face.plan, "pro");
    assert.equal(face.cursor.targetAngle, -120 + (240 * 30) / 100);
    assert.equal(face.other.targetAngle, -120 + (240 * 55) / 100);
    assert.equal(face.label, undefined);
    assert.equal(face.subtitle, undefined);
    assert.equal(face.targetAngle, undefined);
  });
});

describe("buildFace", () => {
  it("keeps last-good Reading with held plan copy", () => {
    const face = buildFace({
      reading,
      fault: { kind: "http", message: "boom" },
      showingLastGood: true,
    });
    assert.equal(face.cursor.label, "30");
    assert.equal(face.plan, "pro · held");
    assert.equal(face.hasFault, true);
    assert.equal(face.showingLastGood, true);
  });

  it("cold Fault uses face-copy plan line", () => {
    const face = buildFace({
      reading: null,
      fault: { kind: "unsigned-in", message: "x" },
      showingLastGood: false,
    });
    assert.equal(face.cursor.label, "!");
    assert.equal(face.plan, "Sign in");
    assert.equal(face.legendText, "");
  });
});

describe("faceFrame", () => {
  it("maps Face + angles for paint", () => {
    const face = faceFromReading(reading);
    face.hasFault = false;
    const frame = faceFrame(face, { cursor: -40, other: 10 });
    assert.equal(frame.cursorAngle, -40);
    assert.equal(frame.otherAngle, 10);
    assert.equal(frame.cursorColor, CURSOR_NEEDLE_COLOR);
    assert.equal(frame.otherArcColor, face.other.arcColor);
  });
});
