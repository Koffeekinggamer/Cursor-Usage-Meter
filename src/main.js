"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
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

const POLL_MS = Number(process.env.CUM_POLL_MS) || 60_000;
const OVERLAY_ASSERT_MS = Number(process.env.CUM_OVERLAY_MS) || 5_000;
const ROOT = path.join(__dirname, "..");
const pidFile = defaultPidPath(ROOT);
const SIZE = 200;

const gotSingletonLock = app.requestSingleInstanceLock();
if (!gotSingletonLock) {
  app.quit();
}

let mainWindow = null;
let pollTimer = null;
let overlayTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();

function defaultBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  const envX = Number(process.env.CUM_X);
  const envY = Number(process.env.CUM_Y);
  return {
    width: SIZE,
    height: SIZE,
    x: Number.isFinite(envX) ? envX : x + width - SIZE - 24,
    y: Number.isFinite(envY) ? envY : y + 24,
  };
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

function createWindow() {
  const bounds = defaultBounds();

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
    refreshUsage();
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    assertOverlay(mainWindow);
    publishFace();
    setTimeout(() => assertOverlay(mainWindow), 250);
    setTimeout(() => assertOverlay(mainWindow), 1000);
  });

  mainWindow.on("blur", () => assertOverlay(mainWindow));
  mainWindow.on("show", () => assertOverlay(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
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

app.whenReady().then(() => {
  if (!gotSingletonLock) return;

  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.hide();
    } catch {
      // ignore
    }
  }

  claimMeterSingleton(ROOT, process.pid);
  createWindow();
  startPolling();
  startOverlayAssert();

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
    mainWindow.setBounds(defaultBounds());
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
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (overlayTimer) clearInterval(overlayTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshUsage();
  return currentFace();
});

ipcMain.handle("meter:getFace", async () => currentFace());

ipcMain.on("window:drag", (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
  assertOverlay(mainWindow);
});
