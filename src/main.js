"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const { takeReading } = require("./lib/reading");
const {
  emptyMeterState,
  reduceMeterState,
  buildFaceView,
} = require("./lib/meter-state");
const {
  defaultPidPath,
  clearPidFile,
  claimMeterSingleton,
} = require("./lib/pidfile");
const { nextDragPosition } = require("./lib/drag-position");
const { createBmlCoach } = require("./lib/bml/coach");

const POLL_MS = Number(process.env.CUM_POLL_MS) || 60_000;
const OVERLAY_ASSERT_MS = Number(process.env.CUM_OVERLAY_MS) || 5_000;
/** How often BML re-checks the active Cursor workspace (usage poll stays separate). */
const BML_PROJECT_MS = Number(process.env.CUM_BML_PROJECT_MS) || 2_500;
const ROOT = path.join(__dirname, "..");
const pidFile = defaultPidPath(ROOT);
const COLLAPSED = { width: 200, height: 200 };
/** Dial (200) + BML panel (~360) + padding */
const EXPANDED = { width: 600, height: 580 };

const gotSingletonLock = app.requestSingleInstanceLock();
if (!gotSingletonLock) {
  app.quit();
}

let mainWindow = null;
let pollTimer = null;
let overlayTimer = null;
let bmlProjectTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();
let bmlCoach = null;

function defaultBounds(size = COLLAPSED) {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  const envX = Number(process.env.CUM_X);
  const envY = Number(process.env.CUM_Y);
  return {
    width: size.width,
    height: size.height,
    x: Number.isFinite(envX) ? envX : x + width - size.width - 24,
    y: Number.isFinite(envY) ? envY : y + 24,
  };
}

function applyPanelLayout(panelOpen, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const size = panelOpen ? EXPANDED : COLLAPSED;
  const [x, y] = mainWindow.getPosition();
  const [prevW] = mainWindow.getSize();
  mainWindow.setBounds({
    x: Math.round(x + prevW - size.width),
    y: Math.round(y),
    width: size.width,
    height: size.height,
  });
  // Do not steal focus after inject — Cursor Agent needs to keep the keyboard.
  const wantFocus = panelOpen && opts.focus === true;
  try {
    mainWindow.setFocusable(true);
    if (wantFocus) {
      mainWindow.focus();
      mainWindow.webContents.focus();
    } else if (!panelOpen) {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || bmlCoach?.getState()?.panelOpen) return;
        try { mainWindow.setFocusable(false); } catch {}
      }, 150);
    }
  } catch {}
  assertOverlay(mainWindow);
}

function assertOverlay(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.moveTop === "function") win.moveTop();
  } catch {
    try {
      win.setAlwaysOnTop(true);
    } catch {
      // ignore
    }
  }
}

function currentFace() {
  return buildFaceView(meterState);
}

function publishFace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("meter:face", currentFace());
}

function publishBml(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("bml:state", view);
}

function createWindow() {
  const bounds = defaultBounds(COLLAPSED);

  /** @type {Electron.BrowserWindowConstructorOptions} */
  const opts = {
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: false,
    acceptFirstMouse: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  };

  if (process.platform === "darwin") {
    opts.type = "panel";
  }

  mainWindow = new BrowserWindow(opts);
  assertOverlay(mainWindow);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    publishFace();
    if (bmlCoach) publishBml(bmlCoach.getView());
    refreshUsage();
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    assertOverlay(mainWindow);
    publishFace();
    setTimeout(() => assertOverlay(mainWindow), 250);
    setTimeout(() => assertOverlay(mainWindow), 1000);
    if (bmlCoach) {
      const view = bmlCoach.getView();
      if (view.panelOpen) applyPanelLayout(true);
      publishBml(view);
    }
  });

  mainWindow.on("blur", () => assertOverlay(mainWindow));
  mainWindow.on("show", () => assertOverlay(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerBmlIpc() {
  ipcMain.handle("bml:getState", async () => bmlCoach?.getView() || null);
  ipcMain.handle("bml:setPanelOpen", async (_e, open) => {
    if (open) applyPanelLayout(true, { focus: false });
    const view = await bmlCoach.setPanelOpen(Boolean(open), {
      autoProcess: true,
      onProgress: publishBml,
    });
    applyPanelLayout(view.panelOpen, { focus: false });
    publishBml(view);
    return view;
  });
  ipcMain.handle("bml:togglePanel", async () => {
    const opening = !bmlCoach?.getState()?.panelOpen;
    if (opening) applyPanelLayout(true, { focus: false });
    const view = await bmlCoach.togglePanel({
      autoProcess: true,
      onProgress: publishBml,
    });
    applyPanelLayout(view.panelOpen, { focus: false });
    publishBml(view);
    return view;
  });
  for (const [channel, method] of [
    ["bml:setFields", "setFields"], ["bml:applyProjectToFields", "applyProjectToFields"],
    ["bml:selectExperiment", "selectExperiment"], ["bml:setBuildFlags", "setBuildFlags"],
    ["bml:setMeasureFlags", "setMeasureFlags"], ["bml:setStep", "setStep"],
  ]) {
    ipcMain.handle(channel, async (_e, arg) => {
      const view = await bmlCoach[method](arg || {});
      publishBml(view); return view;
    });
  }
  ipcMain.handle("bml:refreshBoard", async () => { const v = await bmlCoach.refreshBoard(); publishBml(v); return v; });
  ipcMain.handle("bml:advanceStage", async (_e, payload) => {
    const v = await bmlCoach.advanceStage({ fields: payload?.fields || null, skipChain: Boolean(payload?.skipChain), onProgress: publishBml });
    publishBml(v); return v;
  });
  ipcMain.handle("bml:runSkillStep", async () => { const v = await bmlCoach.runAllSkillSteps({ onProgress: publishBml }); publishBml(v); return v; });
  ipcMain.handle("bml:runOneSkillStep", async (_e, index) => { const v = await bmlCoach.runSkillStep(index, { trackCost: true, onProgress: publishBml, continueChain: false }); publishBml(v); return v; });
  ipcMain.handle("bml:confirmInjectedStep", async (_e, payload) => {
    const v = await bmlCoach.confirmInjectedStep({
      continueChain: payload?.continueChain !== false,
      onProgress: publishBml,
    });
    publishBml(v);
    return v;
  });
  ipcMain.handle("bml:cancel", async () => { const v = bmlCoach.cancelRun(); publishBml(v); return v; });
  ipcMain.handle("bml:nextSkillStep", async () => { const v = bmlCoach.nextSkillStep(); publishBml(v); return v; });
  ipcMain.handle("bml:skipOptionalStep", async () => { const v = bmlCoach.skipOptionalStep(); publishBml(v); return v; });
  ipcMain.handle("bml:setTinyBuild", async () => { const v = bmlCoach.setTinyBuild(); publishBml(v); return v; });
  ipcMain.handle("bml:postMeasure", async (_e, note) => { const v = await bmlCoach.postMeasure(note || {}); publishBml(v); return v; });
  ipcMain.handle("bml:recordLearn", async (_e, payload) => { const v = await bmlCoach.recordLearn(payload?.decision, payload?.evidence); publishBml(v); return v; });
  ipcMain.handle("bml:openUrl", async (_e, url) => {
    if (!/^https?:\/\//i.test(String(url || ""))) return false;
    await shell.openExternal(url); return true;
  });
}

async function refreshUsage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const event = await takeReading();
  meterState = reduceMeterState(meterState, event);
  publishFace();
  assertOverlay(mainWindow);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshUsage();
  pollTimer = setInterval(refreshUsage, POLL_MS);
}

function startOverlayAssert() {
  if (overlayTimer) clearInterval(overlayTimer);
  overlayTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      assertOverlay(mainWindow);
    }
  }, OVERLAY_ASSERT_MS);
}

/**
 * Watch Cursor workspace switches for BML only.
 * Does not touch usage/token polling — Meter keep counting as usual.
 */
function startBmlProjectWatch() {
  if (bmlProjectTimer) clearInterval(bmlProjectTimer);
  bmlProjectTimer = setInterval(async () => {
    if (!bmlCoach || !mainWindow || mainWindow.isDestroyed()) return;
    try {
      const before = bmlCoach.getView()?.boundCwd || null;
      const { changed } = bmlCoach.syncActiveProject();
      if (!changed) return;
      const after = bmlCoach.getView();
      publishBml(after);
      // If BML panel is open, auto-process the new project instance.
      if (after.panelOpen) {
        const view = await bmlCoach.runAllSkillSteps({ onProgress: publishBml });
        publishBml(view);
      } else if (before && after.boundCwd && before !== after.boundCwd) {
        // Panel closed: still rebind quietly so next activate uses the new app.
        publishBml(bmlCoach.getView());
      }
    } catch {
      // never interrupt the Meter overlay
    }
  }, BML_PROJECT_MS);
}

app.whenReady().then(() => {
  if (!gotSingletonLock) return;

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  bmlCoach = createBmlCoach({ appData: app.getPath("userData") });
  bmlCoach.syncActiveProject({ force: true });
  claimMeterSingleton(ROOT, process.pid);
  registerBmlIpc();
  createWindow();
  startPolling();
  startOverlayAssert();
  startBmlProjectWatch();

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      startPolling();
      startOverlayAssert();
      return;
    }
    mainWindow.show();
    assertOverlay(mainWindow);
  });

  screen.on("display-metrics-changed", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (process.env.CUM_X || process.env.CUM_Y) return;
    mainWindow.setBounds(defaultBounds(bmlCoach?.getState()?.panelOpen ? EXPANDED : COLLAPSED));
    assertOverlay(mainWindow);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startPolling();
      startOverlayAssert();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      assertOverlay(mainWindow);
    }
  });
});

app.on("will-quit", () => {
  clearPidFile(pidFile);
  if (overlayTimer) clearInterval(overlayTimer);
  if (bmlProjectTimer) clearInterval(bmlProjectTimer);
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (overlayTimer) clearInterval(overlayTimer);
  if (bmlProjectTimer) clearInterval(bmlProjectTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshUsage();
  return currentFace();
});

ipcMain.handle("meter:getFace", async () => currentFace());

ipcMain.on("window:drag", (_event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const [x, y] = mainWindow.getPosition();
    const next = nextDragPosition(x, y, payload?.dx, payload?.dy);
    if (!next) return;
    mainWindow.setPosition(next.x, next.y);
    assertOverlay(mainWindow);
  } catch {
    // Never let a bad drag / native conversion kill the main process.
  }
});
