"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  decodeJwtPayload,
  buildSessionCookie,
  readCursorAccount,
} = require("../src/lib/auth");

function makeJwt(payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("auth helpers", () => {
  it("decodes JWT payload", () => {
    const token = makeJwt({ sub: "user_abc", type: "session" });
    assert.equal(decodeJwtPayload(token).sub, "user_abc");
  });

  it("builds session cookie with %3A%3A separator", () => {
    const token = makeJwt({ sub: "user_abc" });
    assert.equal(buildSessionCookie(token), `user_abc%3A%3A${token}`);
  });
});

describe("readCursorAccount", () => {
  let dbPath;

  before(async () => {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs({
      locateFile: (file) =>
        path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
    });
    const db = new SQL.Database();
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    const token = makeJwt({ sub: "user_test_1", aud: "https://cursor.com" });
    db.run("INSERT INTO ItemTable VALUES (?, ?)", [
      "cursorAuth/accessToken",
      token,
    ]);
    db.run("INSERT INTO ItemTable VALUES (?, ?)", [
      "cursorAuth/cachedEmail",
      "judson@example.com",
    ]);
    db.run("INSERT INTO ItemTable VALUES (?, ?)", [
      "cursorAuth/stripeMembershipType",
      "pro",
    ]);
    const data = db.export();
    db.close();
    dbPath = path.join(os.tmpdir(), `tum-auth-test-${process.pid}.vscdb`);
    fs.writeFileSync(dbPath, Buffer.from(data));
  });

  it("reads account fields from a state.vscdb fixture", async () => {
    const account = await readCursorAccount({ dbPath });
    assert.equal(account.email, "judson@example.com");
    assert.equal(account.membershipType, "pro");
    assert.equal(account.sub, "user_test_1");
    assert.match(account.sessionCookie, /^user_test_1%3A%3A/);
  });
});
