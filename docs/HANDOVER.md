# AR-Cube Handover Document

**Last updated:** 2026-05-14
**Author:** Built collaboratively with Claude Code

This is a frank account of where the project stands, what works, what doesn't, the decisions that were made (some of them mid-flight pivots), and what someone picking this up next would want to know. Read this *with* the README; the README tells you what the system does and how to run it, this tells you the *story* behind it.

---

## TL;DR for whoever picks this up next

- The tool **works** for testing AR overlay accuracy on a 5cm white cube via a webcam, but markerless detection of a featureless white cube is fundamentally a hard problem and the system is engineered as far as it can go on that constraint.
- The **core mechanism is click-to-track**: user clicks the cube once, `cv.floodFill` (HSV space) segments the connected color region under the click in a Web Worker, the centroid then becomes the seed for the next frame. Position tracking is reliable; rotation tracking is inherently noisy but substantially improved via IPPE hysteresis + Markley averaging.
- The **rendered overlay alignment** uses chessboard-based camera calibration (one-time, persisted to localStorage). Keyboard nudges remain as a fine-tuning fallback.
- 11/11 backend tests pass. 39/39 frontend Vitest tests pass.
- ArUco assets are deleted (project constraint: markerless only).

---

## 2026-05-14 — Efficiency & stability pass

The detection bleed, rotation twitching, and ~10 fps throughput cap have been addressed:

- **Hot loop moved client-side via OpenCV.js + Web Worker.** No more JPEG-encode-POST-decode per frame; OpenCV runs inside a worker thread on the main thread's frame data (`requestVideoFrameCallback` driver).
- **IPPE rotation hysteresis.** `cv.solvePnPGeneric(SOLVEPNP_IPPE)` returns 2 solutions for the planar 2-fold ambiguity. We now pick the one closer to the previous frame's rotation (`reproj_err + α × angular_distance`), which kills the frame-to-frame "twitching" that dominated rotation noise.
- **Sub-pixel corner refinement** (`cv.cornerSubPix`) is now wired into the detection path. Was configured but never plumbed in before.
- **HSV-space floodFill with asymmetric tolerance** replaces BGR floodFill: hue ±10, saturation ±25, value ±40. Stops the cube from bleeding onto white desks / paper.
- **Still-frame detection + Markley pose averaging.** When centroid velocity drops below 2 px/frame for 10 consecutive frames, the pose is averaged over a 30-frame ring buffer (quaternions averaged via the Markley method — eigenvector of `Σ qᵢqᵢᵀ`).
- **Predicted-ROI cropping.** Each frame, we crop to a 1.5× expanded bbox around the previous detection. Combined with worker-side processing, sustained 30+ fps is now realistic on a typical laptop.
- **Chessboard calibration UI.** A new `Calibrate Camera` button opens a modal that auto-captures 12 diverse chessboard frames and POSTs the corners to the backend. `cv2.calibrateCamera` returns intrinsics, which are saved to `localStorage` and used by the client-side solver. No more `[`/`]` keypress focal-scale guessing.
- **Backend slimmed to ~150 LOC.** `/api/estimate-pose` deleted. `services/click_segment_detector.py`, `feature_detector.py`, `pose_estimator.py`, `aruco_detector.py` deleted. `services/camera_calibrator.py` is the only active service.
- **Frontend test infrastructure.** Vitest added (dev-only). 39 unit tests cover the pure modules: `poseFilter.js`, `roi.js`, `tracker.js`.

The original markerless constraint is preserved; ArUco assets in `docs/marker/` are deleted.

---

## Project goal

A browser-based tool for an internal team to test AR overlay accuracy and pose estimation algorithms against a real-world cube. Originally specced for file upload of recorded video; pivoted twice during implementation:

1. **Pivot 1:** File upload → live webcam feed (continuous tracking)
2. **Pivot 2:** OBJ model upload → procedural Three.js cube (no upload UX)

Both pivots are documented in the design spec.

---

## What works well

- **Click-segmentation detection.** When the user clicks the cube on a face with reasonable contrast against its surroundings, `cv2.floodFill` produces a clean mask. Detection is robust to scene clutter because the click is a manual disambiguator.
- **Centroid-following tracking.** As long as detection succeeds each frame, the system tracks the cube smoothly without further user input. Frame-to-frame jump rejection (80px threshold) and drift-from-original-click rejection (250px) catch leakage onto other objects.
- **Position estimate.** Translation from `solvePnP` is consistent and useful for AR overlay testing once focal-scale calibration is dialed in.
- **Manual calibration.** Keyboard nudges (`arrows`, `PgUp/Dn`, `+/−`, `[/]`, `R`, `L`) let users compensate for camera-intrinsic mismatches without writing camera-calibration code. Persists to localStorage. ~30 seconds to calibrate a new webcam.
- **Pose smoothing.** Translation lerps at 0.30, rotation slerps at 0.15 — heavy damping on rotation because that's where IPPE noise dominates. Result: visibly stable overlay even on noisy frames.
- **Level-lock toggle (`L` key).** Forces the rendered cube axis-aligned, ignoring detected rotation. Honest acknowledgment that markerless rotation estimation on a featureless cube is unreliable; gives users a clean position-only mode.
- **UI.** "Optical-bench instrument terminal" aesthetic. Telemetry sidebar, viewfinder reg-marks, runtime footer. Genuinely useful for debugging — every relevant value is visible.
- **Docker dev setup.** `docker compose up --build` and you're running. Source-mounted, hot-reload on backend.

---

## What doesn't work, and why

### Markerless rotation estimation is noisy

For a near-fronto-parallel cube viewed by a wide-FOV webcam, slight pixel-level noise in the detected corners produces meaningfully different rotation candidates each frame. `IPPE` returns 2 solutions for the planar 2-fold ambiguity; we pick the one with smallest reprojection error, but the choice can flip frame-to-frame on similar-error solutions, producing visible "twitching" or "bending" of the rendered cube.

**Mitigation:** heavy rotation smoothing (slerp factor 0.15) and the level-lock toggle. The fundamental issue cannot be fixed without either (a) markers, or (b) corner correspondence hysteresis across frames (requires statefulness — see "What I'd try next").

### Camera intrinsics are heuristic, not calibrated

We assume `focal = video_width`, principal point at center, no distortion. Real webcams (especially wide-angle laptop webcams) often have actual focal lengths around `0.5 × video_width`. This causes solvePnP to compute distances 2× too small, which causes the rendered model to render much closer (and larger) than the physical cube.

**Mitigation:** `focal_scale` keyboard control (`[` and `]`). User dials it in visually until the rendered cube is the right size. A wide-angle laptop webcam typically lands at `f = 0.55–0.65`. Persisted in localStorage.

**Better fix would be:** offline camera calibration via a chessboard pattern (`cv2.calibrateCamera`) + a UI to upload the resulting intrinsics. Out of scope for the current implementation.

### Detection can spill into the background

Flood fill is bounded by `FLOOD_TOLERANCE_LO/HI` in `backend/config.py`. If the cube touches a similarly-colored surface (white wall, white paper on the desk), the segmented region grows unbounded. Mitigations: `MAX_AREA_RATIO = 0.40` rejects whole-image segments; tighter tolerance (try `(15,15,15)` instead of `(30,30,30)`) reduces but doesn't eliminate.

### Detection has 4-way rotational symmetry

A square cube face has no inherent "up." solvePnP picks one of 4 rotations to match the detected corner ordering. The model may render rotated 90° from your physical orientation. Without markers (which carry orientation information by design), this is unfixable.

### "Renders ahead of the cube" perception

Even when calibration is dialed in, occasionally the rendered model appears slightly in front of (or offset from) the physical cube. Causes:

1. **Pose smoothing lag.** Cube moves; smoothed pose lags by a fraction of a second. With slerp factor 0.15 on rotation, lag is most visible when the user rotates the cube quickly.
2. **Cube center vs face center.** The 3D points used for solvePnP are the cube's front-face corners. The pose returned is for the cube center (2.5cm behind the face). Rendering depth is correct geometrically, but visual perception of "where the cube is" can disagree.

---

## The journey (so you understand why the code looks like it does)

### Phase 1-2: as planned

Project structure, video upload UI, video player, frame extraction. Worked, was eventually replaced by webcam.

### Phase 3 (backend): mostly as planned, with two important course-corrections

- **Otsu + adaptive threshold + contour pipeline** built per the spec.
- **Discovered IPPE_SQUARE is broken** in OpenCV 4.13 for our object-points geometry. It returns solutions with reprojection errors of ~1100 pixels and absurdly close distances. **Switched to plain IPPE** which works correctly.
- **Pose distance sanity check** added (`MIN_POSE_DISTANCE_M = 0.08`, `MAX = 3.0`) to reject solvePnP near-pose ambiguity.

### Phase 4-5: the reality check on markerless detection

- Built the contour-based candidate scoring detector (whiteness, aspect, fill ratio).
- It worked on synthetic test images, **failed on real webcam scenes** with multiple white objects.
- Spent a while iterating on filters, scoring formulas, multi-pass thresholding — improvements were incremental and brittle.
- Tried target-hint (click-as-bias) on top of contour — helped a little, didn't solve it.
- **Pivoted to ArUco markers** (worked perfectly, ~5 minutes to ship).
- **User rejected markers** — original requirement was markerless, mid-flight reasoning to add markers was overruled.
- **Pivoted again to click-to-segment** — `cv2.floodFill` with color tolerance from a user click. Eliminates the "which white quad" ambiguity entirely. This is the current primary detection path.
- ArUco code is still in the codebase (`services/aruco_detector.py`), but `DETECTION_MODE = "click_segment"` means it's never invoked.

### Phase 6: stability iterations

After click-segment landed:

- **Frame-to-frame jump rejection** — reject detections > 80px from previous centroid (with N-frame escape valve).
- **Original-click drift rejection** — reject if target wanders > 250px from initial click.
- **Pose smoothing** — translation lerp 0.30, rotation slerp 0.15.
- **Manual calibration system** — keyboard nudges + localStorage persistence.
- **Focal-length scale tuning** — `[/]` keys; was the breakthrough that got the rendered model to the right size.
- **Level-lock toggle** — `L` key to ignore detected rotation. Honest mode for "I just want to test position."

---

## File-by-file orientation

### Backend

| File | Purpose | Key things to know |
|------|---------|-------------------|
| `config.py` | Calibration constants | `MIN/MAX_FRAMES_FOR_CALIBRATION`, `DEFAULT_PATTERN_SIZE`, `DEFAULT_SQUARE_SIZE_MM`. ~10 lines. |
| `main.py` | FastAPI app | Drops `allow_credentials=True` because it's incompatible with `allow_origins=["*"]`. |
| `api/routes.py` | Single endpoint POST `/api/calibrate-camera` | Accepts multipart form with JPEG frames + corner sidecar JSON. Runs `cv2.calibrateCamera`. |
| `services/camera_calibrator.py` | calibrateCamera wrapper | Validates frame count, calls `cv2.calibrateCamera`, returns intrinsics + reprojection error. |
| `models/schemas.py` | Pydantic response | `CalibrationResponse` with `camera_matrix`, `dist_coeffs`, `reproj_err_px`, `frames_used`. |
| `utils/image_processor.py` | JPEG/PNG decode | Trivial. |
| `tests/` | 11 pytest tests | Calibration service (7) + API integration (4). All pass. |

### Frontend

| File | Purpose | Key things to know |
|------|---------|-------------------|
| `index.html` | Page structure | Topbar (+ Calibrate Camera button), viewport, telemetry sidebar, footer. Uses CSS `:has()` for state-driven styling. |
| `css/styles.css` | All styling | "Optical-bench instrument terminal" aesthetic. IBM Plex Mono. |
| `js/main.js` | Orchestrator (slim) | Wires up modules, handles keyboard nudges + localStorage persistence. Tracking loop lives in `tracker.js`. |
| `js/webcamHandler.js` | getUserMedia | Stream into video element. |
| `js/sceneManager.js` | Three.js scene | Procedural multi-shell wireframe cube. `setFocalScale()` for calibration. No EffectComposer/bloom (caused canvas-transparency issues). |
| `js/tracker.js` | State machine | `idle → camera_on → awaiting_click → tracking → lost`. Drives `requestVideoFrameCallback` hot loop. |
| `js/cvWorker.js` | Worker host | Spawns `cvWorker.worker.js`, relays `ImageBitmap` frames in, receives pose events out. |
| `js/cvWorker.worker.js` | OpenCV.js hot loop | HSV floodFill, cornerSubPix, solvePnPGeneric IPPE, ROI management. All CV computation lives here. |
| `js/poseFilter.js` | Pose pipeline | IPPE hysteresis scorer, Markley quaternion averaging, still-frame detection, EMA/slerp output smoothing. |
| `js/calibrationUI.js` | Chessboard capture flow | Modal UI; worker chessboard mode; diversity-gated auto-capture; POST to backend; localStorage persistence. |
| `js/apiClient.js` | Calibration POST wrapper | Slimmed — only calls `POST /api/calibrate-camera` now. |
| `js/overlayManager.js` | Pose application | OpenCV→Three.js coord conversion. Manual calibration offset application. `levelLock` toggle. Pose smoothing removed (now in `poseFilter.js`). |
| `js/interactionControls.js` | Mouse wheel zoom | Uses CSS `transform: scale()` on `.video-container` so video and overlay scale together (preserves alignment). |
| `js/__tests__/` | Vitest unit tests | 39 tests covering `poseFilter.js`, `roi.js`, `tracker.js`. |

### Docs

- `docs/HANDOVER.md` — this file
- `docs/superpowers/specs/` — design specs (efficiency pass + original)
- `docs/superpowers/plans/` — implementation plans

---

## Tunable parameters cheatsheet

If a user is having trouble, these are the knobs:

```
# poseFilter.js (frontend)
ALPHA_HYSTERESIS = 1.0           # px-reproj-equivalent per radian
STILL_VELOCITY_PX = 2.0          # frame velocity threshold for still detection
STILL_FRAMES_REQUIRED = 10       # consecutive low-velocity frames to lock still
POSE_BUFFER_SIZE = 30            # frames in still-state pose buffer
POSE_TRANS_SMOOTHING = 0.50      # EMA factor on translation
POSE_ROT_SMOOTHING = 0.40        # slerp factor on rotation

# cvWorker.worker.js (frontend)
FLOOD_TOL_H = 10                 # HSV floodFill tolerance: hue
FLOOD_TOL_S = 25                 # HSV floodFill tolerance: saturation
FLOOD_TOL_V = 40                 # HSV floodFill tolerance: value
SEGMENT_MIN_AREA = 250           # min pixels for a valid segment
SEGMENT_MAX_AREA_RATIO = 0.40    # max fraction of ROI
SEGMENT_SEARCH_RADIUS_PX = 25    # spiral seed search radius
ROI_EXPAND_FACTOR = 1.5          # how much to expand previous bbox for next frame's ROI
SUBPIX_WIN = 5                   # cornerSubPix window size

# tracker.js (frontend)
FAIL_BEFORE_LOST = 8             # consecutive detection failures → lost state
FAIL_BEFORE_DEMOTE = 30          # further failures in lost → awaiting_click

# main.js (frontend)
MAX_DRIFT_FROM_CLICK_PX = 250    # drift threshold from original click
# distance sanity: 0.08 m – 3.0 m (inline)

# backend/config.py
MIN_FRAMES_FOR_CALIBRATION = 6
MAX_FRAMES_FOR_CALIBRATION = 30
DEFAULT_PATTERN_SIZE = (9, 6)
DEFAULT_SQUARE_SIZE_MM = 25.0
```

---

## What I'd try next if you have time

In rough order of expected value vs effort:

### 1. Detection mask visualization overlay (low effort, nice for debugging)

Show the actual HSV flood-fill mask as a faded overlay on the video. Currently we only see the bounding box. Seeing the precise filled region would tell users immediately whether segmentation is bleeding or clamping.

### 2. IMU / sensor fusion for rotation stability (ambitious)

Even with IPPE hysteresis and Markley averaging, fast rotations still produce momentary jitter. Fusing DeviceOrientation API data with the visual pose could provide a low-latency rotation prior. Experimental — browser IMU access is inconsistent and often locked behind permissions on desktop.

### 3. Multi-cube tracking (plumbing work)

Click-segment trivially extends to multiple cubes (one click per cube), but the UI plumbing — multiple state machines, multiple overlays, multiple pose pipelines — wasn't worth it for this internal tool.

### 4. Mobile-optimized UI

Listed as a non-goal in the original FSD. The UI is desktop-centric (keyboard calibration nudges, large telemetry sidebar). Mobile would need a redesigned calibration flow.

---

## Things deliberately not done (and why)

- **Camera calibration via chessboard.** Out of scope for this internal tool's original spec; manual focal-scale tuning is "good enough" for visual alignment testing. See "What I'd try next."
- **Multi-cube tracking.** Not in spec. Click-segment trivially extends to multiple cubes (one click per cube), but the UI plumbing wasn't worth it.
- **Pose history / playback.** Continuous tracking is sufficient.
- **Saving alignment results / exporting overlay video.** Listed as a non-goal in the original FSD.
- **Mobile-optimized UI.** Listed as a non-goal in the original FSD.

---

## Test status

- **Backend:** 11/11 pytest tests pass (`test_calibrator.py`, `test_api_calibrate.py`). Run via `docker compose exec backend python -m pytest tests/ -v`.
- **Frontend:** 39/39 Vitest tests pass (`poseFilter`, `roi`, `tracker` modules). Run via `cd frontend && npm install && npx vitest run`.
- **Smoke test:** `docker compose up --build` → open `http://localhost:3000` → Start Camera → click Calibrate Camera → complete chessboard capture → Start Tracking → click cube → hold still for ~5 seconds → expect rock-steady overlay.

---

## Closing notes

If you're picking this up, the system *works*. Run Calibrate Camera on first use (takes ~60 seconds with a printed chessboard), then click the cube and track. The major pain points from the original implementation — rotation twitching, floodFill bleed, and the 10 fps cap — are addressed. What remains open is listed honestly in "What I'd try next."

The constraint of markerless detection on a featureless white cube was honored throughout. ArUco assets are removed. The honest engineering answer remains "use markers" for robust rotation; but with IPPE hysteresis + Markley averaging, the markerless path is now substantially better than it was.

Good luck.
