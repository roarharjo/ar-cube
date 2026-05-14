/**
 * OpenCV.js worker. Owns the hot loop's CV math.
 *
 * Message protocol (main → worker):
 *   { type: 'init' }
 *   { type: 'track', bitmap: ImageBitmap, seed: {x,y}, prevCentroid, prevCorners, prevR }
 *   { type: 'chessboard', bitmap: ImageBitmap, patternSize: [9,6] }
 *
 * Replies (worker → main):
 *   { type: 'ready' }
 *   { type: 'trackResult', ok, corners?, centroid?, solutions?, status }
 *   { type: 'chessboardResult', ok, corners?, status }
 *   { type: 'error', message }
 */

let cv = null;
let ready = false;
let caps = null; // capability map populated by probe

self.importScripts('../vendor/opencv.js');

function markReady() {
  caps = probeCapabilities();
  ready = true;
  self.postMessage({ type: 'ready', caps });
}

function probeCapabilities() {
  return {
    cornerSubPix: typeof cv.cornerSubPix === 'function',
    findContours: typeof cv.findContours === 'function',
    boxPoints: typeof cv.boxPoints === 'function',
  };
}

cv = self.cv;
if (cv && typeof cv.then === 'function') {
  // OpenCV.js exposes a Promise-like in newer builds
  cv.then((mod) => { cv = mod; self.cv = mod; markReady(); });
} else if (cv && cv.Mat) {
  markReady();
} else {
  // Fall back to the onRuntimeInitialized hook
  self.Module = self.Module || {};
  const prev = self.Module.onRuntimeInitialized;
  self.Module.onRuntimeInitialized = () => {
    if (prev) prev();
    cv = self.cv;
    markReady();
  };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!ready) {
    self.postMessage({ type: 'error', message: 'OpenCV.js not yet ready' });
    return;
  }

  try {
    switch (msg.type) {
      case 'init':
        self.postMessage({ type: 'ready' });
        break;

      case 'track': {
        const result = doTrackDetection(msg);
        self.postMessage({ type: 'trackResult', ...result });
        break;
      }

      case 'chessboard':
        self.postMessage({ type: 'chessboardResult', ok: false, status: 'client-side chessboard disabled; use backend' });
        break;

      default:
        self.postMessage({ type: 'error', message: `unknown message type: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

// ============= Detection =============

const FLOOD_TOL_H = 10;
const FLOOD_TOL_S = 25;
const FLOOD_TOL_V = 40;
const SEGMENT_MIN_AREA = 250;
const SEGMENT_MAX_AREA_RATIO = 0.40;
const SEGMENT_SEARCH_RADIUS_PX = 25;
const ROI_EXPAND_FACTOR = 1.5;
const SUBPIX_WIN = 5;

function doTrackDetection(msg) {
  const { bitmap, seed, prevCorners } = msg;

  // 1. Render ImageBitmap onto an OffscreenCanvas to get pixel data into a Mat.
  const oc = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = oc.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const frame = cv.matFromImageData(imgData); // RGBA
  const frameBgr = new cv.Mat();
  cv.cvtColor(frame, frameBgr, cv.COLOR_RGBA2BGR);
  frame.delete();

  // 2. Compute ROI.
  let roi = null;
  if (prevCorners && prevCorners.length === 4) {
    const xs = prevCorners.map(p => p[0]);
    const ys = prevCorners.map(p => p[1]);
    const bx = Math.min(...xs), by = Math.min(...ys);
    const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
    const cx = bx + bw / 2, cy = by + bh / 2;
    const w = bw * ROI_EXPAND_FACTOR, h = bh * ROI_EXPAND_FACTOR;
    let rx = Math.round(cx - w / 2);
    let ry = Math.round(cy - h / 2);
    let rw = Math.round(w);
    let rh = Math.round(h);
    if (rx < 0) { rw += rx; rx = 0; }
    if (ry < 0) { rh += ry; ry = 0; }
    if (rx + rw > frameBgr.cols) rw = frameBgr.cols - rx;
    if (ry + rh > frameBgr.rows) rh = frameBgr.rows - ry;
    if (rw > 0 && rh > 0) roi = { x: rx, y: ry, w: rw, h: rh };
  }
  if (!roi) roi = { x: 0, y: 0, w: frameBgr.cols, h: frameBgr.rows };

  const roiBgr = frameBgr.roi(new cv.Rect(roi.x, roi.y, roi.w, roi.h));
  const roiHsv = new cv.Mat();
  cv.cvtColor(roiBgr, roiHsv, cv.COLOR_BGR2HSV);

  // 3. Spiral seed search.
  const sx0 = Math.round(seed.x - roi.x);
  const sy0 = Math.round(seed.y - roi.y);
  const seedList = [{ x: sx0, y: sy0 }];
  for (let r = 4; r <= SEGMENT_SEARCH_RADIUS_PX; r += 4) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      seedList.push({ x: sx0 + dx, y: sy0 + dy });
    }
  }

  let chosen = null;
  let lastFailure = 'no_seed_tried';

  for (const s of seedList) {
    if (s.x < 0 || s.y < 0 || s.x >= roi.w || s.y >= roi.h) continue;
    const mask = new cv.Mat.zeros(roi.h + 2, roi.w + 2, cv.CV_8U);
    const flags = 4 | (255 << 8) | cv.FLOODFILL_MASK_ONLY | cv.FLOODFILL_FIXED_RANGE;
    try {
      cv.floodFill(
        roiHsv,
        mask,
        new cv.Point(s.x, s.y),
        new cv.Scalar(0, 0, 0),
        new cv.Rect(),
        new cv.Scalar(FLOOD_TOL_H, FLOOD_TOL_S, FLOOD_TOL_V),
        new cv.Scalar(FLOOD_TOL_H, FLOOD_TOL_S, FLOOD_TOL_V),
        flags,
      );
    } catch (e) {
      mask.delete();
      lastFailure = `floodfill_error:${e.message || e}`;
      continue;
    }

    const inner = mask.roi(new cv.Rect(1, 1, roi.w, roi.h));
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(inner, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let bestContour = null, bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const a = cv.contourArea(c);
      if (a > bestArea) { bestArea = a; bestContour = c; }
    }

    const roiArea = roi.w * roi.h;
    if (!bestContour || bestArea < SEGMENT_MIN_AREA) {
      lastFailure = `too_small(${Math.round(bestArea)})`;
    } else if (bestArea > SEGMENT_MAX_AREA_RATIO * roiArea) {
      lastFailure = `too_big(${Math.round(bestArea)})`;
    } else {
      // 4. Extract 4 corners. Try approxPolyDP at several epsilons; fall back to minAreaRect.
      const perimeter = cv.arcLength(bestContour, true);
      let cornersLocal = null;
      let method = 'rect';
      for (const epsFactor of [0.02, 0.04, 0.06, 0.08]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(bestContour, approx, epsFactor * perimeter, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          cornersLocal = [];
          for (let i = 0; i < 4; i++) {
            cornersLocal.push([approx.data32S[i * 2], approx.data32S[i * 2 + 1]]);
          }
          method = `poly[${epsFactor.toFixed(2)}]`;
          approx.delete();
          break;
        }
        approx.delete();
      }
      if (!cornersLocal) {
        const rect = cv.minAreaRect(bestContour);
        cornersLocal = rotatedRectToCorners(rect);
        method = 'rect';
      }

      // 5. cornerSubPix refinement on grayscale ROI (only if available).
      let refined = cornersLocal;
      if (caps && caps.cornerSubPix) {
        const roiGray = new cv.Mat();
        cv.cvtColor(roiBgr, roiGray, cv.COLOR_BGR2GRAY);
        const cornerMat = cv.matFromArray(4, 1, cv.CV_32FC2, cornersLocal.flat());
        const term = new cv.TermCriteria(
          cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 30, 0.01,
        );
        cv.cornerSubPix(roiGray, cornerMat, new cv.Size(SUBPIX_WIN, SUBPIX_WIN), new cv.Size(-1, -1), term);
        refined = [];
        for (let i = 0; i < 4; i++) {
          refined.push([cornerMat.data32F[i * 2], cornerMat.data32F[i * 2 + 1]]);
        }
        cornerMat.delete();
        roiGray.delete();
      }

      // 6. Translate to full-frame coordinates.
      const fullCorners = refined.map(([x, y]) => [x + roi.x, y + roi.y]);
      const cx = fullCorners.reduce((a, p) => a + p[0], 0) / 4;
      const cy = fullCorners.reduce((a, p) => a + p[1], 0) / 4;

      chosen = {
        corners: fullCorners,
        centroid: { x: cx, y: cy },
        area: bestArea,
        method,
      };
    }

    contours.delete();
    hierarchy.delete();
    inner.delete();
    mask.delete();
    if (chosen) break;
  }

  roiHsv.delete();
  roiBgr.delete();
  frameBgr.delete();

  if (!chosen) {
    return { ok: false, status: lastFailure };
  }
  return {
    ok: true,
    corners: chosen.corners,
    centroid: chosen.centroid,
    status: `ok area=${Math.round(chosen.area)} ${chosen.method}`,
  };
}

/**
 * Compute the 4 corners of an OpenCV RotatedRect manually.
 * cv.boxPoints is not exposed as a function in some OpenCV.js builds,
 * so we replicate the math here. Order matches cv2.boxPoints (Python):
 * starts at the bottom-most point and proceeds clockwise.
 */
function rotatedRectToCorners(rect) {
  const cx = rect.center.x;
  const cy = rect.center.y;
  const w = rect.size.width;
  const h = rect.size.height;
  const angleRad = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  // Half-extents
  const halfW = w / 2;
  const halfH = h / 2;
  // Corners relative to center, in TL, TR, BR, BL order
  const local = [
    [-halfW, -halfH],
    [+halfW, -halfH],
    [+halfW, +halfH],
    [-halfW, +halfH],
  ];
  return local.map(([x, y]) => [
    cx + x * cos - y * sin,
    cy + x * sin + y * cos,
  ]);
}
