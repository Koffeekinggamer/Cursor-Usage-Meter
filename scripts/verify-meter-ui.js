"use strict";

/**
 * Headless-ish UI proof for the Cursor Meter overlay.
 * Run: npm run verify-meter-ui
 *   or: env -u ELECTRON_RUN_AS_NODE electron scripts/verify-meter-ui.js
 *
 * Passes only when:
 *  - no renderer console errors
 *  - MeterPaint + tokenMeter present
 *  - Face labels are numeric (not idle em-dash)
 *  - canvas has non-cream painted pixels (dial tracks/needles)
 *  - screenshot written under tmp/
 *
 * Cursor-only — uses takeReading / syntheticVerifyReading; never Grok auth.
 */

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "tmp");
const SHOT = path.join(OUT_DIR, "meter-verify.png");

const { takeReading } = require("../src/lib/reading");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("../src/lib/meter-state");
const {
  evaluateFaceDiag,
  syntheticVerifyReading,
} = require("../src/lib/selftest-checks");

/** @type {string[]} */
const consoleLines = [];
let mainWindow = null;
let meterState = emptyMeterState();

function fail(msg) {
  console.error("VERIFY FAIL:", msg);
  console.error("--- renderer console ---");
  console.error(consoleLines.join("\n") || "(empty)");
  app.exit(1);
}

function ok(msg) {
  console.log("VERIFY OK:", msg);
}

const DIAG_JS = `
(() => {
  const canvas = document.getElementById("gauge");
  const ctx = canvas && canvas.getContext("2d");
  let sample = null;
  let nonCream = 0;
  let total = 0;
  if (ctx && canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
      for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        total++;
        const isCream =
          a > 200 && r > 175 && g > 165 && b > 145 && Math.abs(r - g) < 40;
        const isTransparent = a < 10;
        if (!isCream && !isTransparent && a > 100) nonCream++;
      }
    }
    const ci = (Math.floor(h/2) * w + Math.floor(w/2)) * 4;
    sample = { r: d[ci], g: d[ci+1], b: d[ci+2], a: d[ci+3], w, h };
  }
  return {
    hasTokenMeter: typeof window.tokenMeter === "object" && window.tokenMeter !== null,
    hasMeterPaint: typeof globalThis.MeterPaint?.drawMeterFace === "function",
    cursorText: document.getElementById("cursorPct")?.textContent || null,
    otherText: document.getElementById("otherPct")?.textContent || null,
    planText: document.getElementById("plan")?.textContent || null,
    canvasW: canvas?.width || 0,
    canvasH: canvas?.height || 0,
    sample,
    nonCream,
    total,
  };
})()
`;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  ipcMain.handle("meter:getFace", async () => buildFaceView(meterState));
  ipcMain.handle("usage:refresh", async () => {
    const event = await takeReading();
    meterState = reduceMeterState(meterState, event);
    const face = buildFaceView(meterState);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("meter:face", face);
    }
    return face;
  });
  for (const ch of [
    "bml:getState",
    "bml:setPanelOpen",
    "bml:togglePanel",
    "bml:setFields",
    "bml:applyProjectToFields",
    "bml:createExperiment",
    "bml:selectExperiment",
    "bml:refreshBoard",
    "bml:advanceStage",
    "bml:runSkillStep",
    "bml:runOneSkillStep",
    "bml:confirmInjectedStep",
    "bml:cancel",
    "bml:nextSkillStep",
    "bml:skipOptionalStep",
    "bml:setTinyBuild",
    "bml:setBuildFlags",
    "bml:setMeasureFlags",
    "bml:postMeasure",
    "bml:recordLearn",
    "bml:setStep",
    "bml:openUrl",
  ]) {
    ipcMain.handle(ch, async () => null);
  }
  ipcMain.on("window:drag", () => {});

  mainWindow = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: true,
    webPreferences: {
      preload: path.join(ROOT, "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      const row = `[${level}] ${message} (${sourceId}:${line})`;
      consoleLines.push(row);
      console.log("RENDERER:", row);
    }
  );

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    fail(`did-fail-load ${code} ${desc}`);
  });

  await mainWindow.loadFile(path.join(ROOT, "src", "renderer", "index.html"));

  try {
    const event = await takeReading();
    if (!event.ok) {
      throw new Error(event.fault?.message || "Reading fault");
    }
    meterState = reduceMeterState(meterState, event);
  } catch (err) {
    console.warn("live Reading failed, using synthetic Cursor Reading", err);
    meterState = reduceMeterState(meterState, {
      ok: true,
      reading: syntheticVerifyReading(),
    });
  }

  const face = buildFaceView(meterState);
  mainWindow.webContents.send("meter:face", face);
  await new Promise((r) => setTimeout(r, 1500));

  let diag = await mainWindow.webContents.executeJavaScript(DIAG_JS);
  console.log("DIAG:", JSON.stringify(diag, null, 2));

  const img = await mainWindow.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  ok(`screenshot ${SHOT} (${img.getSize().width}x${img.getSize().height})`);

  const errors = consoleLines.filter((l) =>
    /SyntaxError|Uncaught|TypeError|ReferenceError/i.test(l)
  );
  if (errors.length) {
    fail("renderer console errors:\n" + errors.join("\n"));
  }

  let verdict = evaluateFaceDiag(diag);
  if (!verdict.ok && /idle/i.test(verdict.failures.join(" "))) {
    mainWindow.webContents.send("meter:face", face);
    await new Promise((r) => setTimeout(r, 500));
    diag = await mainWindow.webContents.executeJavaScript(DIAG_JS);
    verdict = evaluateFaceDiag(diag);
  }

  if (!verdict.ok) {
    fail(
      `${verdict.failures.join("; ")}; face was ${face.cursor?.label}/${face.other?.label}`
    );
  }

  ok(`labels ${diag.cursorText} · ${diag.otherText}`);
  ok(`canvas paint samples nonCream=${diag.nonCream}/${diag.total}`);
  ok("all checks passed");
  app.exit(0);
});

app.on("window-all-closed", (e) => e.preventDefault());
