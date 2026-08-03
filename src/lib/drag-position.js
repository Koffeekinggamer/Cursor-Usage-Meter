"use strict";

/**
 * Compute a safe next window origin after a drag delta.
 * Returns null when inputs would produce NaN/non-finite coords that
 * Electron's native setPosition rejects with:
 *   TypeError: Error processing argument at index 0, conversion failure
 *
 * @param {number} x
 * @param {number} y
 * @param {unknown} dx
 * @param {unknown} dy
 * @returns {{ x: number, y: number } | null}
 */
function nextDragPosition(x, y, dx, dy) {
  const nx = Math.round(Number(x) + Number(dx));
  const ny = Math.round(Number(y) + Number(dy));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  return { x: nx, y: ny };
}

module.exports = { nextDragPosition };
