"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getStateDbPath } = require("./paths");

/**
 * Decode a JWT payload without verifying the signature.
 * @param {string} token
 * @returns {Record<string, unknown>}
 */
function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT: missing payload segment");
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

/**
 * Build the WorkosCursorSessionToken cookie value from JWT sub + access token.
 * @param {string} accessToken
 * @param {string} [sub]
 */
function buildSessionCookie(accessToken, sub) {
  const subject = sub || decodeJwtPayload(accessToken).sub;
  if (!subject || typeof subject !== "string") {
    throw new Error("JWT is missing a sub claim");
  }
  // Dashboard cookie: "<sub>%3A%3A<jwt>" (same shape Cursor's web app uses).
  return `${subject}%3A%3A${accessToken}`;
}

/**
 * Open state.vscdb via a temp copy so Cursor's WAL lock does not block reads.
 * @param {string} dbPath
 * @returns {Promise<import("sql.js").Database>}
 */
async function openStateDbCopy(dbPath) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", file),
  });
  const tmp = path.join(
    os.tmpdir(),
    `token-usage-meter-${process.pid}-${Date.now()}.vscdb`
  );
  fs.copyFileSync(dbPath, tmp);
  try {
    const fileBuffer = fs.readFileSync(tmp);
    return new SQL.Database(fileBuffer);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup races
    }
  }
}

/**
 * Read Cursor account auth material from state.vscdb.
 * @param {{ dbPath?: string }} [opts]
 */
async function readCursorAccount(opts = {}) {
  const dbPath = opts.dbPath || getStateDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Cursor state database not found at ${dbPath}`);
  }

  const db = await openStateDbCopy(dbPath);
  try {
    const getValue = (key) => {
      const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
      stmt.bind([key]);
      if (!stmt.step()) {
        stmt.free();
        return null;
      }
      const row = stmt.getAsObject();
      stmt.free();
      return row.value == null ? null : String(row.value);
    };

    const accessToken = getValue("cursorAuth/accessToken");
    if (!accessToken) {
      throw new Error("No cursorAuth/accessToken in state.vscdb — sign in to Cursor first");
    }

    const claims = decodeJwtPayload(accessToken);
    const email = getValue("cursorAuth/cachedEmail");
    const membershipType = getValue("cursorAuth/stripeMembershipType");

    return {
      accessToken,
      email,
      membershipType,
      sub: typeof claims.sub === "string" ? claims.sub : null,
      sessionCookie: buildSessionCookie(
        accessToken,
        typeof claims.sub === "string" ? claims.sub : undefined
      ),
    };
  } finally {
    db.close();
  }
}

module.exports = {
  decodeJwtPayload,
  buildSessionCookie,
  readCursorAccount,
};
