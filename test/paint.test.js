"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { drawMeterFace, OUTER_R, INNER_R } = require("../src/lib/paint");

function mockCtx() {
  const calls = [];
  const handler = {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "createRadialGradient") {
        return () => ({
          addColorStop: (...args) => calls.push(["addColorStop", args]),
        });
      }
      return (...args) => {
        calls.push([prop, args]);
      };
    },
    set(_t, prop, value) {
      calls.push(["set", prop, value]);
      return true;
    },
  };
  return new Proxy({}, handler);
}

describe("drawMeterFace", () => {
  it("paints outer then inner tracks and two needles", () => {
    const ctx = mockCtx();
    drawMeterFace(ctx, {
      cursorAngle: -48,
      otherAngle: 12,
      cursorColor: "#2563eb",
      otherColor: "#1c1917",
      otherArcColor: "#2f6f4e",
      cursorArcColor: "#2563eb",
      hasFault: false,
    });

    const arcs = ctx.calls.filter((c) => c[0] === "arc");
    assert.ok(arcs.length >= 4);
    // Track radii appear in arc calls: plate, outer track, outer fill, inner track, inner fill…
    const radii = arcs.map((c) => c[1][2]);
    assert.ok(radii.includes(OUTER_R));
    assert.ok(radii.includes(INNER_R));

    const fills = ctx.calls.filter((c) => c[0] === "fill");
    assert.ok(fills.length >= 2);
  });

  it("draws fault marker when hasFault", () => {
    const ctx = mockCtx();
    drawMeterFace(ctx, {
      cursorAngle: -120,
      otherAngle: -120,
      cursorColor: "#c23b22",
      otherColor: "#1c1917",
      otherArcColor: "#c23b22",
      hasFault: true,
    });
    const sets = ctx.calls.filter((c) => c[0] === "set" && c[1] === "fillStyle");
    assert.ok(sets.some((c) => c[2] === "#c23b22"));
  });
});
