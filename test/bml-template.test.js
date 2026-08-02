"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatTicketBody,
  parseTicketBody,
  hasNumericKillCriteria,
  hasHypothesis,
  validateBacklogReady,
  experimentTitle,
} = require("../src/lib/bml/template");

describe("formatTicketBody / parseTicketBody", () => {
  it("round-trips the six sections", () => {
    const body = formatTicketBody({
      hypothesis: "Customers act on weekly insights.",
      build: "Ship insight events only.",
      measure: "≥60% open+click · kill <40% · 4 weeks",
      learn: "TBD",
      acceptanceCriteria: "- [ ] events fire",
      technicalContext: "@src/insights",
    });
    const parsed = parseTicketBody(body);
    assert.match(parsed.hypothesis, /Customers act/);
    assert.match(parsed.measure, /kill <40%/);
    assert.match(parsed.technicalContext, /@src\/insights/);
  });
});

describe("hasNumericKillCriteria", () => {
  it("accepts course-style measure lines", () => {
    assert.equal(hasNumericKillCriteria("≥60% weekly · kill <40% · 4 weeks"), true);
    assert.equal(hasNumericKillCriteria("kill threshold 50% after 14 days"), true);
  });
  it("rejects kill without numbers", () => {
    assert.equal(hasNumericKillCriteria("kill if no difference"), false);
    assert.equal(hasNumericKillCriteria("we will know"), false);
  });
});

describe("validateBacklogReady", () => {
  it("requires hypothesis, build, and numeric kill", () => {
    const bad = validateBacklogReady({});
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.length >= 2);

    const good = validateBacklogReady({
      hypothesis: "Customers act on OMI weekly insights.",
      build: "Confirm weekly delivery + events.",
      measure: "≥60% open+click · kill <40% · 4 weeks",
    });
    assert.equal(good.ok, true);
  });
});

describe("experimentTitle", () => {
  it("prefixes BML", () => {
    assert.equal(
      experimentTitle({ hypothesis: "Customers keep paying after 60 days." }).startsWith(
        "BML:"
      ),
      true
    );
  });
  it("detects placeholder hypothesis", () => {
    assert.equal(hasHypothesis("What do we believe will happen?"), false);
  });
});
