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
  writePidFile,
  clearPidFile,
} = require("./lib/pidfile");

const POLL_MS = Number(process.env.TUM_POLL_MS) || 60_000;
const pidFile = defaultPidPath(path.join(__dirname, ".."));
let mainWindow = null;
let pollTimer = null;
/** @type {import('./lib/meter-state').MeterState} */
let meterState = emptyMeterState();

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: sw } = display.workAreaSize;
  const size = 200;

  mainWindow = new BrowserWindow({
    width: size,
    height: size,
    x: sw - size - 24,
    y: display.workArea.y + 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // preload requires lib modules (gauge, face); paint runs in renderer
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.showInactive();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function publishFace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const face = buildFaceView(meterState);
  mainWindow.webContents.send("meter:face", face);
}

async function refreshUsage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const event = await takeReading();
  meterState = reduceMeterState(meterState, event);
  publishFace();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshUsage();
  pollTimer = setInterval(refreshUsage, POLL_MS);
}

app.whenReady().then(() => {
  writePidFile(pidFile, process.pid);
  createWindow();
  startPolling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startPolling();
    }
  });
});

app.on("will-quit", () => {
  clearPidFile(pidFile);
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("usage:refresh", async () => {
  await refreshUsage();
});

ipcMain.on("window:drag", (_event, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
});
