# AR Cube — Efficiency & Stability Pass

**Date:** 2026-05-14
**Status:** Design — awaiting implementation plan
**Supersedes (in part):** `2026-05-09-ar-cube-phases-3-5-design.md`

---

## Motivation

The current AR Cube tool works but has three persistent issues acknowledged in `docs/HANDOVER.md`:

1. **Rotation jitter / "twitching."** Markerless rotation estimation on a featureless square is inherently noisy. The dominant cause is `cv2.solvePnPGeneric(IPPE)` returning two near-equally-scored solutions for the planar 2-fold ambiguity; the choice flips frame-to-frame on similar errors, producing visible bending in the rendered cube.
2. **Detection bleed.** `cv2.floodFill` in BGR space spills into adjacent surfaces of similar brightness (white desk, white paper).
3. **Throughput cap and round-trip latency.** Every frame is JPEG-encoded in the browser, POSTed to FastAPI, decoded with OpenCV, processed, and returned. Loop is capped at ~10 fps via in-flight throttling.

Plus a latent precision problem: camera intrinsics are heuristic (`focal = video_width`), so absolute distance and overlay scale require manual `[`/`]` keypress calibration.

The markerless constraint remains firm — this work attacks the symptoms without adding fiducials.

## Goals

- Reduce rotation jitter substantially when the cube is held still and during slow motion.
- Stop floodFill bleed onto similarly-bright surfaces.
- Raise sustained frame rate to ≥ 30 fps on a typical laptop.
- Eliminate the manual focal-scale guess via a proper camera-calibration UI.
- Keep the project's "markerless, internal testing tool" identity intact.

## Non-goals

- Adding markers (ArUco code can stay disabled or be removed; not in scope to re-enable).
- Multi-cube or multi-camera tracking.
- Mobile UI work.
- Sensor fusion (IMU, gyro) — possible future, not now.
- Saving / exporting overlay recordings.

## Approach summary

Three coupled changes:

1. **Move the hot loop to the browser** via OpenCV.js running in a Web Worker. The FastAPI backend is no longer in the per-frame critical path.
2. **Add temporal continuity to the pose pipeline:** rotation hysteresis at IPPE solution selection, sub-pixel corner refinement, predicted ROI cropping, predicted floodFill seed, still-frame detection with multi-frame pose averaging, and lighter output smoothing.
3. **Slim the backend** to one job: chessboard-based camera calibration. Run once per camera, persist intrinsics to `localStorage`, use them in the client-side pose solver.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌─────────┐   ┌──────────────────┐   ┌──────────────────┐   │
│  │ Webcam  │──▶│ OpenCV.js worker │◀─▶│ State machine    │   │
│  │ <video> │   │ (hot loop)       │   │ + tracking ctrl  │   │
│  └─────────┘   └──────────────────┘   └────────┬─────────┘   │
│                          │                     │             │
│                          ▼                     ▼             │
│                  ┌──────────────┐      ┌────────────────┐    │
│                  │ Three.js     │◀─────│ Pose pipeline  │    │
│                  │ overlay      │      │ (hysteresis,   │    │
│                  └──────────────┘      │  still-detect, │    │
│                                        │  smoothing)    │    │
│                                        └────────────────┘    │
└──────────────────────────┬───────────────────────────────────┘
                           │   POST /api/calibrate-camera
                           ▼   (only during calibration; rare)
                  ┌──────────────────────────┐
                  │ Slim FastAPI backend     │
                  │ cv2.findChessboardCorners│
                  │ cv2.calibrateCamera      │
                  └──────────────────────────┘
```

Key decisions:

- **Web Worker for OpenCV.js.** Per-frame CV cost (~5–15ms) on the main thread would starve Three.js rendering. The worker host receives `ImageBitmap` (zero-copy) from the main thread and emits pose events back.
- **No HTTP in the hot loop.** Calibration is a once-per-camera-setup operation that batches ~12 frames in a single POST.
- **Intrinsics persistence in `localStorage`.** Versioned schema; user can recalibrate or fall back to the existing `[`/`]` heuristic if needed.

### Frontend module layout (post-change)

```
frontend/js/
├── main.js                  # Orchestrator (slimmed; tracking loop moves out)
├── webcamHandler.js         # getUserMedia (unchanged)
├── sceneManager.js          # Three.js scene (unchanged)
├── overlayManager.js        # Coord conversion + manual calibration nudges (kept, narrower role)
├── interactionControls.js   # Mouse wheel zoom (unchanged)
├── tracker.js               # NEW — state machine + tracking loop
├── cvWorker.js              # NEW — Web Worker host running OpenCV.js
├── poseFilter.js            # NEW — hysteresis, still-detection, smoothing
├── calibrationUI.js         # NEW — chessboard capture flow
└── apiClient.js             # Slimmed — only calls /api/calibrate-camera now
```

`webcamHandler.js`, `sceneManager.js`, `interactionControls.js` need no changes. `main.js` and `overlayManager.js` shrink because tracking and filtering move out into dedicated modules.

### Backend (slimmed)

```
backend/
├── main.py                  # Unchanged
├── config.py                # ~10 lines: CORS + calibration constants
├── api/routes.py            # ONE endpoint: POST /api/calibrate-camera
├── services/
│   └── camera_calibrator.py # NEW
├── models/schemas.py        # CalibrationResponse only
├── utils/image_processor.py # Kept
└── tests/
    ├── test_calibrator.py
    └── test_api_calibrate.py
```

Deleted: `services/click_segment_detector.py`, `feature_detector.py`, `aruco_detector.py`, `pose_estimator.py`, and their tests. Also delete inactive `docs/marker/` assets.

---

## State machine (frontend `tracker.js`)

```
┌─────┐  start camera   ┌────────────┐  start tracking   ┌─────────────────┐
│idle │────────────────▶│ camera_on  │──────────────────▶│ awaiting_click  │
└─────┘                 └────────────┘                   └────────┬────────┘
                              │                                   │ user clicks cube
                              │ enter calibration                 ▼
                              ▼                            ┌────────────┐
                       ┌──────────────┐    detect OK ┌────▶│  tracking  │
                       │ calibrating  │              │     └──────┬─────┘
                       └──────────────┘              │            │ ≥ 8 consecutive
                                                     │            │   detection fails
                                                     │            ▼
                                                     │      ┌──────────┐
                                                     └──────│   lost   │
                                                            └────┬─────┘
                                                                 │ ≥ M further failures
                                                                 ▼
                                                          awaiting_click
```

State transitions are explicit; no implicit/derived state. Esc / right-click clears target and demotes `tracking`/`lost` back to `awaiting_click`.

---

## Tracking loop (worker)

Per frame, driven by `requestVideoFrameCallback` on the main thread (which sends `ImageBitmap` to the worker):

```
1. Compute ROI:
     if last_corners exists and consecutive_fail < 3:
         roi = expand_bbox(last_corners, factor=1.5), clamped to frame
     else:
         roi = full frame

2. Detect cube face on ROI:
     a. cv.cvtColor(roiBGR, HSV)
     b. predicted_seed = last_centroid + velocity   (one-step constant-velocity)
        clamped to roi
     c. cv.floodFill on HSV with FLOODFILL_FIXED_RANGE and asymmetric tolerance:
            Hue ±10, Sat ±25, Val ±40
        Retry seed in a small spiral (matches existing SEGMENT_SEARCH_RADIUS_PX
        behavior) if first seed yields too-small or empty region.
     d. cv.findContours → largest contour
     e. Reject if area < SEGMENT_MIN_AREA or > SEGMENT_MAX_AREA_RATIO × roi_area
     f. cv.approxPolyDP at several epsilons (0.02, 0.04, 0.06, 0.08); take first
        4-vertex convex result. Fallback to cv.boxPoints(cv.minAreaRect(...)).
     g. cv.cornerSubPix on grayscale ROI with (5,5) window to refine corners to
        sub-pixel accuracy.
     h. Translate corners from ROI coordinates back to full-frame coordinates.

3. If detect failed:
     consecutive_fail++
     if consecutive_fail == 3:  expand to full frame next iteration
     if consecutive_fail == 8:  transition to `lost`
     reuse last good smoothed pose for display (cube lags, doesn't blink)

4. If detect succeeded:
     consecutive_fail = 0
     solutions = cv.solvePnPGeneric(objPts, corners, K, distCoeffs, IPPE)
     # Returns up to 2 solutions for the planar 2-fold ambiguity.

     scored = []
     for (R, t, err_px) in solutions:
         angDist = angular_distance(R, prev_filtered_pose.R)   # radians; ∞ if no prev
         score   = err_px + ALPHA_HYSTERESIS * angDist
         scored.append((score, R, t, err_px))
     R, t, err_px = argmin(score)

     # Distance sanity (moved from backend config to frontend constants)
     if not (MIN_POSE_DISTANCE_M ≤ |t| ≤ MAX_POSE_DISTANCE_M):
         treat as detect failure (consecutive_fail++)
     else:
         poseFilter.update(R, t, centroid)
         emit { pose, status: "tracking" } to main thread

5. Drift-from-click safety net (preserved from current behavior):
     drift_px = |centroid - original_click_point|
     if drift_px > MAX_DRIFT_FROM_CLICK_PX:
         transition to `awaiting_click`
         emit { status: "drifted" } so the UI prompts a re-click
```

The single worker runs in one of two modes at any time: `tracking` (the loop above) or `calibrating` (chessboard-corner detection only, used by the calibration UI — see "Camera calibration"). The main thread switches the worker between modes via a control message; only one mode is active at a time.

### Why each piece matters

| Change | Addresses |
|--------|-----------|
| ROI cropping | Throughput (10× fewer pixels to process) |
| HSV floodFill with asymmetric tolerance | Bleed onto similarly-bright surfaces |
| Predicted seed (constant velocity) | Tracking continuity during motion |
| `cornerSubPix` refinement | Rotation precision (corner noise → rotation noise) |
| IPPE hysteresis (`ALPHA_HYSTERESIS`) | "Twitching" — frame-to-frame solution flipping |

`cornerSubPix` parameters were already defined in `backend/config.py:69-73` but never wired into the floodFill path. This work fixes that.

---

## Pose filter (`poseFilter.js`)

Three layers, applied in order:

### Layer 1: IPPE selection with hysteresis

Implemented inline in the loop above. Tunable:

```
ALPHA_HYSTERESIS = 1.0     # px-reproj-equivalent per radian of angular distance
                           # 5° angular cost ≈ 1px reproj cost at α=1.0
                           # Higher α = stickier rotation; lower = faster reaction
```

### Layer 2: Still-frame detection + multi-frame averaging

```
velocity_px = |centroid_t - centroid_{t-1}|
is_still   = (velocity_px < 2.0) maintained for 10 consecutive frames

if is_still:
    pose_buffer.push({ R, t })          # ring buffer, size 30
    R_out = quaternion_average(pose_buffer.R)    # Markley method
    t_out = mean(pose_buffer.t)
else:
    pose_buffer.clear()
    R_out, t_out = R, t
```

Quaternion averaging uses the Markley method: build the 4×4 symmetric accumulation matrix `M = Σ qᵢqᵢᵀ` and take the eigenvector of the largest eigenvalue. This is the principled mean on SO(3) for clustered rotations.

### Layer 3: Output smoothing (EMA / slerp)

```
trans_out = lerp(prev_trans_out, t_out, POSE_TRANS_SMOOTHING)
rot_out   = slerp(prev_rot_out,  R_out, POSE_ROT_SMOOTHING)

POSE_TRANS_SMOOTHING = 0.50      # was 0.30 — more responsive
POSE_ROT_SMOOTHING   = 0.40      # was 0.15 — much more responsive
```

Today's damping values are masking jitter at the cost of lag. Layers 1 and 2 absorb the noise; Layer 3 can be much lighter.

---

## Camera calibration

### UX

1. User clicks **Calibrate Camera** in the topbar (visible whenever camera is on).
2. Modal opens with a **Download checkerboard PDF** link (9×6 inner corners, 25mm squares; fits on letter / A4).
3. User clicks **Begin capture**. Worker switches to chessboard mode: each frame runs `cv.findChessboardCornersSB`; corners are overlaid live.
4. Auto-capture triggers when:
   - Corners are found, and
   - Pose differs sufficiently from previously captured poses (rotational and translational diversity gate — prevents user from holding still and getting useless data).
5. Progress bar fills as 12 diverse frames accumulate. Cancel button available.
6. On reaching 12 frames, capture stops. Frontend POSTs JPEGs + corner pixel arrays to `/api/calibrate-camera`.
7. Backend runs `cv2.calibrateCamera`. Returns `{ camera_matrix, dist_coeffs, reproj_err_px }`.
8. UI displays result: "Calibrated. Reprojection error: 0.31 px." User clicks **Save** or **Recapture**.
9. On save, intrinsics persist to `localStorage`:

```json
{
  "version": 1,
  "cameraLabel": "FaceTime HD Camera (Built-in)",
  "K": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "distCoeffs": [k1, k2, p1, p2, k3],
  "errPx": 0.31,
  "capturedAt": "2026-05-14T10:32:00Z",
  "frameSize": [1280, 720]
}
```

10. Hot loop immediately uses the new intrinsics. `[`/`]` heuristic hides when calibrated; reappears on **Recalibrate** or camera label change.

### Backend endpoint

`POST /api/calibrate-camera`

Request: `multipart/form-data` with 12 JPEG frames + a JSON sidecar containing the per-frame corner pixel arrays (from `findChessboardCornersSB` already run client-side) + `frame_width`, `frame_height`, `pattern_size_inner_corners` (default `[9, 6]`), `square_size_mm` (default `25`).

Sending corners with the frames keeps the backend deterministic and avoids re-running corner detection server-side; the backend trusts the client and runs only `cv2.calibrateCamera`.

Response:

```json
{
  "success": true,
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "dist_coeffs": [k1, k2, p1, p2, k3],
  "reproj_err_px": 0.31,
  "frames_used": 12,
  "error_message": null
}
```

On failure (insufficient corners, calibration didn't converge, etc.): `success: false`, `error_message` populated.

### Diversity gating (client-side, before capture)

A captured frame is "diverse enough" relative to prior captures if:
- mean translational distance to nearest prior pose > 5 cm, **and**
- angular distance to nearest prior pose > 10°.

Prevents the failure mode where a user holds the chessboard still and burns 12 near-identical captures.

---

## Tuning parameters (frontend constants)

```javascript
// poseFilter.js
const ALPHA_HYSTERESIS       = 1.0;    // px-per-rad-equivalent
const STILL_VELOCITY_PX      = 2.0;
const STILL_FRAMES_REQUIRED  = 10;
const POSE_BUFFER_SIZE       = 30;
const POSE_TRANS_SMOOTHING   = 0.50;
const POSE_ROT_SMOOTHING     = 0.40;

// tracker.js
const ROI_EXPAND_FACTOR        = 1.5;
const FAIL_BEFORE_FULL_FRAME   = 3;
const FAIL_BEFORE_LOST         = 8;
const MIN_POSE_DISTANCE_M      = 0.08;
const MAX_POSE_DISTANCE_M      = 3.0;
const MAX_DRIFT_FROM_CLICK_PX  = 250;   // preserved from current behavior

// detection (passed to worker)
const FLOOD_TOL_H = 10;
const FLOOD_TOL_S = 25;
const FLOOD_TOL_V = 40;
const SEGMENT_MIN_AREA = 250;
const SEGMENT_MAX_AREA_RATIO = 0.40;
const SEGMENT_SEARCH_RADIUS_PX = 25;
const SUBPIX_WIN = 5;
```

These start as constants. If experience says they need to be live-tunable, expose via the existing keyboard nudge system later.

---

## Testing strategy

### Backend (pytest)

- `test_calibrator.py` — synthetic chessboard: generate ideal chessboard images programmatically, run `cv2.findChessboardCornersSB`, feed into the calibration service, assert reprojection error < 0.5 px and returned `fx` matches the synthetic ground truth within 2%.
- `test_api_calibrate.py` — integration tests for the endpoint: valid payload returns 200 + intrinsics; missing frames returns 400; corrupt JPEG returns 400; mismatched frame/corner counts returns 422.

Target: 6–10 tests. Existing 16 tests are deleted alongside the deleted services.

### Frontend (Vitest, new infrastructure)

- `poseFilter.test.js` — `angular_distance`, IPPE hysteresis scorer, quaternion averaging (Markley), still-detection trigger / reset, EMA / slerp smoothing.
- `tracker.test.js` — state-machine transition table (driven by mocked events).
- `roi.test.js` — `expand_bbox`, ROI clamping at frame edges, coordinate translation between ROI and full-frame.

Vitest runs via `npm test`. The runtime build stays no-build (vanilla ESM); Vitest only exists at dev time.

### Manual smoke test

Documented in HANDOVER:

1. `docker compose up --build`
2. Open `http://localhost:3000`, Start Camera, Calibrate Camera, complete capture.
3. Reload, verify intrinsics persisted (no `[`/`]` prompt).
4. Start Tracking, click cube, hold still for ~5 seconds — expect rock-steady overlay.
5. Move cube slowly — overlay tracks without lag.
6. Move cube fast across frame — overlay follows; brief detection lapses tolerated.
7. Place cube touching a white surface — overlay stays bounded to cube (HSV win).
8. Confirm fps ≥ 30 on a typical laptop (Chrome devtools performance panel).

---

## Migration plan (rough — full plan comes next via writing-plans)

1. Scaffold OpenCV.js loader + Web Worker host. Verify it can decode a frame and run `cv.cvtColor`.
2. Port detection (HSV floodFill + corner refinement + ROI) to the worker. Plumb pose results back to the main thread.
3. Add the pose pipeline (hysteresis → still-averaging → smoothing) in `poseFilter.js`.
4. Build the state machine in `tracker.js`. Wire to UI events.
5. Build the calibration UI and slim backend endpoint.
6. Delete dead backend services (`click_segment_detector`, `feature_detector`, `pose_estimator`, `aruco_detector`) and their tests.
7. Delete `docs/marker/` assets.
8. Update README and HANDOVER to reflect the new architecture.

Each step is independently testable; we cut over to the new path only after step 5 lands and works end-to-end.

---

## Known risks and mitigations

| Risk | Mitigation |
|------|------------|
| OpenCV.js bundle (~8 MB) increases first-load time | Internal testing tool; cached after first load; acceptable. Lazy-load OpenCV.js only after the user clicks Start Tracking. |
| OpenCV.js per-frame compute slower than native | ROI cropping + workers compensate. If we still can't hit 30 fps, fall back to 720p capture before further optimization. |
| `cv.findChessboardCornersSB` not in stock OpenCV.js builds | Verified in 4.x release builds (build matrix includes the SB variant). If missing, fall back to `cv.findChessboardCorners` + `cv.cornerSubPix`. |
| Quaternion averaging numerical stability for noisy poses | Markley method handles clustered rotations well. For ill-conditioned cases, fall back to slerping consecutive poses. |
| Worker / OpenCV.js memory leaks on long sessions | Allocate Mat objects once and reuse; explicitly `.delete()` any per-frame allocations. Monitor in long-session smoke test. |
| Calibration UX confuses users | Inline guidance + auto-capture means users do not need to understand camera calibration math. Reprojection-error display provides honest feedback. |

---

## Out-of-scope follow-ups

Listed for visibility; not part of this work:

- ArUco fallback toggle (`DETECTION_MODE = "auto"`).
- IMU / gyro sensor fusion.
- Detection mask visualization overlay (would help debug spills; nice polish).
- Multi-cube tracking.
- Pose recording / export.

---

## Success criteria

- Sustained ≥ 30 fps on a typical laptop with 720p webcam.
- Visible jitter on a stationary cube reduced to imperceptible (subjective; documented in HANDOVER smoke test).
- Detection no longer spills when cube touches a similarly-bright surface (HSV win).
- No `[`/`]` keypress needed after a one-time chessboard calibration; reprojection error < 0.5 px.
- Backend LOC reduced by ≥ 70% (~600 → ~150).
- 16 backend tests replaced by 6–10 calibration tests; ≥ 8 new frontend unit tests added.
