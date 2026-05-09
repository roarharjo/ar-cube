# AR-Cube Handover Document

**Last updated:** 2026-05-09
**Author:** Built collaboratively with Claude Code

This is a frank account of where the project stands, what works, what doesn't, the decisions that were made (some of them mid-flight pivots), and what someone picking this up next would want to know. Read this *with* the README; the README tells you what the system does and how to run it, this tells you the *story* behind it.

---

## TL;DR for whoever picks this up next

- The tool **works** for testing AR overlay accuracy on a 5cm white cube via a webcam, but markerless detection of a featureless white cube is fundamentally a hard problem and the system is engineered as far as it can go on that constraint.
- The **core mechanism is click-to-track**: user clicks the cube once, `cv2.floodFill` segments the connected color region under the click, the centroid then becomes the seed for the next frame. Position tracking is reliable; rotation tracking is inherently noisy.
- The **rendered overlay alignment** depends on a manual calibration system (keyboard nudges) that persists to localStorage. Default focal-length heuristic is approximate; users dial it in once per camera setup.
- 16/16 backend tests pass. Frontend has no automated tests (vanilla JS, no build step).
- ArUco marker support exists in the codebase but is **disabled** because the project requirement was no markers. It's one config-flag flip away if you ever need it.

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
| `config.py` | All tunable constants | `DETECTION_MODE`, `FLOOD_TOLERANCE_*`, `SEGMENT_*`, `MIN/MAX_POSE_DISTANCE_M`. Comments explain trade-offs. |
| `main.py` | FastAPI app | Drops `allow_credentials=True` because it's incompatible with `allow_origins=["*"]`. |
| `api/routes.py` | Single endpoint POST `/api/estimate-pose` | Branches on `DETECTION_MODE`. When `click_segment`, **does not fall back to contour** if click_segment fails — letting it would cause "jumping to other shapes." |
| `services/click_segment_detector.py` | Primary detector | Tries `approxPolyDP` first (sharp 4-vertex polygon), falls back to `minAreaRect` if no clean polygon. Returns a status string for debug visibility. |
| `services/feature_detector.py` | Fallback detector | Otsu + adaptive threshold, generates candidate polys via `approxPolyDP` AND `minAreaRect`, scores by `area × whiteness² × fill_ratio`. Used only when no click yet. |
| `services/aruco_detector.py` | **Inactive** | ArUco fiducial detection. Never called when `DETECTION_MODE = "click_segment"`. Kept for completeness; the marker file at `docs/marker/aruco_id0_4cm.png` works with this. |
| `services/pose_estimator.py` | solvePnP wrapper | Uses `solvePnPGeneric` with `IPPE` (NOT `IPPE_SQUARE` — see "The journey"). Picks lowest-reprojection-error solution. Rejects implausible distances. |
| `models/schemas.py` | Pydantic response | `PoseEstimationResponse` has `image_points`, `candidates` (debug), `detection_method`. |
| `utils/image_processor.py` | JPEG/PNG decode | Trivial. |
| `tests/` | 16 pytest tests | Image processor (4), feature detector (4), pose estimator (4), API integration (4). All pass. |

### Frontend

| File | Purpose | Key things to know |
|------|---------|-------------------|
| `index.html` | Page structure | Topbar, viewport, telemetry sidebar, footer. Uses CSS `:has()` for state-driven styling. |
| `css/styles.css` | All styling | "Optical-bench instrument terminal" aesthetic. IBM Plex Mono. |
| `js/main.js` | Orchestrator | Tracking loop with in-flight throttling. Click handler sets target. Keyboard handler routes calibration nudges. localStorage persistence. Debug overlay rendering on `debugCanvas`. |
| `js/webcamHandler.js` | getUserMedia | Stream into video element, frame extraction to JPEG blob. |
| `js/sceneManager.js` | Three.js scene | Procedural multi-shell wireframe cube. `setFocalScale()` for calibration. No EffectComposer/bloom (caused canvas-transparency issues). |
| `js/apiClient.js` | Fetch wrapper | Sends `target_x/target_y` query params when target is set. |
| `js/overlayManager.js` | Pose application | OpenCV→Three.js coord conversion. Pose smoothing (translation lerp 0.30, rotation slerp 0.15). Manual calibration offset application. `levelLock` toggle. |
| `js/interactionControls.js` | Mouse wheel zoom | Uses CSS `transform: scale()` on `.video-container` so video and overlay scale together (preserves alignment). |

### Docs

- `docs/HANDOVER.md` — this file
- `docs/superpowers/specs/` — design specs (with mid-flight pivot notes)
- `docs/superpowers/plans/` — original implementation plan
- `docs/marker/` — ArUco marker file + generator (currently unused)

---

## Tunable parameters cheatsheet

If a user is having trouble, these are the knobs (mostly in `backend/config.py`):

```
# Click-segment behavior
FLOOD_TOLERANCE_LO/HI = (30, 30, 30)   # color tolerance for floodFill
SEGMENT_MIN_AREA = 250                 # min pixels for a valid segment
SEGMENT_MAX_AREA_RATIO = 0.40          # max % of frame
SEGMENT_SEARCH_RADIUS_PX = 25          # how far from click to retry seeds

# Pose sanity
MIN_POSE_DISTANCE_M = 0.08             # rejects near-pose ambiguity
MAX_POSE_DISTANCE_M = 3.0              # caps far-pose absurdity

# Cube physical
CUBE_SIDE_LENGTH = 0.05                # 5cm — must match physical cube

# Frontend (in main.js / overlayManager.js)
MIN_FRAME_INTERVAL_MS = 100            # 10fps cap
MAX_FRAME_JUMP_PX = 80                 # frame-to-frame rejection
MAX_DRIFT_FROM_CLICK_PX = 250          # cumulative drift rejection
POSE_TRANS_SMOOTHING = 0.30            # translation EMA factor
POSE_ROT_SMOOTHING = 0.15              # rotation slerp factor (lower = smoother but laggier)
```

---

## What I'd try next if you have time

In rough order of expected value vs effort:

### 1. Cross-frame rotation hysteresis (medium effort, high impact on stability)

The IPPE solver returns 2 solutions for the planar 2-fold ambiguity. Currently we pick lowest reprojection error each frame independently. When the two solutions have similar errors, the choice flips and the model "twitches."

**Fix:** Have the frontend send the previous frame's rotation matrix as query params. Backend, when picking between IPPE solutions, scores them by `reproj_error + alpha × angular_distance_to_previous`. Result: rotation hysteresis — solver prefers solutions consistent with the recent past.

This is the single biggest improvement available without adding markers or doing camera calibration.

### 2. Offline camera calibration UI (medium effort, fixes focal-scale guessing)

Add a "Calibrate camera" button. User holds up a printed chessboard pattern in front of the webcam, captures 10-15 frames, and `cv2.calibrateCamera` produces actual intrinsics. Save to localStorage as `cameraMatrix` + `distCoeffs`. Backend uses those instead of the heuristic.

Eliminates the focal-scale tuning step entirely and makes pose distance accurate to ~1mm instead of ~10mm.

### 3. Multi-frame averaging on a still cube (low effort, low impact, nice polish)

Detect "the cube is still" (low velocity in target centroid). Once still, average the pose over 30 frames and lock to it until motion is detected again. Eliminates static jitter entirely.

### 4. ArUco fallback for users who want it (10 minutes)

The code is there. Add a UI toggle "Use marker for higher accuracy" → `DETECTION_MODE = "auto"`. ArUco runs first, falls back to click-segment. Users who happen to have a marker on their cube get bulletproof detection; others get the markerless path.

### 5. Detection visualization improvements (low effort, nice for debugging)

Show the actual flood-fill mask as a faded overlay on the video. Currently we only see the bounding box. Seeing the precise filled region would tell users immediately whether segmentation is bleeding or clamping.

---

## Things deliberately not done (and why)

- **Camera calibration via chessboard.** Out of scope for this internal tool's original spec; manual focal-scale tuning is "good enough" for visual alignment testing. See "What I'd try next."
- **Multi-cube tracking.** Not in spec. Click-segment trivially extends to multiple cubes (one click per cube), but the UI plumbing wasn't worth it.
- **Pose history / playback.** Continuous tracking is sufficient.
- **Saving alignment results / exporting overlay video.** Listed as a non-goal in the original FSD.
- **Mobile-optimized UI.** Listed as a non-goal in the original FSD.

---

## Test status

- **Backend:** 16/16 pytest tests pass. Test the API integration with `pytest tests/test_api.py`.
- **Frontend:** No automated tests. Vanilla JS without a build/test framework. Manual testing only.
- **Smoke test:** `docker compose up --build` → open `http://localhost:3000` → Start Camera → Start Tracking → click cube → press `[` until size matches → done.

---

## Closing notes

If you're picking this up, the system *works* — but plan on calibration time when first deployed on a new webcam (~30 seconds via keyboard nudges). For high-precision tasks, prioritize the camera calibration UI in "What I'd try next." For rotation stability, prioritize cross-frame hysteresis. For the lazy path that solves both at once: enable ArUco markers (`DETECTION_MODE = "auto"`).

The constraint of markerless detection on a featureless white cube was honored throughout. The honest engineering answer is "use markers." If that constraint relaxes for whoever inherits this, ArUco support is ready to go.

Good luck.
