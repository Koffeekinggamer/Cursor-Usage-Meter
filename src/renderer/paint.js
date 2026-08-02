"use strict";

/**
 * Dual-needle Meter paint. Must run in the renderer — CanvasRenderingContext2D
 * cannot cross Electron's contextBridge.
 *
 * Wrapped in an IIFE so top-level consts never collide with renderer.js
 * (classic <script> tags share one global lexical scope).
 *
 * Geometry is centered in the canvas so the plate circumference is a true
 * circle matching the 200×200 shell (no vertical bias).
 */
(function initMeterPaint(global) {
  /** Logical dial size (CSS px). */
  const DIAL = 200;
  /** Full plate radius — leaves room for a 2px rim stroke inside the canvas. */
  const PLATE_R = 98;
  /** Outer usage track (context). */
  const OUTER_R = 80;
  /** Inner usage track (plan). */
  const INNER_R = 66;
  const START = (-120 * Math.PI) / 180 - Math.PI / 2;
  const END = (120 * Math.PI) / 180 - Math.PI / 2;

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx
   * @param {number} cy
   * @param {number} r
   * @param {number} angleDeg
   * @param {string} color
   * @param {number} width
   */
  function drawArc(ctx, cx, cy, r, angleDeg, color, width) {
    const needleRad = (angleDeg * Math.PI) / 180 - Math.PI / 2;
    const span = Math.max(needleRad, START + 0.001);
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, Math.min(span, END));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx
   * @param {number} cy
   * @param {number} angleDeg
   * @param {string} color
   * @param {number} tipR
   * @param {number} widthScale
   */
  function drawNeedle(ctx, cx, cy, angleDeg, color, tipR, widthScale) {
    const needleRad = (angleDeg * Math.PI) / 180 - Math.PI / 2;
    const backR = 12 * widthScale;
    const half = 3.2 * widthScale;
    const tipX = cx + Math.cos(needleRad) * tipR;
    const tipY = cy + Math.sin(needleRad) * tipR;
    const left = needleRad + Math.PI / 2;
    const right = needleRad - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(cx + Math.cos(left) * half, cy + Math.sin(left) * half);
    ctx.lineTo(
      cx + Math.cos(needleRad + Math.PI) * backR,
      cy + Math.sin(needleRad + Math.PI) * backR
    );
    ctx.lineTo(cx + Math.cos(right) * half, cy + Math.sin(right) * half);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{
   *   cursorAngle: number,
   *   otherAngle: number,
   *   cursorColor: string,
   *   otherColor: string,
   *   otherArcColor: string,
   *   cursorArcColor?: string,
   *   hasFault?: boolean,
   * }} frame
   * @param {{ width: number, height: number }} size
   */
  function drawMeterFace(ctx, frame, size = { width: DIAL, height: DIAL }) {
    const w = size.width;
    const h = size.height;
    // True center — circumference is a perfect circle in the shell.
    const cx = w / 2;
    const cy = h / 2;
    const plateR = Math.min(w, h) / 2 - 2;
    const outerR = plateR * (OUTER_R / PLATE_R);
    const innerR = plateR * (INNER_R / PLATE_R);

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    try {
      ctx.imageSmoothingEnabled = true;
    } catch {
      // ignore
    }

    // Opaque plate (critical for transparent Electron windows)
    const plate = ctx.createRadialGradient(
      cx - plateR * 0.18,
      cy - plateR * 0.22,
      plateR * 0.08,
      cx,
      cy,
      plateR
    );
    plate.addColorStop(0, "rgb(250, 247, 241)");
    plate.addColorStop(0.72, "rgb(232, 224, 210)");
    plate.addColorStop(1, "rgb(196, 181, 160)");

    ctx.beginPath();
    ctx.arc(cx, cy, plateR, 0, Math.PI * 2);
    ctx.fillStyle = plate;
    ctx.fill();

    // Single clean circumference (1.5px, centered on the rim)
    ctx.beginPath();
    ctx.arc(cx, cy, plateR - 0.75, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(68, 64, 60, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Outer track (context / on-demand)
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, START, END);
    ctx.strokeStyle = "rgba(68, 64, 60, 0.22)";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.stroke();
    drawArc(
      ctx,
      cx,
      cy,
      outerR,
      frame.otherAngle,
      frame.otherArcColor || "#2f6f4e",
      10
    );

    // Inner track (plan)
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, START, END);
    ctx.strokeStyle = "rgba(37, 99, 235, 0.22)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();
    drawArc(
      ctx,
      cx,
      cy,
      innerR,
      frame.cursorAngle,
      frame.cursorArcColor || frame.cursorColor || "#2563eb",
      8
    );

    // Tick marks on outer track
    for (let p = 0; p <= 100; p += 10) {
      const a = ((-120 + (240 * p) / 100) * Math.PI) / 180 - Math.PI / 2;
      const major = p % 50 === 0;
      const inner = outerR - (major ? 16 : 10);
      const outer = outerR + 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.strokeStyle = major
        ? "rgba(28, 25, 23, 0.65)"
        : "rgba(28, 25, 23, 0.35)";
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
    }

    // Needles: other under, cursor (blue) on top
    drawNeedle(
      ctx,
      cx,
      cy,
      frame.otherAngle,
      frame.otherColor || "#1c1917",
      outerR - 8,
      1
    );
    drawNeedle(
      ctx,
      cx,
      cy,
      frame.cursorAngle,
      frame.cursorColor || "#2563eb",
      outerR - 22,
      0.85
    );

    // Hub
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = frame.cursorColor || "#2563eb";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#faf7f1";
    ctx.fill();

    if (frame.hasFault) {
      ctx.beginPath();
      ctx.arc(cx + outerR * 0.62, cy - outerR * 0.55, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#c23b22";
      ctx.fill();
    }

    ctx.restore();
  }

  const MeterPaintApi = {
    drawMeterFace,
    OUTER_R,
    INNER_R,
    PLATE_R,
    DIAL,
    START,
    END,
  };

  if (global) {
    global.MeterPaint = MeterPaintApi;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = MeterPaintApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : undefined);
