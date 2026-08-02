"use strict";

const canvas = document.getElementById("gauge");
const cursorPctEl = document.getElementById("cursorPct");
const otherPctEl = document.getElementById("otherPct");
const planEl = document.getElementById("plan");
const legendEl = document.getElementById("legend");
const legendCursorEl = document.getElementById("legendCursor");
const legendOtherEl = document.getElementById("legendOther");
const shellEl = document.getElementById("shell");

const DIAL = 200;

/** Idle face so the dial paints immediately (never a transparent hole). */
const IDLE_FACE = {
  cursor: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#2563eb",
    arcColor: "#2563eb",
  },
  other: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#1c1917",
    arcColor: "#2f6f4e",
  },
  plan: "",
  legend: { cursor: "Auto", other: "API" },
  legendText: "Auto · API",
  titleHint: "Cursor Usage Meter",
  showingLastGood: false,
  hasFault: false,
  account: "",
};

let face = IDLE_FACE;
let cursorNeedle = { angle: -120, velocity: 0 };
let otherNeedle = { angle: -120, velocity: 0 };
let lastTs = performance.now();
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

function setupCanvas() {
  if (!canvas) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(DIAL * dpr);
  canvas.height = Math.round(DIAL * dpr);
  canvas.style.width = `${DIAL}px`;
  canvas.style.height = `${DIAL}px`;
  const c = canvas.getContext("2d", { alpha: true });
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

ctx = setupCanvas();

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (!ctx) ctx = setupCanvas();
  const draw = globalThis.MeterPaint?.drawMeterFace;
  const active = face || IDLE_FACE;

  if (
    draw &&
    canvas &&
    ctx &&
    window.tokenMeter?.stepNeedle &&
    window.tokenMeter?.faceFrame
  ) {
    cursorNeedle = window.tokenMeter.stepNeedle(
      cursorNeedle,
      active.cursor.targetAngle,
      dt
    );
    otherNeedle = window.tokenMeter.stepNeedle(
      otherNeedle,
      active.other.targetAngle,
      dt
    );
    const paintFrame = window.tokenMeter.faceFrame(active, {
      cursor: cursorNeedle.angle,
      other: otherNeedle.angle,
    });
    try {
      draw(ctx, paintFrame, { width: DIAL, height: DIAL });
    } catch (err) {
      console.error("Meter paint failed", err);
    }
  }

  requestAnimationFrame(frame);
}

function applyFace(payload) {
  if (!payload?.cursor || !payload?.other) return;
  face = payload;

  if (payload.hasFault && !payload.showingLastGood) {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = true;
    planEl.textContent = payload.plan || "";
  } else {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = false;
    if (legendCursorEl) legendCursorEl.textContent = payload.legend.cursor;
    if (legendOtherEl) legendOtherEl.textContent = payload.legend.other;
    planEl.textContent = payload.plan || "";
  }

  if (shellEl && payload.titleHint) {
    shellEl.title = payload.titleHint;
  }
}

let dragging = false;
let lastX = 0;
let lastY = 0;

window.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.screenX;
  lastY = e.screenY;
  e.target.setPointerCapture?.(e.pointerId);
});

window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  window.tokenMeter?.dragBy(dx, dy);
});

window.addEventListener("pointerup", () => {
  dragging = false;
});

window.addEventListener("dblclick", () => {
  window.tokenMeter?.refresh();
});

window.tokenMeter?.onFaceUpdate?.(applyFace);
window.tokenMeter?.getFace?.().then((payload) => {
  if (payload) applyFace(payload);
});
requestAnimationFrame(frame);
