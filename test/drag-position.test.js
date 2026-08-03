"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { nextDragPosition } = require("../src/lib/drag-position");

describe("nextDragPosition", () => {
  it("moves by finite deltas", () => {
    assert.deepEqual(nextDragPosition(100, 200, 3.6, -1.2), { x: 104, y: 199 });
  });

  it("accepts zero deltas", () => {
    assert.deepEqual(nextDragPosition(10, 20, 0, 0), { x: 10, y: 20 });
  });

  it("rejects undefined / NaN / non-numeric deltas that yield NaN", () => {
    assert.equal(nextDragPosition(100, 100, undefined, 1), null);
    assert.equal(nextDragPosition(100, 100, 1, undefined), null);
    assert.equal(nextDragPosition(100, 100, NaN, 1), null);
    assert.equal(nextDragPosition(100, 100, {}, 1), null);
    assert.equal(nextDragPosition(100, 100, 1, "nope"), null);
  });

  it("rejects non-finite current position", () => {
    assert.equal(nextDragPosition(NaN, 100, 1, 1), null);
    assert.equal(nextDragPosition(100, undefined, 1, 1), null);
  });

  it("coerces numeric strings (structured-clone edge)", () => {
    assert.deepEqual(nextDragPosition(10, 20, "4", "5"), { x: 14, y: 25 });
  });
});
