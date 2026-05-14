# AR Cube — Efficiency & Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate rotation jitter, stop floodFill bleed, raise sustained frame rate to ≥30 fps, and replace the manual focal-scale guess with proper chessboard calibration — by moving detection client-side via OpenCV.js running in a Web Worker, adding cross-frame rotation hysteresis + sub-pixel corner refinement + still-frame averaging, and slimming the backend to a single calibration endpoint.

**Architecture:** Hot loop moves to the browser. A Web Worker hosts OpenCV.js (WASM build) and runs floodFill → corner refinement → solvePnP per frame on a predicted ROI. A new `poseFilter.js` layers IPPE hysteresis, still-frame pose averaging (Markley quaternion mean), and EMA/slerp smoothing. A new `tracker.js` owns the state machine (`idle → camera_on → awaiting_click → tracking ⇄ lost`). The FastAPI backend keeps only `POST /api/calibrate-camera`, which runs `cv2.calibrateCamera` over a batch of 12 chessboard captures and returns intrinsics that the frontend persists to `localStorage`.

**Tech Stack:** Vanilla JS ES modules + Three.js r128 (frontend, unchanged), OpenCV.js 4.10.0 (new, WASM in Web Worker), Vitest 1.x (new, dev-only frontend tests), FastAPI + OpenCV-headless + NumPy (backend, slimmed), Docker Compose (unchanged), pytest (backend, unchanged tooling).

**Reference spec:** `docs/superpowers/specs/2026-05-14-efficiency-stability-design.md`

---

## File map

**New frontend files:**

| File | Responsibility |
|------|----------------|
| `frontend/js/poseFilter.js` | Pure-function pose pipeline: IPPE hysteresis scoring, quaternion utils, Markley averaging, still-frame detector, EMA/slerp smoothing. |
| `frontend/js/roi.js` | Pure utilities: bbox expansion, ROI clamp, coordinate translation between ROI and full frame. |
| `frontend/js/tracker.js` | State machine (`idle` / `camera_on` / `awaiting_click` / `tracking` / `lost` / `calibrating`). Owns the per-frame loop driver. |
| `frontend/js/cvWorker.js` | Main-thread host for the Web Worker; manages worker lifecycle, message routing, and OpenCV.js readiness. |
| `frontend/js/cvWorker.worker.js` | Worker script. Loads OpenCV.js, handles `init`, `track`, `chessboard` messages. |
| `frontend/js/calibrationUI.js` | Calibration modal, capture progress, POST orchestration. |
| `frontend/vendor/opencv.js` | Vendored OpenCV.js 4.10.0 (~8 MB) so it works offline. |
| `frontend/assets/checkerboard-9x6-25mm.pdf` | Downloadable chessboard print. |
| `frontend/package.json` | Vitest dev dependency. Runtime stays no-build. |
| `frontend/vitest.config.js` | Vitest config (jsdom env for the few DOM-touching tests). |
| `frontend/js/__tests__/poseFilter.test.js` | poseFilter unit tests. |
| `frontend/js/__tests__/roi.test.js` | ROI utility tests. |
| `frontend/js/__tests__/tracker.test.js` | State-machine transition tests. |

**Modified frontend files:**

| File | Change |
|------|--------|
| `frontend/index.html` | Add OpenCV.js script tag (deferred load via worker), add "Calibrate Camera" button, add calibration modal markup, fix stale "IPPE_SQUARE" telemetry label. |
| `frontend/css/styles.css` | Add calibration modal styles. |
| `frontend/js/main.js` | Slim down — delegate tracking to `tracker.js`, pose smoothing to `poseFilter.js`, wire calibration UI. |
| `frontend/js/overlayManager.js` | Remove pose smoothing (moved to `poseFilter.js`); keep only manual calibration nudges + matrix application. |
| `frontend/js/apiClient.js` | Replace `sendFrame` with `submitCalibration`. |

**New backend files:**

| File | Responsibility |
|------|----------------|
| `backend/services/camera_calibrator.py` | Wraps `cv2.calibrateCamera`. Takes pre-detected chessboard corners + frame size; returns intrinsics. |
| `backend/tests/test_calibrator.py` | Unit tests using synthetic chessboard. |
| `backend/tests/test_api_calibrate.py` | Integration tests for the new endpoint. |

**Modified backend files:**

| File | Change |
|------|--------|
| `backend/api/routes.py` | Replace `/api/estimate-pose` with `/api/calibrate-camera`. |
| `backend/models/schemas.py` | Replace `PoseEstimationResponse` with `CalibrationResponse`. |
| `backend/config.py` | Trim to ~10 lines: image size limits, accepted types, default pattern size. |

**Deleted files:**

- `backend/services/click_segment_detector.py`
- `backend/services/feature_detector.py`
- `backend/services/aruco_detector.py`
- `backend/services/pose_estimator.py`
- `backend/tests/test_api.py` (replaced by `test_api_calibrate.py`)
- `backend/tests/test_feature_detector.py`
- `backend/tests/test_pose_estimator.py`
- `docs/marker/` (entire directory — ArUco assets were already inactive)

`backend/tests/test_image_processor.py` and `backend/utils/image_processor.py` are kept.

---

## Phase 1 — Frontend test infrastructure & pure-function modules

These modules contain no DOM, no OpenCV, no Three.js. They're pure logic and the place where TDD pays off most.

---

### Task 1: Set up Vitest

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vitest.config.js`
- Create: `frontend/.gitignore`
- Modify: `frontend/Dockerfile` (no change required if it only serves static files — verify)

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "ar-cube-frontend",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vitest.config.js`**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['js/__tests__/**/*.test.js'],
    globals: false,
    passWithNoTests: true,
  },
});
```

`passWithNoTests: true` is required for Vitest 1.x to exit 0 in Step 4 when no tests exist yet. Subsequent tasks add tests.

- [ ] **Step 3: Create `frontend/.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Install and verify**

Run: `cd frontend && npm install && npx vitest run --reporter=verbose`
Expected: "No test files found" — exit code 0. (Tests are added in following tasks.)

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/vitest.config.js frontend/.gitignore
git commit -m "frontend: add Vitest dev infrastructure"
```

---

### Task 2: poseFilter — quaternion utilities + angular_distance (TDD)

**Files:**
- Create: `frontend/js/poseFilter.js`
- Create: `frontend/js/__tests__/poseFilter.test.js`

These are framework-free helpers. `quatFromMatrix` is pulled in instead of relying on Three.js so the module is testable in Node without WebGL.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/js/__tests__/poseFilter.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { quatFromMatrix, normalizeQuat, angularDistance } from '../poseFilter.js';

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// 90° rotation around Z
const ROT_Z_90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
// 180° rotation around Z
const ROT_Z_180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];

describe('quatFromMatrix', () => {
  it('returns identity quaternion for identity matrix', () => {
    const q = quatFromMatrix(IDENTITY);
    expect(q.w).toBeCloseTo(1, 6);
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(0, 6);
  });

  it('round-trips a 90° Z rotation', () => {
    const q = normalizeQuat(quatFromMatrix(ROT_Z_90));
    // 90° around Z → w = cos(45°), z = sin(45°)
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.abs(q.z)).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('angularDistance', () => {
  it('is 0 for identical rotations', () => {
    expect(angularDistance(IDENTITY, IDENTITY)).toBeCloseTo(0, 6);
  });

  it('is π/2 for a 90° rotation', () => {
    expect(angularDistance(IDENTITY, ROT_Z_90)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('is π for a 180° rotation', () => {
    expect(angularDistance(IDENTITY, ROT_Z_180)).toBeCloseTo(Math.PI, 5);
  });

  it('is symmetric', () => {
    expect(angularDistance(ROT_Z_90, IDENTITY)).toBeCloseTo(Math.PI / 2, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: FAIL — module `../poseFilter.js` not found.

- [ ] **Step 3: Implement the helpers**

Create `frontend/js/poseFilter.js`:

```javascript
/**
 * Pure-function pose pipeline helpers.
 *
 * Quaternions are stored as { w, x, y, z } plain objects so the module is
 * usable in workers and unit tests without pulling in Three.js.
 */

export function quatFromMatrix(R) {
  // Shepperd's method: numerically stable conversion from rotation matrix.
  const m00 = R[0][0], m01 = R[0][1], m02 = R[0][2];
  const m10 = R[1][0], m11 = R[1][1], m12 = R[1][2];
  const m20 = R[2][0], m21 = R[2][1], m22 = R[2][2];

  const trace = m00 + m11 + m22;
  let w, x, y, z;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return normalizeQuat({ w, x, y, z });
}

export function normalizeQuat(q) {
  const n = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (n === 0) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/**
 * Geodesic angular distance between two rotations (radians, range [0, π]).
 * Accepts either rotation matrices (3×3 arrays) or quaternions.
 */
export function angularDistance(A, B) {
  const qa = isQuat(A) ? normalizeQuat(A) : quatFromMatrix(A);
  const qb = isQuat(B) ? normalizeQuat(B) : quatFromMatrix(B);
  let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
  // Quaternions q and -q represent the same rotation; take absolute dot.
  dot = Math.min(1, Math.max(-1, Math.abs(dot)));
  return 2 * Math.acos(dot);
}

function isQuat(x) {
  return x && typeof x === 'object' && 'w' in x;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/poseFilter.js frontend/js/__tests__/poseFilter.test.js
git commit -m "poseFilter: quaternion conversion + angular distance"
```

---

### Task 3: poseFilter — IPPE hysteresis scorer (TDD)

**Files:**
- Modify: `frontend/js/poseFilter.js` (append)
- Modify: `frontend/js/__tests__/poseFilter.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```javascript
import { selectIppeSolution, ALPHA_HYSTERESIS } from '../poseFilter.js';

describe('selectIppeSolution', () => {
  const R_A = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];                       // identity
  const R_B = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];                      // 90° Z
  const T = [0, 0, 0.30];

  it('picks lowest reprojection error when no previous pose', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 1.2 },
      { R: R_B, t: T, errPx: 0.5 },
    ];
    const chosen = selectIppeSolution(solutions, null);
    expect(chosen).toBe(solutions[1]);
  });

  it('prefers solution closer to previous rotation when errors are similar', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 1.0 },
      { R: R_B, t: T, errPx: 1.1 }, // marginally worse but rotated 90°
    ];
    const prev = { R: R_A };
    const chosen = selectIppeSolution(solutions, prev);
    // R_A is 0 rad from prev; R_B is π/2 rad → cost adds ~π/2 ≈ 1.57 px at α=1
    expect(chosen).toBe(solutions[0]);
  });

  it('still flips when reprojection error is decisively better', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 5.0 }, // much worse
      { R: R_B, t: T, errPx: 0.3 },
    ];
    const prev = { R: R_A };
    const chosen = selectIppeSolution(solutions, prev);
    expect(chosen).toBe(solutions[1]);
  });

  it('exposes the tunable alpha as a constant', () => {
    expect(typeof ALPHA_HYSTERESIS).toBe('number');
    expect(ALPHA_HYSTERESIS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: FAIL — `selectIppeSolution` / `ALPHA_HYSTERESIS` undefined.

- [ ] **Step 3: Implement**

Append to `frontend/js/poseFilter.js`:

```javascript
export const ALPHA_HYSTERESIS = 1.0; // px-reproj equivalent per radian

/**
 * Choose between IPPE's two planar-ambiguity solutions.
 *
 * solutions: Array<{ R: 3x3, t: [x,y,z], errPx: number }>
 * prev: { R: 3x3 } | null   — previous filtered rotation, or null on first frame
 *
 * Without a previous pose, picks lowest reprojection error.
 * Otherwise, adds α × angular_distance(R, prev.R) to each error and picks min.
 */
export function selectIppeSolution(solutions, prev) {
  if (!solutions || solutions.length === 0) return null;
  if (solutions.length === 1) return solutions[0];

  if (!prev || !prev.R) {
    return solutions.reduce((best, s) => (s.errPx < best.errPx ? s : best));
  }

  let bestScore = Infinity;
  let best = solutions[0];
  for (const s of solutions) {
    const ang = angularDistance(prev.R, s.R);
    const score = s.errPx + ALPHA_HYSTERESIS * ang;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: PASS — 10 tests total.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/poseFilter.js frontend/js/__tests__/poseFilter.test.js
git commit -m "poseFilter: IPPE hysteresis scorer"
```

---

### Task 4: poseFilter — quaternion averaging (Markley method) (TDD)

**Files:**
- Modify: `frontend/js/poseFilter.js` (append)
- Modify: `frontend/js/__tests__/poseFilter.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```javascript
import { quatAverage } from '../poseFilter.js';

describe('quatAverage (Markley)', () => {
  it('returns the only quat when given a single sample', () => {
    const q = { w: 1, x: 0, y: 0, z: 0 };
    const avg = quatAverage([q]);
    expect(avg.w).toBeCloseTo(1, 6);
  });

  it('returns identity when averaging a quat and its negation', () => {
    // q and -q represent the same rotation; mean should equal that rotation.
    const q = { w: 0.7071, x: 0, y: 0, z: 0.7071 };
    const negQ = { w: -q.w, x: -q.x, y: -q.y, z: -q.z };
    const avg = quatAverage([q, negQ]);
    // Should equal q (up to sign convention)
    const dot = Math.abs(avg.w * q.w + avg.x * q.x + avg.y * q.y + avg.z * q.z);
    expect(dot).toBeCloseTo(1, 4);
  });

  it('averages a small cluster around identity to near-identity', () => {
    // 30 tiny perturbations of identity; mean should be ≈ identity.
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push(normalizeQuat({
        w: 1,
        x: (Math.random() - 0.5) * 0.01,
        y: (Math.random() - 0.5) * 0.01,
        z: (Math.random() - 0.5) * 0.01,
      }));
    }
    const avg = quatAverage(samples);
    expect(avg.w).toBeGreaterThan(0.999);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: FAIL — `quatAverage` undefined.

- [ ] **Step 3: Implement**

Append to `frontend/js/poseFilter.js`:

```javascript
/**
 * Markley quaternion average: the eigenvector corresponding to the largest
 * eigenvalue of M = Σ qᵢqᵢᵀ. Robust for clustered rotations.
 */
export function quatAverage(quats) {
  if (!quats || quats.length === 0) return { w: 1, x: 0, y: 0, z: 0 };
  if (quats.length === 1) return normalizeQuat(quats[0]);

  // Build 4×4 symmetric M = Σ qᵢ ⊗ qᵢ
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const q of quats) {
    const v = [q.w, q.x, q.y, q.z];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) M[i][j] += v[i] * v[j];
    }
  }

  // Power iteration: dominant eigenvector of M.
  let v = [1, 0, 0, 0];
  for (let iter = 0; iter < 64; iter++) {
    const next = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) next[i] += M[i][j] * v[j];
    }
    const norm = Math.sqrt(next[0] ** 2 + next[1] ** 2 + next[2] ** 2 + next[3] ** 2);
    if (norm === 0) break;
    for (let i = 0; i < 4; i++) next[i] /= norm;
    // Check convergence
    let diff = 0;
    for (let i = 0; i < 4; i++) diff += Math.abs(next[i] - v[i]);
    v = next;
    if (diff < 1e-9) break;
  }

  return normalizeQuat({ w: v[0], x: v[1], y: v[2], z: v[3] });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: PASS — 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/poseFilter.js frontend/js/__tests__/poseFilter.test.js
git commit -m "poseFilter: Markley quaternion averaging"
```

---

### Task 5: poseFilter — still-frame detector + buffer averaging (TDD)

**Files:**
- Modify: `frontend/js/poseFilter.js` (append)
- Modify: `frontend/js/__tests__/poseFilter.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```javascript
import { StillDetector, STILL_VELOCITY_PX, STILL_FRAMES_REQUIRED, POSE_BUFFER_SIZE } from '../poseFilter.js';

describe('StillDetector', () => {
  const T = [0, 0, 0.3];
  const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const pose = { R, t: T };

  it('starts in motion state', () => {
    const d = new StillDetector();
    const out = d.update(pose, { x: 100, y: 100 });
    expect(out.isStill).toBe(false);
    expect(out.pose).toEqual(pose);
  });

  it('transitions to still after STILL_FRAMES_REQUIRED stable frames', () => {
    const d = new StillDetector();
    d.update(pose, { x: 100, y: 100 });
    for (let i = 0; i < STILL_FRAMES_REQUIRED; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    const out = d.update(pose, { x: 100.5, y: 100.5 });
    expect(out.isStill).toBe(true);
  });

  it('resets to motion when velocity exceeds threshold', () => {
    const d = new StillDetector();
    for (let i = 0; i < STILL_FRAMES_REQUIRED + 2; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    const out = d.update(pose, { x: 200, y: 200 }); // big jump
    expect(out.isStill).toBe(false);
  });

  it('caps buffer at POSE_BUFFER_SIZE', () => {
    const d = new StillDetector();
    for (let i = 0; i < POSE_BUFFER_SIZE + 10; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    expect(d.bufferLength()).toBeLessThanOrEqual(POSE_BUFFER_SIZE);
  });

  it('exposes tunable constants', () => {
    expect(STILL_VELOCITY_PX).toBeGreaterThan(0);
    expect(STILL_FRAMES_REQUIRED).toBeGreaterThan(0);
    expect(POSE_BUFFER_SIZE).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: FAIL — `StillDetector` undefined.

- [ ] **Step 3: Implement**

Append to `frontend/js/poseFilter.js`:

```javascript
export const STILL_VELOCITY_PX = 2.0;
export const STILL_FRAMES_REQUIRED = 10;
export const POSE_BUFFER_SIZE = 30;

/**
 * Detects when the centroid velocity stays below STILL_VELOCITY_PX for
 * STILL_FRAMES_REQUIRED consecutive frames. Once still, accumulates poses
 * in a ring buffer and outputs the Markley-averaged pose.
 */
export class StillDetector {
  constructor() {
    this._prevCentroid = null;
    this._lowVelocityFrames = 0;
    this._buffer = []; // { R, t, q }  — q cached for averaging
  }

  bufferLength() {
    return this._buffer.length;
  }

  update(pose, centroid) {
    const velocity = this._prevCentroid
      ? Math.hypot(centroid.x - this._prevCentroid.x, centroid.y - this._prevCentroid.y)
      : Infinity;
    this._prevCentroid = { ...centroid };

    if (velocity < STILL_VELOCITY_PX) {
      this._lowVelocityFrames++;
    } else {
      this._lowVelocityFrames = 0;
      this._buffer.length = 0;
    }

    const isStill = this._lowVelocityFrames >= STILL_FRAMES_REQUIRED;

    if (isStill) {
      const q = quatFromMatrix(pose.R);
      this._buffer.push({ R: pose.R, t: pose.t, q });
      if (this._buffer.length > POSE_BUFFER_SIZE) this._buffer.shift();

      const avgQ = quatAverage(this._buffer.map(b => b.q));
      const avgT = [0, 0, 0];
      for (const b of this._buffer) {
        avgT[0] += b.t[0]; avgT[1] += b.t[1]; avgT[2] += b.t[2];
      }
      avgT[0] /= this._buffer.length;
      avgT[1] /= this._buffer.length;
      avgT[2] /= this._buffer.length;

      return {
        isStill: true,
        pose: { R: matrixFromQuat(avgQ), t: avgT, q: avgQ },
      };
    }

    return { isStill: false, pose };
  }
}

export function matrixFromQuat(q) {
  const { w, x, y, z } = normalizeQuat(q);
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    [1 - 2 * (yy + zz),   2 * (xy - wz),       2 * (xz + wy)],
    [2 * (xy + wz),       1 - 2 * (xx + zz),   2 * (yz - wx)],
    [2 * (xz - wy),       2 * (yz + wx),       1 - 2 * (xx + yy)],
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: PASS — 18 tests total.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/poseFilter.js frontend/js/__tests__/poseFilter.test.js
git commit -m "poseFilter: still-frame detector with quaternion-averaged buffer"
```

---

### Task 6: poseFilter — output smoothing layer (TDD)

**Files:**
- Modify: `frontend/js/poseFilter.js` (append)
- Modify: `frontend/js/__tests__/poseFilter.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```javascript
import { PoseSmoother, POSE_TRANS_SMOOTHING, POSE_ROT_SMOOTHING } from '../poseFilter.js';

describe('PoseSmoother', () => {
  const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  it('outputs the first pose unchanged', () => {
    const s = new PoseSmoother();
    const out = s.update({ R, t: [1, 2, 3] });
    expect(out.t).toEqual([1, 2, 3]);
  });

  it('lerps translation toward target', () => {
    const s = new PoseSmoother();
    s.update({ R, t: [0, 0, 0] });
    const out = s.update({ R, t: [10, 0, 0] });
    // After one EMA step: prev + (target - prev) * α
    expect(out.t[0]).toBeCloseTo(POSE_TRANS_SMOOTHING * 10, 5);
  });

  it('reset() clears smoothing state', () => {
    const s = new PoseSmoother();
    s.update({ R, t: [5, 5, 5] });
    s.reset();
    const out = s.update({ R, t: [10, 10, 10] });
    expect(out.t).toEqual([10, 10, 10]);
  });

  it('exposes tunable constants', () => {
    expect(POSE_TRANS_SMOOTHING).toBeGreaterThan(0);
    expect(POSE_TRANS_SMOOTHING).toBeLessThanOrEqual(1);
    expect(POSE_ROT_SMOOTHING).toBeGreaterThan(0);
    expect(POSE_ROT_SMOOTHING).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: FAIL — `PoseSmoother` undefined.

- [ ] **Step 3: Implement**

Append to `frontend/js/poseFilter.js`:

```javascript
export const POSE_TRANS_SMOOTHING = 0.50;
export const POSE_ROT_SMOOTHING = 0.40;

function slerpQuat(a, b, t) {
  // Take shortest path
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bb = b;
  if (dot < 0) {
    bb = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Linear interpolation for close orientations
    return normalizeQuat({
      w: a.w + (bb.w - a.w) * t,
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
    });
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const wA = Math.sin((1 - t) * theta) / sinTheta;
  const wB = Math.sin(t * theta) / sinTheta;
  return normalizeQuat({
    w: a.w * wA + bb.w * wB,
    x: a.x * wA + bb.x * wB,
    y: a.y * wA + bb.y * wB,
    z: a.z * wA + bb.z * wB,
  });
}

export class PoseSmoother {
  constructor() { this.reset(); }

  reset() {
    this._t = null;
    this._q = null;
  }

  update(pose) {
    const targetQ = pose.q || quatFromMatrix(pose.R);
    if (this._t === null) {
      this._t = [...pose.t];
      this._q = { ...targetQ };
      return { R: matrixFromQuat(this._q), t: [...this._t], q: this._q };
    }
    this._t = [
      this._t[0] + (pose.t[0] - this._t[0]) * POSE_TRANS_SMOOTHING,
      this._t[1] + (pose.t[1] - this._t[1]) * POSE_TRANS_SMOOTHING,
      this._t[2] + (pose.t[2] - this._t[2]) * POSE_TRANS_SMOOTHING,
    ];
    this._q = slerpQuat(this._q, targetQ, POSE_ROT_SMOOTHING);
    return { R: matrixFromQuat(this._q), t: [...this._t], q: this._q };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/poseFilter.test.js`
Expected: PASS — 22 tests total.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/poseFilter.js frontend/js/__tests__/poseFilter.test.js
git commit -m "poseFilter: EMA + slerp output smoothing"
```

---

### Task 7: roi.js — bounding box utilities (TDD)

**Files:**
- Create: `frontend/js/roi.js`
- Create: `frontend/js/__tests__/roi.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/js/__tests__/roi.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { bboxFromCorners, expandBbox, clampBbox, toFullFrameCorners } from '../roi.js';

describe('bboxFromCorners', () => {
  it('produces the tight bounding box of 4 corners', () => {
    const corners = [[10, 20], [40, 25], [42, 60], [8, 58]];
    expect(bboxFromCorners(corners)).toEqual({ x: 8, y: 20, w: 34, h: 40 });
  });
});

describe('expandBbox', () => {
  it('grows by factor relative to center', () => {
    const b = { x: 50, y: 50, w: 40, h: 20 };
    // factor=1.5 → new w = 60, h = 30, center stays at (70, 60)
    const e = expandBbox(b, 1.5);
    expect(e.w).toBe(60);
    expect(e.h).toBe(30);
    expect(e.x + e.w / 2).toBeCloseTo(70, 6);
    expect(e.y + e.h / 2).toBeCloseTo(60, 6);
  });
});

describe('clampBbox', () => {
  it('does nothing when inside frame', () => {
    expect(clampBbox({ x: 10, y: 10, w: 20, h: 20 }, 100, 100))
      .toEqual({ x: 10, y: 10, w: 20, h: 20 });
  });

  it('clamps when overflowing right/bottom', () => {
    expect(clampBbox({ x: 90, y: 90, w: 30, h: 30 }, 100, 100))
      .toEqual({ x: 70, y: 70, w: 30, h: 30 });
  });

  it('clamps when negative origin', () => {
    expect(clampBbox({ x: -5, y: -5, w: 30, h: 30 }, 100, 100))
      .toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });

  it('shrinks bbox if larger than frame', () => {
    expect(clampBbox({ x: -10, y: -10, w: 200, h: 200 }, 100, 100))
      .toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('toFullFrameCorners', () => {
  it('adds bbox origin to ROI-local corners', () => {
    const bbox = { x: 50, y: 100, w: 80, h: 80 };
    const local = [[0, 0], [10, 5], [10, 15], [0, 15]];
    expect(toFullFrameCorners(local, bbox)).toEqual([
      [50, 100], [60, 105], [60, 115], [50, 115],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/roi.test.js`
Expected: FAIL — `../roi.js` not found.

- [ ] **Step 3: Implement**

Create `frontend/js/roi.js`:

```javascript
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
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (w > frameW) w = frameW;
  if (h > frameH) h = frameH;
  if (x + w > frameW) x = frameW - w;
  if (y + h > frameH) y = frameH - h;
  // Final safety: keep origin non-negative
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  return { x, y, w, h };
}

export function toFullFrameCorners(localCorners, bbox) {
  return localCorners.map(([x, y]) => [x + bbox.x, y + bbox.y]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/roi.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/roi.js frontend/js/__tests__/roi.test.js
git commit -m "roi: bbox utilities (expand, clamp, coord translation)"
```

---

### Task 8: tracker.js — state machine (TDD)

**Files:**
- Create: `frontend/js/tracker.js`
- Create: `frontend/js/__tests__/tracker.test.js`

- [ ] **Step 1: Write the failing tests**

`frontend/js/__tests__/tracker.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { TrackerStateMachine, STATES } from '../tracker.js';

describe('TrackerStateMachine', () => {
  it('starts in idle', () => {
    const m = new TrackerStateMachine();
    expect(m.state).toBe(STATES.idle);
  });

  it('idle → camera_on on cameraReady', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    expect(m.state).toBe(STATES.camera_on);
  });

  it('camera_on → awaiting_click on startTracking', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    expect(m.state).toBe(STATES.awaiting_click);
  });

  it('awaiting_click → tracking on click', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    expect(m.state).toBe(STATES.tracking);
    expect(m.target).toEqual({ x: 100, y: 100 });
  });

  it('tracking stays in tracking on detectOk', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('detectOk');
    expect(m.state).toBe(STATES.tracking);
    expect(m.consecutiveFail).toBe(0);
  });

  it('tracking → lost after 8 consecutive fails', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
  });

  it('lost → awaiting_click after further failures', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
    for (let i = 0; i < 30; i++) m.send('detectFail'); // M further fails
    expect(m.state).toBe(STATES.awaiting_click);
  });

  it('lost → tracking on detectOk', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    for (let i = 0; i < 8; i++) m.send('detectFail');
    expect(m.state).toBe(STATES.lost);
    m.send('detectOk');
    expect(m.state).toBe(STATES.tracking);
  });

  it('escape clears target and returns to awaiting_click', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('clearTarget');
    expect(m.state).toBe(STATES.awaiting_click);
    expect(m.target).toBeNull();
  });

  it('drift triggers re-click prompt (transitions to awaiting_click)', () => {
    const m = new TrackerStateMachine();
    m.send('cameraReady');
    m.send('startTracking');
    m.send('click', { x: 100, y: 100 });
    m.send('drift');
    expect(m.state).toBe(STATES.awaiting_click);
    expect(m.target).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run js/__tests__/tracker.test.js`
Expected: FAIL — `../tracker.js` not found.

- [ ] **Step 3: Implement**

Create `frontend/js/tracker.js`:

```javascript
/**
 * Tracker state machine. Pure logic — no DOM, no worker, no Three.js.
 * The orchestrator in main.js wires events into `send(event, payload)`
 * and inspects `state`, `target`, `consecutiveFail`.
 */

export const STATES = Object.freeze({
  idle: 'idle',
  camera_on: 'camera_on',
  awaiting_click: 'awaiting_click',
  tracking: 'tracking',
  lost: 'lost',
  calibrating: 'calibrating',
});

export const FAIL_BEFORE_LOST = 8;
export const FAIL_BEFORE_DEMOTE = 30; // additional fails while lost → awaiting_click

export class TrackerStateMachine {
  constructor() {
    this.state = STATES.idle;
    this.target = null;
    this.originalClick = null;
    this.consecutiveFail = 0;
    this._failsInLost = 0;
  }

  send(event, payload = null) {
    switch (event) {
      case 'cameraReady':
        if (this.state === STATES.idle) this.state = STATES.camera_on;
        break;

      case 'startTracking':
        if (this.state === STATES.camera_on) this.state = STATES.awaiting_click;
        break;

      case 'stopTracking':
        this.state = STATES.camera_on;
        this.target = null;
        this.originalClick = null;
        this.consecutiveFail = 0;
        this._failsInLost = 0;
        break;

      case 'click':
        if (this.state === STATES.awaiting_click ||
            this.state === STATES.tracking ||
            this.state === STATES.lost) {
          this.target = { ...payload };
          this.originalClick = { ...payload };
          this.consecutiveFail = 0;
          this._failsInLost = 0;
          this.state = STATES.tracking;
        }
        break;

      case 'detectOk':
        if (this.state === STATES.tracking || this.state === STATES.lost) {
          this.state = STATES.tracking;
          this.consecutiveFail = 0;
          this._failsInLost = 0;
          if (payload && payload.centroid) this.target = { ...payload.centroid };
        }
        break;

      case 'detectFail':
        if (this.state === STATES.tracking) {
          this.consecutiveFail++;
          if (this.consecutiveFail >= FAIL_BEFORE_LOST) {
            this.state = STATES.lost;
            this._failsInLost = 0;
          }
        } else if (this.state === STATES.lost) {
          this._failsInLost++;
          if (this._failsInLost >= FAIL_BEFORE_DEMOTE) {
            this.state = STATES.awaiting_click;
            this.target = null;
            this.originalClick = null;
            this.consecutiveFail = 0;
            this._failsInLost = 0;
          }
        }
        break;

      case 'clearTarget':
      case 'drift':
        if (this.state === STATES.tracking ||
            this.state === STATES.lost ||
            this.state === STATES.awaiting_click) {
          this.state = STATES.awaiting_click;
          this.target = null;
          this.originalClick = null;
          this.consecutiveFail = 0;
          this._failsInLost = 0;
        }
        break;

      case 'enterCalibration':
        if (this.state === STATES.camera_on || this.state === STATES.awaiting_click) {
          this._returnFrom = this.state;
          this.state = STATES.calibrating;
        }
        break;

      case 'exitCalibration':
        if (this.state === STATES.calibrating) {
          this.state = this._returnFrom || STATES.camera_on;
        }
        break;

      default:
        // Ignore unknown events.
        break;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run js/__tests__/tracker.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/tracker.js frontend/js/__tests__/tracker.test.js
git commit -m "tracker: state machine for idle/awaiting/tracking/lost/calibrating"
```

---

## Phase 2 — OpenCV.js Web Worker + detection port

End of this phase: the browser is doing the entire detection + pose pipeline. The old backend POST path is still in place as a fallback, gated behind a flag, but the default code path is fully client-side.

---

### Task 9: Vendor OpenCV.js + worker scaffold

**Files:**
- Create: `frontend/vendor/opencv.js` (download from official release)
- Create: `frontend/js/cvWorker.js`
- Create: `frontend/js/cvWorker.worker.js`

- [ ] **Step 1: Download OpenCV.js 4.10.0**

Run from project root:

```bash
mkdir -p frontend/vendor
curl -L -o frontend/vendor/opencv.js \
  https://docs.opencv.org/4.10.0/opencv.js
```

Expected: `frontend/vendor/opencv.js` exists, ~8 MB.

Verify: `ls -lh frontend/vendor/opencv.js` shows a file in the 7–9 MB range.

- [ ] **Step 2: Create the worker script**

Create `frontend/js/cvWorker.worker.js`:

```javascript
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

self.importScripts('../vendor/opencv.js');

cv = self.cv;
if (cv && typeof cv.then === 'function') {
  // OpenCV.js exposes a Promise-like in newer builds
  cv.then((mod) => { cv = mod; self.cv = mod; ready = true; self.postMessage({ type: 'ready' }); });
} else if (cv && cv.Mat) {
  ready = true;
  self.postMessage({ type: 'ready' });
} else {
  // Fall back to the onRuntimeInitialized hook
  self.Module = self.Module || {};
  const prev = self.Module.onRuntimeInitialized;
  self.Module.onRuntimeInitialized = () => {
    if (prev) prev();
    cv = self.cv;
    ready = true;
    self.postMessage({ type: 'ready' });
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

      // Implemented in later tasks.
      case 'track':
      case 'chessboard':
        self.postMessage({ type: 'error', message: `handler not yet implemented: ${msg.type}` });
        break;

      default:
        self.postMessage({ type: 'error', message: `unknown message type: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
```

- [ ] **Step 3: Create the main-thread host**

Create `frontend/js/cvWorker.js`:

```javascript
/**
 * Main-thread wrapper around the OpenCV.js worker.
 * Resolves on `ready`, then exposes track() / chessboard() methods that
 * return promises.
 */

class CvWorker {
  constructor() {
    this.worker = new Worker(new URL('./cvWorker.worker.js', import.meta.url), { type: 'classic' });
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this._pending = []; // FIFO of awaiters
    this.worker.onmessage = (e) => this._onMessage(e);
    this.worker.onerror = (err) => {
      if (this._readyReject) this._readyReject(err);
      for (const p of this._pending) p.reject(err);
      this._pending.length = 0;
    };
  }

  ready() { return this._readyPromise; }

  track(bitmap, opts) {
    return this._send({ type: 'track', bitmap, ...opts }, [bitmap], 'trackResult');
  }

  chessboard(bitmap, patternSize) {
    return this._send({ type: 'chessboard', bitmap, patternSize }, [bitmap], 'chessboardResult');
  }

  _send(msg, transfer, replyType) {
    return new Promise((resolve, reject) => {
      this._pending.push({ replyType, resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  _onMessage(e) {
    const msg = e.data;
    if (msg.type === 'ready') {
      this._readyResolve();
      this._readyResolve = null;
      return;
    }
    const next = this._pending.shift();
    if (!next) return;
    if (msg.type === 'error') next.reject(new Error(msg.message));
    else if (msg.type === next.replyType) next.resolve(msg);
    else next.reject(new Error(`unexpected reply type: ${msg.type}`));
  }

  terminate() {
    this.worker.terminate();
  }
}

export default CvWorker;
```

- [ ] **Step 4: Manual smoke check**

Open `frontend/index.html` in the browser via `docker compose up --build` or `python3 -m http.server` in the frontend dir.

Open the browser devtools, paste in the console:

```javascript
import('/js/cvWorker.js').then(async m => {
  const w = new m.default();
  await w.ready();
  console.log('OpenCV.js worker ready');
  w.terminate();
});
```

Expected: log `OpenCV.js worker ready` within ~2 seconds, no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/vendor/opencv.js frontend/js/cvWorker.js frontend/js/cvWorker.worker.js
git commit -m "cvWorker: vendor OpenCV.js + worker scaffold with ready handshake"
```

---

### Task 10: Worker — HSV floodFill detection on ROI

**Files:**
- Modify: `frontend/js/cvWorker.worker.js` (implement `track` message)

Per-frame algorithm: receive an `ImageBitmap` (full-frame), extract a predicted ROI, convert to HSV, floodFill with retries, contour → 4 corners, refine with cornerSubPix. Return corners in **full-frame coordinates** and the bounding-box centroid.

This task implements only the detection portion; pose solving is added in Task 11.

- [ ] **Step 1: Replace the `track` case with the detection implementation**

In `frontend/js/cvWorker.worker.js`, replace the placeholder `case 'track'` block with:

```javascript
case 'track': {
  const result = doTrackDetection(msg);
  self.postMessage({ type: 'trackResult', ...result });
  break;
}
```

- [ ] **Step 2: Add detection constants and helper at the bottom of the worker file**

```javascript
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
        const boxMat = new cv.Mat();
        cv.boxPoints(rect, boxMat);
        cornersLocal = [];
        for (let i = 0; i < 4; i++) {
          cornersLocal.push([boxMat.data32F[i * 2], boxMat.data32F[i * 2 + 1]]);
        }
        boxMat.delete();
      }

      // 5. cornerSubPix refinement on grayscale ROI.
      const roiGray = new cv.Mat();
      cv.cvtColor(roiBgr, roiGray, cv.COLOR_BGR2GRAY);
      const cornerMat = cv.matFromArray(4, 1, cv.CV_32FC2, cornersLocal.flat());
      const term = new cv.TermCriteria(
        cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 30, 0.01,
      );
      cv.cornerSubPix(roiGray, cornerMat, new cv.Size(SUBPIX_WIN, SUBPIX_WIN), new cv.Size(-1, -1), term);
      const refined = [];
      for (let i = 0; i < 4; i++) {
        refined.push([cornerMat.data32F[i * 2], cornerMat.data32F[i * 2 + 1]]);
      }
      cornerMat.delete();
      roiGray.delete();

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
```

- [ ] **Step 3: Smoke test the detection path manually**

Run: `docker compose up --build` (or local dev server).

Open the page, then in devtools:

```javascript
const v = document.getElementById('videoPlayer');
const bitmap = await createImageBitmap(v);
import('/js/cvWorker.js').then(async m => {
  const w = new m.default();
  await w.ready();
  const res = await w.track(bitmap, { seed: { x: v.videoWidth / 2, y: v.videoHeight / 2 } });
  console.log(res);
});
```

Expected: `{ type: 'trackResult', ok: true|false, corners?, centroid?, status }`. With camera off it'll either time-out or fail with a status string — that's fine; we just need to see the worker respond without crashing.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/cvWorker.worker.js
git commit -m "cvWorker: HSV floodFill detection on ROI with sub-pixel corners"
```

---

### Task 11: Worker — solvePnPGeneric IPPE with both solutions returned

**Files:**
- Modify: `frontend/js/cvWorker.worker.js` (extend `doTrackDetection` to add pose)

- [ ] **Step 1: Add the pose-solving block at the bottom of `doTrackDetection`, after the corners are computed**

Insert just before the final `if (!chosen) { return { ok: false ... } }` line:

```javascript
  // 7. Solve pose with IPPE (both solutions).
  if (chosen) {
    chosen.solutions = solveIppe(chosen.corners, msg.cameraMatrix, msg.distCoeffs);
  }
```

- [ ] **Step 2: Add the `solveIppe` helper and cube object points at the bottom of the worker file**

```javascript
const CUBE_SIDE_LENGTH = 0.05;
const CUBE_FACE_POINTS_3D = [
  -CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2,
   CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2,
   CUBE_SIDE_LENGTH / 2,  CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2,
  -CUBE_SIDE_LENGTH / 2,  CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2,
];

function solveIppe(corners, cameraMatrix, distCoeffs) {
  // OpenCV.js exposes solvePnPGeneric in 4.10+. We use SOLVEPNP_IPPE and read both solutions.
  const objMat = cv.matFromArray(4, 1, cv.CV_32FC3, CUBE_FACE_POINTS_3D);
  const imgMat = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
  const K = cv.matFromArray(3, 3, cv.CV_64F, cameraMatrix.flat());
  const D = cv.matFromArray(distCoeffs.length, 1, cv.CV_64F, distCoeffs);

  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();
  const errs = new cv.Mat();

  let ok = false;
  try {
    ok = cv.solvePnPGeneric(
      objMat, imgMat, K, D, rvecs, tvecs,
      false /* useExtrinsicGuess */, cv.SOLVEPNP_IPPE,
      new cv.Mat(), new cv.Mat(), errs,
    );
  } catch (e) {
    ok = false;
  }

  const solutions = [];
  if (ok && rvecs.size() > 0) {
    for (let i = 0; i < rvecs.size(); i++) {
      const rvec = rvecs.get(i);
      const tvec = tvecs.get(i);
      const R = new cv.Mat();
      cv.Rodrigues(rvec, R);
      const Rarr = [
        [R.doubleAt(0, 0), R.doubleAt(0, 1), R.doubleAt(0, 2)],
        [R.doubleAt(1, 0), R.doubleAt(1, 1), R.doubleAt(1, 2)],
        [R.doubleAt(2, 0), R.doubleAt(2, 1), R.doubleAt(2, 2)],
      ];
      const t = [tvec.doubleAt(0, 0), tvec.doubleAt(1, 0), tvec.doubleAt(2, 0)];
      const err = errs.rows > i ? errs.doubleAt(i, 0) : 0;
      solutions.push({ R: Rarr, t, errPx: err });
      R.delete(); rvec.delete(); tvec.delete();
    }
  }

  objMat.delete(); imgMat.delete(); K.delete(); D.delete();
  rvecs.delete(); tvecs.delete(); errs.delete();

  return solutions;
}
```

- [ ] **Step 3: Update the `'track'` reply to include solutions**

The result already merges `chosen` via spread, so `solutions` will flow through. Verify the assembled reply contains `solutions` when detection succeeds.

- [ ] **Step 4: Smoke test the pose path**

In devtools (camera on, cube in frame):

```javascript
const v = document.getElementById('videoPlayer');
const bitmap = await createImageBitmap(v);
const K = [[v.videoWidth, 0, v.videoWidth / 2], [0, v.videoWidth, v.videoHeight / 2], [0, 0, 1]];
import('/js/cvWorker.js').then(async m => {
  const w = new m.default();
  await w.ready();
  const res = await w.track(bitmap, {
    seed: { x: v.videoWidth / 2, y: v.videoHeight / 2 },
    cameraMatrix: K,
    distCoeffs: [0, 0, 0, 0, 0],
  });
  console.log(res);
});
```

Expected: `ok: true` with `solutions: [{R, t, errPx}, ...]` (1 or 2 solutions; IPPE typically returns 2 for planar targets).

- [ ] **Step 5: Commit**

```bash
git add frontend/js/cvWorker.worker.js
git commit -m "cvWorker: solvePnPGeneric IPPE — return both solutions for hysteresis"
```

---

### Task 12: Wire the worker through tracker.js as the new hot loop

**Files:**
- Modify: `frontend/js/main.js` (rip out the old POST-based loop; orchestrate via `tracker.js` + `cvWorker.js` + `poseFilter.js`)
- Modify: `frontend/js/overlayManager.js` (remove pose smoothing — moved to `poseFilter.js`)

This is the biggest single edit. At the end of this task, the browser does everything client-side. The old `apiClient.sendFrame` path is removed in Task 18 (cleanup).

- [ ] **Step 1: Strip pose smoothing out of `overlayManager.js`**

Replace `frontend/js/overlayManager.js:35-88` (the `applyPose` method) with a version that takes already-smoothed pose data:

```javascript
    /**
     * Apply an already-smoothed pose (from poseFilter) to the 3D model.
     * poseData: { R: 3x3 row-major, t: [x,y,z] }
     */
    applyPose(poseData, model) {
        const { R, t } = poseData;

        const targetMat = new THREE.Matrix4();
        targetMat.set(
            R[0][0],  R[0][1],  R[0][2],  t[0],
            -R[1][0], -R[1][1], -R[1][2], -t[1],
            -R[2][0], -R[2][1], -R[2][2], -t[2],
            0,        0,        0,        1
        );

        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const _scale = new THREE.Vector3();
        targetMat.decompose(pos, quat, _scale);

        pos.x += this.calib.dx;
        pos.y += this.calib.dy;
        pos.z += this.calib.dz;

        const renderQuat = this.levelLock ? new THREE.Quaternion() : quat;

        const m = new THREE.Matrix4();
        m.compose(pos, renderQuat, new THREE.Vector3(1, 1, 1));

        const sz = CUBE_SIDE_LENGTH * this.calib.scale;
        const scaleMatrix = new THREE.Matrix4();
        scaleMatrix.makeScale(sz, sz, sz);

        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(m, scaleMatrix);

        model.matrixAutoUpdate = false;
        model.matrix.copy(finalMatrix);
        model.matrixWorldNeedsUpdate = true;
    }
```

Also delete the `_smoothedPos`, `_smoothedQuat`, `POSE_TRANS_SMOOTHING`, and `POSE_ROT_SMOOTHING` references at the top of the file. The `reset()` method becomes a no-op (keep it; called externally).

- [ ] **Step 2: Replace `main.js`'s tracking loop with the worker-driven loop**

In `frontend/js/main.js`:

1. Remove imports of `ApiClient` and the constants `MIN_FRAME_INTERVAL_MS`, `MAX_FRAME_JUMP_PX`, `MAX_REJECT_STREAK`, `MAX_DRIFT_FROM_CLICK_PX` (the last three move to `tracker.js` / constants object).
2. Add imports:

```javascript
import CvWorker from './cvWorker.js';
import { TrackerStateMachine, STATES } from './tracker.js';
import { selectIppeSolution, StillDetector, PoseSmoother } from './poseFilter.js';
```

3. In the `App` constructor, replace `this.apiClient = new ApiClient();` with:

```javascript
this.cvWorker = new CvWorker();
this.tracker = new TrackerStateMachine();
this.stillDetector = new StillDetector();
this.poseSmoother = new PoseSmoother();
this._prevR = null;
this._prevCorners = null;
this._cameraIntrinsics = null; // set after Task 17 (calibration). Falls back to heuristic.
```

4. Replace `_startTracking()` / `_trackingLoop()` with a worker-driven version. Replace the body of `_trackingLoop` with:

```javascript
async _trackingLoop() {
    await this.cvWorker.ready();

    const videoEl = document.getElementById('videoPlayer');
    const step = async () => {
        if (!this.tracking) return;
        this.frameCount += 1;
        const loopStart = performance.now();

        try {
            const bitmap = await createImageBitmap(videoEl);
            const intrinsics = this._effectiveIntrinsics(bitmap.width, bitmap.height);
            const seed = this.tracker.target || { x: bitmap.width / 2, y: bitmap.height / 2 };

            const res = await this.cvWorker.track(bitmap, {
                seed,
                prevCorners: this._prevCorners,
                cameraMatrix: intrinsics.K,
                distCoeffs: intrinsics.distCoeffs,
            });

            this._recordLatency(performance.now() - loopStart);

            if (!res.ok || !res.solutions || res.solutions.length === 0) {
                this.tracker.send('detectFail');
                this.failCount += 1;
                this._showStatus(this.tracker.state === STATES.lost
                    ? 'cube lost — searching…'
                    : 'cube not visible');
            } else {
                // Drift check
                if (this.tracker.originalClick) {
                    const dx = res.centroid.x - this.tracker.originalClick.x;
                    const dy = res.centroid.y - this.tracker.originalClick.y;
                    if (Math.hypot(dx, dy) > 250) {
                        this.tracker.send('drift');
                        this._showStatus('detection drifted from click — re-click to recover');
                        this._drawDetectorDebug(null, null);
                        this._scheduleNext(loopStart, step);
                        return;
                    }
                }

                const chosen = selectIppeSolution(res.solutions, this._prevR ? { R: this._prevR } : null);

                // Distance sanity
                const dist = Math.hypot(chosen.t[0], chosen.t[1], chosen.t[2]);
                if (dist < 0.08 || dist > 3.0) {
                    this.tracker.send('detectFail');
                    this.failCount += 1;
                    this._showStatus('pose distance out of range — frame rejected');
                } else {
                    this.tracker.send('detectOk', { centroid: res.centroid });
                    this.successCount += 1;
                    this._prevR = chosen.R;
                    this._prevCorners = res.corners;

                    const stillOut = this.stillDetector.update({ R: chosen.R, t: chosen.t }, res.centroid);
                    const smoothed = this.poseSmoother.update(stillOut.pose);

                    this.lastResult = {
                        success: true,
                        rotation_matrix: smoothed.R,
                        translation_vector: smoothed.t,
                        image_points: res.corners,
                        detection_method: 'client_floodfill',
                    };
                    this.overlayManager.applyPose(smoothed, this.sceneManager.getCube());
                    this.sceneManager.getCube().visible = true;
                    this._drawDetectorDebug(res.corners, null);
                    this._showStatus(stillOut.isStill ? 'cube locked · still' : 'cube locked');
                }
            }
        } catch (err) {
            this.lastError = err.message;
            this._showError('tracking error: ' + err.message);
            this._stopTracking();
            return;
        }

        this._recordFrameTime();
        this._renderDebugPanel();
        this._updateViewportHeader();
        this._scheduleNext(loopStart, step);
    };

    step();
}

_scheduleNext(loopStart, fn) {
    // Use rVFC if available — perfectly synced to camera frame delivery.
    const videoEl = document.getElementById('videoPlayer');
    if ('requestVideoFrameCallback' in videoEl) {
        videoEl.requestVideoFrameCallback(() => { if (this.tracking) fn(); });
    } else {
        const elapsed = performance.now() - loopStart;
        const wait = Math.max(0, 33 - elapsed); // ~30 fps
        setTimeout(() => { if (this.tracking) fn(); }, wait);
    }
}

_effectiveIntrinsics(w, h) {
    if (this._cameraIntrinsics) return this._cameraIntrinsics;
    // Heuristic fallback (matches old backend behavior).
    const fScale = this.sceneManager.isReady() ? this.sceneManager.getFocalScale() : 1.0;
    const f = w * fScale;
    return {
        K: [[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]],
        distCoeffs: [0, 0, 0, 0, 0],
    };
}
```

5. Replace `_onViewportClick` to also call `this.tracker.send('click', { x, y })` and `this._clearTarget` to call `this.tracker.send('clearTarget')`. Delete the now-unused `this.target`, `this.originalClick`, `this.rejectStreak` instance fields — read from `this.tracker.target` instead.

- [ ] **Step 3: Update `index.html` telemetry**

Change `frontend/index.html:88` from `<dt>Solver</dt><dd>IPPE_SQUARE</dd>` to `<dt>Solver</dt><dd>IPPE (client-side)</dd>`.

- [ ] **Step 4: End-to-end manual smoke**

`docker compose up --build`. Open `http://localhost:3000`. Start Camera, Start Tracking, click cube. Expect:

- Worker boots within ~2s of opening the page.
- Cube overlay renders and follows the physical cube.
- FPS in the viewport header reads > 20 (typically 30+).
- No "Cannot connect to backend" errors (backend isn't called for tracking now).
- Still-frame detection visibly stabilizes the overlay after ~1s of holding the cube steady.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/main.js frontend/js/overlayManager.js frontend/index.html
git commit -m "tracking: client-side hot loop via OpenCV.js worker + poseFilter"
```

---

## Phase 3 — Camera calibration (slim backend + UI)

---

### Task 13: Backend — replace pose endpoint with calibration endpoint

**Files:**
- Modify: `backend/api/routes.py` (replace contents)
- Modify: `backend/models/schemas.py` (replace contents)
- Modify: `backend/config.py` (trim)
- Create: `backend/services/camera_calibrator.py`

- [ ] **Step 1: Trim `backend/config.py`**

Replace the whole file with:

```python
# backend/config.py
"""Configuration for AR cube backend (calibration only)."""

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB per frame
ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"]

# Default chessboard pattern (inner corners on a 10×7 squares board).
DEFAULT_PATTERN_SIZE = (9, 6)
DEFAULT_SQUARE_SIZE_MM = 25.0

MIN_FRAMES_FOR_CALIBRATION = 6
MAX_FRAMES_FOR_CALIBRATION = 30
```

- [ ] **Step 2: Replace `backend/models/schemas.py`**

```python
# backend/models/schemas.py
"""Pydantic models for the calibration API."""

from typing import List, Optional
from pydantic import BaseModel


class CalibrationResponse(BaseModel):
    success: bool
    camera_matrix: Optional[List[List[float]]] = None
    dist_coeffs: Optional[List[float]] = None
    reproj_err_px: Optional[float] = None
    frames_used: Optional[int] = None
    error_message: Optional[str] = None
```

- [ ] **Step 3: Create `backend/services/camera_calibrator.py`**

```python
# backend/services/camera_calibrator.py
"""Wraps cv2.calibrateCamera. Takes pre-detected chessboard corners
(client-side detection) plus the image size; returns intrinsics.

Trusting the client's corner detection keeps the backend deterministic
and avoids re-running findChessboardCornersSB server-side.
"""

from typing import List, Tuple, Optional, Dict
import numpy as np
import cv2


def calibrate(
    corners_per_frame: List[List[Tuple[float, float]]],
    pattern_size: Tuple[int, int],
    square_size_mm: float,
    image_size: Tuple[int, int],  # (width, height)
) -> Dict:
    """Run cv2.calibrateCamera.

    Returns a dict with success/camera_matrix/dist_coeffs/reproj_err_px/error_message.
    """
    if len(corners_per_frame) < 4:
        return {"success": False, "error_message": "Need at least 4 frames"}

    cols, rows = pattern_size
    expected = cols * rows
    object_template = np.zeros((expected, 3), dtype=np.float32)
    object_template[:, :2] = np.indices((cols, rows)).T.reshape(-1, 2)
    object_template *= square_size_mm / 1000.0  # to metres

    object_points = []
    image_points = []
    for frame_corners in corners_per_frame:
        if len(frame_corners) != expected:
            return {
                "success": False,
                "error_message": f"Frame has {len(frame_corners)} corners, expected {expected}",
            }
        object_points.append(object_template.copy())
        image_points.append(np.array(frame_corners, dtype=np.float32).reshape(-1, 1, 2))

    try:
        ret, K, dist, _rvecs, _tvecs = cv2.calibrateCamera(
            object_points, image_points, image_size, None, None,
        )
    except cv2.error as e:
        return {"success": False, "error_message": f"calibrateCamera failed: {e}"}

    if not ret:
        return {"success": False, "error_message": "calibrateCamera returned no result"}

    return {
        "success": True,
        "camera_matrix": K.tolist(),
        "dist_coeffs": dist.flatten().tolist(),
        "reproj_err_px": float(ret),
        "frames_used": len(corners_per_frame),
    }
```

- [ ] **Step 4: Replace `backend/api/routes.py`**

```python
# backend/api/routes.py
"""Camera calibration endpoint."""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Tuple

from config import (
    DEFAULT_PATTERN_SIZE,
    DEFAULT_SQUARE_SIZE_MM,
    MIN_FRAMES_FOR_CALIBRATION,
    MAX_FRAMES_FOR_CALIBRATION,
)
from models.schemas import CalibrationResponse
from services.camera_calibrator import calibrate

router = APIRouter()


class CalibrationRequest(BaseModel):
    frames: List[List[Tuple[float, float]]]  # per-frame corner arrays in image px
    frame_width: int
    frame_height: int
    pattern_size: Tuple[int, int] = DEFAULT_PATTERN_SIZE
    square_size_mm: float = DEFAULT_SQUARE_SIZE_MM


@router.post("/api/calibrate-camera", response_model=CalibrationResponse)
async def calibrate_camera_endpoint(req: CalibrationRequest) -> CalibrationResponse:
    n = len(req.frames)
    if n < MIN_FRAMES_FOR_CALIBRATION:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {MIN_FRAMES_FOR_CALIBRATION} frames, got {n}",
        )
    if n > MAX_FRAMES_FOR_CALIBRATION:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_FRAMES_FOR_CALIBRATION} frames, got {n}",
        )

    result = calibrate(
        req.frames,
        req.pattern_size,
        req.square_size_mm,
        (req.frame_width, req.frame_height),
    )
    return CalibrationResponse(**result)
```

- [ ] **Step 5: Run existing tests to confirm the breakage**

Run: `docker compose exec backend python -m pytest tests/ -v` (or local equivalent).
Expected: Old tests fail (imports of deleted services). That's expected; we replace them in Task 14.

- [ ] **Step 6: Commit**

```bash
git add backend/config.py backend/models/schemas.py backend/services/camera_calibrator.py backend/api/routes.py
git commit -m "backend: replace pose endpoint with /api/calibrate-camera"
```

---

### Task 14: Backend — calibrator unit + integration tests (TDD-style)

**Files:**
- Create: `backend/tests/test_calibrator.py`
- Create: `backend/tests/test_api_calibrate.py`

- [ ] **Step 1: Write the calibrator unit tests**

`backend/tests/test_calibrator.py`:

```python
"""Unit tests for the camera_calibrator service using a synthetic chessboard."""

import numpy as np
import pytest
from services.camera_calibrator import calibrate


def make_synthetic_chessboard_corners(
    pattern=(9, 6), square_m=0.025, K=None, image_size=(1280, 720), n_views=8
):
    """Generate ground-truth-projected chessboard corners from known intrinsics."""
    if K is None:
        f = image_size[0]
        K = np.array([[f, 0, image_size[0] / 2], [0, f, image_size[1] / 2], [0, 0, 1]], dtype=np.float64)

    cols, rows = pattern
    obj = np.zeros((cols * rows, 3), dtype=np.float32)
    obj[:, :2] = np.indices((cols, rows)).T.reshape(-1, 2) * square_m

    rng = np.random.default_rng(42)
    views = []
    for _ in range(n_views):
        # Random rotation around Y and tilt around X
        ry = rng.uniform(-0.6, 0.6)
        rx = rng.uniform(-0.4, 0.4)
        Rx = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
        Ry = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
        R = Ry @ Rx
        t = np.array([rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), rng.uniform(0.30, 0.60)])

        pts_cam = (R @ obj.T).T + t
        pts_img = (K @ pts_cam.T).T
        pts_img = pts_img[:, :2] / pts_img[:, 2:3]
        views.append([(float(p[0]), float(p[1])) for p in pts_img])
    return views, K


def test_calibrate_recovers_focal_length():
    views, K_true = make_synthetic_chessboard_corners()
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert result["success"], result.get("error_message")
    fx = result["camera_matrix"][0][0]
    fy = result["camera_matrix"][1][1]
    assert abs(fx - K_true[0, 0]) / K_true[0, 0] < 0.05
    assert abs(fy - K_true[1, 1]) / K_true[1, 1] < 0.05


def test_calibrate_reproj_error_small():
    views, _ = make_synthetic_chessboard_corners()
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert result["success"]
    assert result["reproj_err_px"] < 1.0


def test_calibrate_rejects_too_few_frames():
    views, _ = make_synthetic_chessboard_corners(n_views=2)
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert not result["success"]
    assert "at least" in result["error_message"].lower()


def test_calibrate_rejects_mismatched_corner_count():
    views, _ = make_synthetic_chessboard_corners()
    # Truncate one frame's corners.
    views[0] = views[0][:-1]
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert not result["success"]
    assert "corners" in result["error_message"].lower()
```

- [ ] **Step 2: Run the calibrator tests**

Run: `cd backend && python -m pytest tests/test_calibrator.py -v`
Expected: PASS — 4 tests.

- [ ] **Step 3: Write the API integration tests**

`backend/tests/test_api_calibrate.py`:

```python
"""Integration tests for /api/calibrate-camera."""

from fastapi.testclient import TestClient
from main import app
from tests.test_calibrator import make_synthetic_chessboard_corners

client = TestClient(app)


def test_endpoint_returns_intrinsics_on_valid_input():
    views, _ = make_synthetic_chessboard_corners(n_views=8)
    body = {
        "frames": views,
        "frame_width": 1280,
        "frame_height": 720,
        "pattern_size": [9, 6],
        "square_size_mm": 25.0,
    }
    r = client.post("/api/calibrate-camera", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["success"]
    assert data["camera_matrix"] is not None
    assert len(data["dist_coeffs"]) >= 4


def test_endpoint_rejects_too_few_frames():
    views, _ = make_synthetic_chessboard_corners(n_views=3)
    body = {
        "frames": views,
        "frame_width": 1280,
        "frame_height": 720,
        "pattern_size": [9, 6],
        "square_size_mm": 25.0,
    }
    r = client.post("/api/calibrate-camera", json=body)
    assert r.status_code == 400


def test_endpoint_rejects_too_many_frames():
    views, _ = make_synthetic_chessboard_corners(n_views=35)
    body = {
        "frames": views,
        "frame_width": 1280,
        "frame_height": 720,
        "pattern_size": [9, 6],
        "square_size_mm": 25.0,
    }
    r = client.post("/api/calibrate-camera", json=body)
    assert r.status_code == 400
```

- [ ] **Step 4: Run the integration tests**

Run: `cd backend && python -m pytest tests/test_api_calibrate.py -v`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_calibrator.py backend/tests/test_api_calibrate.py
git commit -m "backend tests: calibration unit + integration coverage"
```

---

### Task 15: Worker — chessboard detection mode

**Files:**
- Modify: `frontend/js/cvWorker.worker.js` (implement `'chessboard'` message)

- [ ] **Step 1: Replace the chessboard placeholder with a real implementation**

In `frontend/js/cvWorker.worker.js`, replace the `case 'chessboard'` block with:

```javascript
case 'chessboard': {
  const result = doChessboardDetection(msg);
  self.postMessage({ type: 'chessboardResult', ...result });
  break;
}
```

- [ ] **Step 2: Add the helper at the bottom of the worker file**

```javascript
function doChessboardDetection(msg) {
  const { bitmap, patternSize } = msg;
  const [cols, rows] = patternSize;
  const oc = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = oc.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  const frame = cv.matFromImageData(imgData);
  const gray = new cv.Mat();
  cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);

  const corners = new cv.Mat();
  let found = false;
  try {
    // Prefer findChessboardCornersSB if available; fall back to findChessboardCorners + subpix.
    if (typeof cv.findChessboardCornersSB === 'function') {
      found = cv.findChessboardCornersSB(gray, new cv.Size(cols, rows), corners);
    } else {
      found = cv.findChessboardCorners(
        gray, new cv.Size(cols, rows), corners,
        cv.CALIB_CB_ADAPTIVE_THRESH | cv.CALIB_CB_NORMALIZE_IMAGE,
      );
      if (found) {
        const term = new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 30, 0.01);
        cv.cornerSubPix(gray, corners, new cv.Size(11, 11), new cv.Size(-1, -1), term);
      }
    }
  } catch (e) {
    found = false;
  }

  let out = null;
  if (found && corners.rows === cols * rows) {
    out = [];
    for (let i = 0; i < corners.rows; i++) {
      out.push([corners.data32F[i * 2], corners.data32F[i * 2 + 1]]);
    }
  }

  frame.delete(); gray.delete(); corners.delete();

  if (!out) return { ok: false, status: 'no_chessboard' };
  return { ok: true, corners: out, status: 'ok' };
}
```

- [ ] **Step 3: Manual smoke test**

Print a 9×6 chessboard pattern. With the camera on, in devtools:

```javascript
const v = document.getElementById('videoPlayer');
const bitmap = await createImageBitmap(v);
import('/js/cvWorker.js').then(async m => {
  const w = new m.default();
  await w.ready();
  const res = await w.chessboard(bitmap, [9, 6]);
  console.log(res);
});
```

Expected: `ok: true` with 54 corners when a printed chessboard is in frame; `ok: false, status: 'no_chessboard'` otherwise.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/cvWorker.worker.js
git commit -m "cvWorker: chessboard corner detection mode"
```

---

### Task 16: Calibration UI — modal, capture loop, diversity gate

**Files:**
- Modify: `frontend/index.html` (add button + modal markup)
- Modify: `frontend/css/styles.css` (modal styles)
- Create: `frontend/js/calibrationUI.js`
- Create: `frontend/assets/checkerboard-9x6-25mm.pdf` (or use existing chessboard if available)

- [ ] **Step 1: Generate the chessboard PDF**

If you don't have one handy, run this Python one-off (delete the script after):

```bash
cat > /tmp/gen_chess.py <<'EOF'
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
sq = 25 * mm
c = canvas.Canvas("/tmp/checkerboard-9x6-25mm.pdf")
c.setPageSize((10 * sq + 20 * mm, 7 * sq + 20 * mm))
ox, oy = 10 * mm, 10 * mm
for r in range(7):
    for col in range(10):
        if (r + col) % 2 == 0:
            c.setFillColorRGB(0, 0, 0)
        else:
            c.setFillColorRGB(1, 1, 1)
        c.rect(ox + col * sq, oy + r * sq, sq, sq, fill=1, stroke=0)
c.save()
EOF
pip install reportlab && python /tmp/gen_chess.py
mkdir -p frontend/assets
cp /tmp/checkerboard-9x6-25mm.pdf frontend/assets/
```

- [ ] **Step 2: Add markup to `frontend/index.html`**

Inside the `.topbar` block, after the `.brand` div and before `.topbar-status`, add:

```html
<div class="topbar-actions">
    <button id="calibrateButton" class="btn btn-secondary" disabled>Calibrate Camera</button>
</div>
```

Before the closing `</div>` of `.app`, add the modal:

```html
<div id="calibrationModal" class="modal hidden" role="dialog" aria-modal="true">
  <div class="modal-card">
    <h2>Camera Calibration</h2>
    <p>Print this checkerboard and hold it up to the camera. Tilt and rotate it slowly until 12 diverse frames are captured.</p>
    <p><a href="assets/checkerboard-9x6-25mm.pdf" download>Download checkerboard (9×6 inner corners, 25 mm squares)</a></p>
    <div class="calib-progress">
      <div class="calib-progress-bar"><div id="calibProgressFill" class="calib-progress-fill"></div></div>
      <div id="calibProgressLabel" class="calib-progress-label">0 / 12</div>
    </div>
    <div id="calibResult" class="calib-result"></div>
    <div class="modal-actions">
      <button id="calibStartButton" class="btn btn-primary">Begin capture</button>
      <button id="calibSaveButton" class="btn btn-primary hidden">Save</button>
      <button id="calibCancelButton" class="btn">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS in `frontend/css/styles.css`** (append):

```css
.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal.hidden { display: none; }
.modal-card { background: #0a0e10; border: 1px solid #1d2a30; padding: 28px 32px; max-width: 520px; color: #cdd9dd; font-family: 'IBM Plex Mono', monospace; }
.modal-card h2 { color: #00ffcc; font-family: 'IBM Plex Sans Condensed', sans-serif; margin: 0 0 16px; letter-spacing: 0.05em; }
.modal-card a { color: #00ffcc; }
.calib-progress { margin: 20px 0; }
.calib-progress-bar { height: 8px; background: #14191c; border: 1px solid #1d2a30; }
.calib-progress-fill { height: 100%; background: #00ffcc; width: 0%; transition: width 0.2s; }
.calib-progress-label { margin-top: 6px; font-size: 13px; color: #6a7a80; }
.calib-result { min-height: 24px; margin: 16px 0; font-size: 13px; }
.modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
.btn-secondary { background: transparent; border: 1px solid #00ffcc; color: #00ffcc; }
.hidden { display: none !important; }
```

- [ ] **Step 4: Create `frontend/js/calibrationUI.js`**

```javascript
/**
 * Calibration UI: drives the modal capture flow.
 *
 * Constructor takes a CvWorker instance and a callback (intrinsics) => void
 * to invoke when calibration succeeds and the user saves.
 */

const TARGET_FRAMES = 12;
const DIVERSITY_PX = 80;          // min translational difference between captures
const DIVERSITY_ANG_RAD = 0.18;   // ~10° rotational difference
const PATTERN_SIZE = [9, 6];
const SQUARE_SIZE_MM = 25.0;

import { angularDistance, quatFromMatrix } from './poseFilter.js';

class CalibrationUI {
  constructor(cvWorker, onSave) {
    this.cvWorker = cvWorker;
    this.onSave = onSave;
    this.modal = document.getElementById('calibrationModal');
    this.startBtn = document.getElementById('calibStartButton');
    this.saveBtn = document.getElementById('calibSaveButton');
    this.cancelBtn = document.getElementById('calibCancelButton');
    this.progressFill = document.getElementById('calibProgressFill');
    this.progressLabel = document.getElementById('calibProgressLabel');
    this.resultEl = document.getElementById('calibResult');

    this.captures = []; // { corners, centroid, R, t }
    this.running = false;
    this._lastResult = null;

    this.startBtn.addEventListener('click', () => this._beginCapture());
    this.saveBtn.addEventListener('click', () => this._save());
    this.cancelBtn.addEventListener('click', () => this.close());
  }

  open() { this.modal.classList.remove('hidden'); this._reset(); }
  close() { this.running = false; this.modal.classList.add('hidden'); }

  _reset() {
    this.captures = [];
    this._lastResult = null;
    this.progressFill.style.width = '0%';
    this.progressLabel.textContent = `0 / ${TARGET_FRAMES}`;
    this.resultEl.textContent = '';
    this.startBtn.classList.remove('hidden');
    this.saveBtn.classList.add('hidden');
  }

  async _beginCapture() {
    this.startBtn.classList.add('hidden');
    this.running = true;
    const videoEl = document.getElementById('videoPlayer');

    while (this.running && this.captures.length < TARGET_FRAMES) {
      const bitmap = await createImageBitmap(videoEl);
      const res = await this.cvWorker.chessboard(bitmap, PATTERN_SIZE);
      if (res.ok && this._isDiverse(res.corners)) {
        this.captures.push({ corners: res.corners });
        this._updateProgress();
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (this.running) await this._submit();
  }

  _isDiverse(corners) {
    if (this.captures.length === 0) return true;
    // Approximate diversity via mean corner position alone (simple and robust enough).
    const mean = corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / corners.length);
    for (const cap of this.captures) {
      const m = cap.corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / cap.corners.length);
      const d = Math.hypot(mean[0] - m[0], mean[1] - m[1]);
      if (d < DIVERSITY_PX) return false;
    }
    return true;
  }

  _updateProgress() {
    const pct = (this.captures.length / TARGET_FRAMES) * 100;
    this.progressFill.style.width = `${pct}%`;
    this.progressLabel.textContent = `${this.captures.length} / ${TARGET_FRAMES}`;
  }

  async _submit() {
    this.progressLabel.textContent = 'Computing intrinsics…';
    const videoEl = document.getElementById('videoPlayer');
    const body = {
      frames: this.captures.map(c => c.corners),
      frame_width: videoEl.videoWidth,
      frame_height: videoEl.videoHeight,
      pattern_size: PATTERN_SIZE,
      square_size_mm: SQUARE_SIZE_MM,
    };
    try {
      const r = await fetch('http://localhost:8000/api/calibrate-camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.success) {
        this.resultEl.textContent = `Calibration failed: ${data.error_message}`;
        return;
      }
      this._lastResult = data;
      this.resultEl.textContent =
        `Reprojection error: ${data.reproj_err_px.toFixed(2)} px · ${data.frames_used} frames used.`;
      this.saveBtn.classList.remove('hidden');
    } catch (err) {
      this.resultEl.textContent = `Calibration error: ${err.message}`;
    }
  }

  _save() {
    if (!this._lastResult) return;
    const videoEl = document.getElementById('videoPlayer');
    const stream = videoEl.srcObject;
    const cameraLabel = stream && stream.getVideoTracks()[0] ? stream.getVideoTracks()[0].label : 'unknown';
    const intrinsics = {
      version: 1,
      cameraLabel,
      K: this._lastResult.camera_matrix,
      distCoeffs: this._lastResult.dist_coeffs,
      errPx: this._lastResult.reproj_err_px,
      capturedAt: new Date().toISOString(),
      frameSize: [videoEl.videoWidth, videoEl.videoHeight],
    };
    localStorage.setItem('arcube.intrinsics', JSON.stringify(intrinsics));
    this.onSave(intrinsics);
    this.close();
  }
}

export default CalibrationUI;
```

- [ ] **Step 5: Wire calibration UI into `main.js`**

In `frontend/js/main.js`:

1. Import: `import CalibrationUI from './calibrationUI.js';`
2. In the constructor, after `this.cvWorker = new CvWorker();`:

```javascript
this.calibrationUI = new CalibrationUI(this.cvWorker, (intrinsics) => {
    this._cameraIntrinsics = { K: intrinsics.K, distCoeffs: intrinsics.distCoeffs };
    this._intrinsicsMeta = { errPx: intrinsics.errPx, label: intrinsics.cameraLabel };
    this._showStatus(`Calibrated · reproj err ${intrinsics.errPx.toFixed(2)} px`);
});
this.calibrateButton = document.getElementById('calibrateButton');
this.calibrateButton.addEventListener('click', () => this.calibrationUI.open());
```

3. Enable the button when the camera is ready — in `_onWebcamReady`, after enabling the tracking button:

```javascript
this.calibrateButton.disabled = false;
```

4. Load any saved intrinsics in `_loadCalibration`:

```javascript
const rawIntr = localStorage.getItem('arcube.intrinsics');
if (rawIntr) {
    try {
        const intr = JSON.parse(rawIntr);
        if (intr.version === 1) {
            this._cameraIntrinsics = { K: intr.K, distCoeffs: intr.distCoeffs };
            this._intrinsicsMeta = { errPx: intr.errPx, label: intr.cameraLabel };
        }
    } catch { /* ignore */ }
}
```

- [ ] **Step 6: End-to-end smoke**

`docker compose up --build`. Open page. Start Camera. Click Calibrate Camera. Hold the printed chessboard at varied angles. After 12 captures, "Reprojection error: X.XX px" appears. Click Save. Restart tracking — the cube should render at the correct scale **without** any `[`/`]` keypresses.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/css/styles.css frontend/js/calibrationUI.js frontend/assets/checkerboard-9x6-25mm.pdf frontend/js/main.js
git commit -m "calibration: chessboard capture UI + intrinsics persistence"
```

---

## Phase 4 — Cleanup, docs, cutover

---

### Task 17: Delete dead backend code

**Files:**
- Delete: `backend/services/click_segment_detector.py`
- Delete: `backend/services/feature_detector.py`
- Delete: `backend/services/aruco_detector.py`
- Delete: `backend/services/pose_estimator.py`
- Delete: `backend/tests/test_api.py`
- Delete: `backend/tests/test_feature_detector.py`
- Delete: `backend/tests/test_pose_estimator.py`

- [ ] **Step 1: Delete the files**

```bash
rm backend/services/click_segment_detector.py
rm backend/services/feature_detector.py
rm backend/services/aruco_detector.py
rm backend/services/pose_estimator.py
rm backend/tests/test_api.py
rm backend/tests/test_feature_detector.py
rm backend/tests/test_pose_estimator.py
```

- [ ] **Step 2: Verify the full backend test suite passes**

Run: `cd backend && python -m pytest tests/ -v`
Expected: `test_calibrator.py` (4) + `test_api_calibrate.py` (3) + `test_image_processor.py` (existing 4) = 11 tests, all PASS.

- [ ] **Step 3: Check the backend still starts cleanly**

Run: `docker compose up --build backend`
Expected: uvicorn boots, `/docs` shows only `POST /api/calibrate-camera`.

- [ ] **Step 4: Commit**

```bash
git add -A backend/
git commit -m "backend: remove pose-estimation services and stale tests"
```

---

### Task 18: Delete dead frontend code + ArUco assets

**Files:**
- Delete: `docs/marker/` (entire directory)
- Modify: `frontend/js/apiClient.js` (rewrite — no more `sendFrame`)
- Modify: `frontend/js/main.js` (remove imports/refs to the old POST path; remove the `target` / `originalClick` / `rejectStreak` fields if not already done in Task 12)
- Modify: `frontend/index.html` (update Endpoint label / debug overlay labels if any reference old behavior)

- [ ] **Step 1: Delete ArUco docs**

```bash
rm -rf docs/marker
```

- [ ] **Step 2: Replace `frontend/js/apiClient.js`**

```javascript
/**
 * API Client — calibration-only (hot loop runs in cvWorker.worker.js).
 */

const API_BASE_URL = 'http://localhost:8000';

class ApiClient {
  async submitCalibration(payload) {
    const r = await fetch(`${API_BASE_URL}/api/calibrate-camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { detail = (await r.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    return r.json();
  }
}

export default ApiClient;
```

(`calibrationUI.js` currently uses `fetch` directly — that's fine; this stub exists in case future code wants a typed wrapper.)

- [ ] **Step 3: Verify Vitest still passes**

Run: `cd frontend && npx vitest run`
Expected: PASS — ~38 tests total across `poseFilter`, `roi`, `tracker`.

- [ ] **Step 4: End-to-end smoke**

`docker compose up --build`. Full flow: start camera → calibrate → start tracking → click cube → cube tracks at 30+ fps with stable rotation.

- [ ] **Step 5: Commit**

```bash
git add -A docs/ frontend/js/apiClient.js frontend/js/main.js frontend/index.html
git commit -m "cleanup: remove ArUco assets and old API client method"
```

---

### Task 19: Update README + HANDOVER

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOVER.md`

- [ ] **Step 1: Rewrite the relevant sections of `README.md`**

Sections to edit:

- **Overview** (line ~7): replace "Each captured frame is sent to a local FastAPI backend" with: "Detection and pose estimation run client-side in a Web Worker via OpenCV.js. A FastAPI backend exists only for chessboard-based camera calibration (one-time, multi-frame batch)."

- **Architecture** diagram: replace with the diagram from `docs/superpowers/specs/2026-05-14-efficiency-stability-design.md`.

- **Project Structure**: regenerate to reflect the new file layout (poseFilter.js, tracker.js, cvWorker.js, cvWorker.worker.js, calibrationUI.js, vendor/, vitest config; deleted services).

- **Setup → Running tests**: add the frontend test command:

```bash
# Backend
docker compose exec backend python -m pytest tests/ -v

# Frontend (host, requires npm install once in frontend/)
cd frontend && npm install && npx vitest run
```

- **Usage → Calibrate**: replace the `[`/`]` keypress instructions with the Calibrate Camera modal flow. Keep `[`/`]` documented as a fallback for users who haven't calibrated yet.

- **Key Design Choices** table: update entries for detection-side (`Hot loop`, `Pose smoothing`, `Detection`) to reflect the new architecture. Add a row for chessboard calibration.

- [ ] **Step 2: Rewrite `docs/HANDOVER.md`**

The current HANDOVER doc is structured as a frank journey log. Add a new top section dated 2026-05-14 titled **"Efficiency & stability pass"** that summarizes:

- Hot loop moved client-side via OpenCV.js + Web Worker.
- IPPE rotation hysteresis added (the rotation twitching fix).
- Sub-pixel corner refinement plumbed in (was configured but unused before).
- HSV floodFill with asymmetric tolerance replaces BGR floodFill.
- Still-frame detection + Markley pose averaging.
- Chessboard calibration UI added; persists intrinsics to localStorage.
- Backend slimmed to ~150 LOC; only `/api/calibrate-camera` survives.
- Frontend test infrastructure introduced via Vitest.

Update the **"What I'd try next"** list to remove items that are now done (rotation hysteresis, camera calibration) and surface the remaining ones:

- Sensor fusion (IMU) for rotation
- Detection-mask debug overlay
- Multi-cube support
- Mobile-optimized UI

Update the **"Tunable parameters cheatsheet"** to list the new frontend constants (in `poseFilter.js` and `cvWorker.worker.js`).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/HANDOVER.md
git commit -m "docs: update README and HANDOVER for the new architecture"
```

---

### Task 20: Final smoke test + tag

**Files:** none (verification only)

- [ ] **Step 1: Full clean rebuild**

```bash
docker compose down
docker compose up --build
```

Expected: backend boots; frontend served on `:3000`; `/docs` exposes only `POST /api/calibrate-camera`.

- [ ] **Step 2: End-to-end manual smoke**

Walk through the checklist from the spec's "Manual smoke test" section:

1. Open `http://localhost:3000`. **Expect:** page loads; "Calibrate Camera" button visible but disabled until camera starts.
2. Start Camera. **Expect:** webcam feed appears; calibrate button enables.
3. Calibrate Camera. **Expect:** modal opens; chessboard download link present; auto-capture proceeds when chessboard is in view; reprojection error < 0.5 px; Save persists intrinsics.
4. Reload the page. **Expect:** intrinsics restored from localStorage (no recalibration needed).
5. Start Tracking → click cube. **Expect:** cube overlay locks; FPS ≥ 25 in viewport header (target 30+).
6. Hold cube still ~5s. **Expect:** overlay completely stabilizes (still-frame averaging).
7. Move cube slowly. **Expect:** overlay follows responsively; no obvious lag.
8. Move cube quickly across frame. **Expect:** overlay tracks; occasional miss is tolerated and recovers.
9. Place cube touching a white surface. **Expect:** overlay stays bounded to cube (HSV tolerance fix).
10. Right-click. **Expect:** target cleared; state returns to `awaiting_click`.

- [ ] **Step 3: Verify backend tests**

Run: `docker compose exec backend python -m pytest tests/ -v`
Expected: 11 tests pass.

- [ ] **Step 4: Verify frontend tests**

Run: `cd frontend && npx vitest run`
Expected: ~38 tests pass.

- [ ] **Step 5: Tag the release**

```bash
git tag -a v0.2.0 -m "Efficiency & stability pass: client-side hot loop, IPPE hysteresis, chessboard calibration"
```

- [ ] **Step 6: (Optional) Commit a stub summary file noting the version cut**

Skip if not needed — the README and HANDOVER updates from Task 19 are sufficient.

---

## Self-Review

**1. Spec coverage:**

| Spec section / requirement | Implemented by |
|----------------------------|----------------|
| Architecture diagram | Task 9 (worker scaffold) + Task 12 (wiring) |
| Frontend module layout | Tasks 2–8 (pure modules), 9 (worker), 16 (calibration UI), 12 (orchestrator slim) |
| Backend slim | Tasks 13, 14, 17 |
| State machine | Task 8 |
| Tracking loop (ROI, HSV floodFill, predicted seed, cornerSubPix) | Task 10 |
| solvePnPGeneric IPPE returning both solutions | Task 11 |
| IPPE hysteresis | Task 3 |
| Still-frame detection + Markley averaging | Tasks 4, 5 |
| EMA + slerp output smoothing | Task 6 |
| Drift-from-click safety net | Task 12 (drift transition in tracker.send('drift')) + Task 8 (state machine) |
| Camera calibration UX | Task 16 |
| Backend `/api/calibrate-camera` | Task 13 |
| Backend calibration tests | Task 14 |
| Worker chessboard mode | Task 15 |
| Tuning parameters as frontend constants | Tasks 2–6 (exported constants), Task 10 (detection constants) |
| Testing: backend pytest | Tasks 13, 14, 17 |
| Testing: frontend Vitest | Tasks 1–8 |
| Manual smoke test | Task 20 |
| Migration order (per spec) | Tasks roughly follow spec's order — slight reorder so the pose pipeline modules exist before the worker wires them in |
| Delete `docs/marker/` | Task 18 |
| Update README + HANDOVER | Task 19 |
| OpenCV.js as Web Worker | Task 9 |
| `localStorage` schema (v1) | Task 16 |
| Predicted seed (constant velocity) | Note: documented in spec but **not** implemented in Task 10 — Task 10 uses last centroid as seed. The spec describes `predicted_seed = last_centroid + velocity`. **Gap.** |

**Gap fix:** I'll patch Task 10 — currently `doTrackDetection` uses the raw `seed` from the message (which is the previous centroid via `this.tracker.target`). The constant-velocity prediction can be done on the main thread before sending: the worker just receives the seed it should use. Patching the main-thread caller is simpler than adding velocity state to the worker.

<a id="patch-velocity"></a>**Inline fix to Task 12, Step 2** — in `_trackingLoop`, before calling `this.cvWorker.track(...)`, replace `const seed = this.tracker.target || { x: bitmap.width / 2, y: bitmap.height / 2 };` with:

```javascript
const target = this.tracker.target || { x: bitmap.width / 2, y: bitmap.height / 2 };
const seed = (this._prevSeed && this.tracker.target)
    ? {
        x: target.x + (target.x - this._prevSeed.x),
        y: target.y + (target.y - this._prevSeed.y),
      }
    : target;
this._prevSeed = { ...target };
```

This applies one-step constant-velocity prediction. Reset `this._prevSeed = null;` on `_stopTracking`, in the `drift` branch, and on click.

**2. Placeholder scan:**
- No "TBD"/"TODO" in any task body. ✓
- No "implement later" / "fill in details". ✓
- All test code is concrete and runnable. ✓
- All file paths are absolute relative to the repo root. ✓

**3. Type consistency:**
- `poseFilter.js` exports used in Task 12 (`selectIppeSolution`, `StillDetector`, `PoseSmoother`) all match exports defined in Tasks 3, 5, 6. ✓
- `tracker.js` `STATES` shape matches usage in Task 12 (referenced as `STATES.lost`). ✓
- `CvWorker.track(bitmap, opts)` signature in Task 9 matches usage in Task 12 (`{ seed, prevCorners, cameraMatrix, distCoeffs }`). ✓
- `cvWorker.worker.js` reply shape `{ ok, corners, centroid, solutions, status }` matches Task 12 consumer. ✓
- `intrinsics.distCoeffs` (array of 5) plumbed consistently from Task 13 backend response → Task 16 `_save` → Task 12 `_effectiveIntrinsics`. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-efficiency-stability.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a plan this size (~20 tasks); keeps main-thread context light and gives you a natural checkpoint between each task.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
