"use strict";

const canvas = document.getElementById("gauge");
const ctx = canvas.getContext("2d");
const cursorPctEl = document.getElementById("cursorPct");
const otherPctEl = document.getElementById("otherPct");
const planEl = document.getElementById("plan");
const legendEl = document.getElementById("legend");
const legendCursorEl = document.getElementById("legendCursor");
const legendOtherEl = document.getElementById("legendOther");
const shellEl = document.getElementById("shell");

let face = null;
let cursorNeedle = { angle: -120, velocity: 0 };
let otherNeedle = { angle: -120, velocity: 0 };
let lastTs = performance.now();

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (!window.tokenMeter?.stepNeedle || !window.tokenMeter?.faceFrame) {
    requestAnimationFrame(frame);
    return;
  }

  const draw = globalThis.MeterPaint?.drawMeterFace;
  if (face && draw) {
    cursorNeedle = window.tokenMeter.stepNeedle(
      cursorNeedle,
      face.cursor.targetAngle,
      dt
    );
    otherNeedle = window.tokenMeter.stepNeedle(
      otherNeedle,
      face.other.targetAngle,
      dt
    );
    const paintFrame = window.tokenMeter.faceFrame(face, {
      cursor: cursorNeedle.angle,
      other: otherNeedle.angle,
    });
    draw(ctx, paintFrame, {
      width: canvas.width,
      height: canvas.height,
    });
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
requestAnimationFrame(frame);
