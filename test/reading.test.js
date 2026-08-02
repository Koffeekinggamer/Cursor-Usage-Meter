"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classifyFault, takeReading } = require("../src/lib/reading");

describe("classifyFault", () => {
  it("maps missing db / unsigned-in / http", () => {
    assert.equal(
      classifyFault(new Error("Cursor state database not found at /x")).kind,
      "missing-db"
    );
    assert.equal(
      classifyFault(new Error("No cursorAuth/accessToken — sign in to Cursor first"))
        .kind,
      "unsigned-in"
    );
    assert.equal(
      classifyFault(new Error("usage-summary failed (401): nope")).kind,
      "http"
    );
  });
});

describe("takeReading", () => {
  it("returns a Reading from account + usage adapters", async () => {
    const result = await takeReading({
      readAccount: async () => ({
        email: "a@b.c",
        membershipType: "pro",
        sessionCookie: "cookie",
      }),
      fetchUsage: async () => ({
        percent: 42,
        used: 42,
        limit: 100,
        remaining: 58,
        autoPercentUsed: 10,
        apiPercentUsed: 20,
        onDemandUsed: null,
        membershipType: null,
        isUnlimited: false,
        billingCycleStart: "s",
        billingCycleEnd: "e",
        displayMessage: null,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reading.percent, 42);
    assert.equal(result.reading.email, "a@b.c");
    assert.equal(result.reading.membershipType, "pro");
  });

  it("returns a Fault instead of throwing", async () => {
    const result = await takeReading({
      readAccount: async () => {
        throw new Error("Cursor state database not found at /missing");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.fault.kind, "missing-db");
  });
});
