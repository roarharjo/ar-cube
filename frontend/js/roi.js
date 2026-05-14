/**
 * Bounding-box utilities for predicted-ROI cropping in the tracking loop.
 * Pure functions; no canvas or worker references.
 */

export function bboxFromCorners(corners) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function expandBbox(bbox, factor) {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const newW = bbox.w * factor;
  const newH = bbox.h * factor;
  return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
}

export function clampBbox(bbox, frameW, frameH) {
  let { x, y, w, h } = bbox;

  // Clamp origin to frame bounds
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  // Clamp dimensions to frame size
  if (w > frameW) w = frameW;
  if (h > frameH) h = frameH;

  // Clamp right/bottom edges
  if (x + w > frameW) x = frameW - w;
  if (y + h > frameH) y = frameH - h;

  // Final safety: keep origin non-negative
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  return { x, y, w, h };
}

export function toFullFrameCorners(localCorners, bbox) {
  return localCorners.map(([x, y]) => [x + bbox.x, y + bbox.y]);
}
