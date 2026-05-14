# AR Cube Overlay Tool

Browser-based tool for testing AR overlay accuracy on a live webcam feed. Point a webcam at a 5cm white cube, click the cube once in the viewport, and the system tracks it continuously, overlaying a glowing procedural 3D cube via OpenCV pose estimation. Includes a manual calibration system (keyboard nudges) so you can dial visual alignment in for your specific webcam without writing camera-calibration code.

## Overview

Continuous tracking loop:

1. Webcam streams live video into the browser
2. User **clicks the cube once** to seed detection (markerless — the click is the disambiguator)
3. A Web Worker running OpenCV.js segments the connected color region under the click via HSV-space `cv.floodFill`, fits 4 corners (refined with `cv.cornerSubPix`), and runs `cv.solvePnPGeneric(SOLVEPNP_IPPE)` to recover pose
4. The pose pipeline (in `poseFilter.js`) picks between IPPE's two solutions using rotation hysteresis (`reproj_err + α × angular_distance_to_previous`), averages over a 30-frame ring buffer when the cube is still, and applies EMA/slerp smoothing
5. Frontend applies any user calibration offset and renders a procedural multi-shell wireframe cube on top of the live video
6. A small FastAPI backend exists only for one-time chessboard-based camera calibration (`POST /api/calibrate-camera`)
7. Mouse wheel zooms the entire view (video + overlay) for inspection

The target cube is a **5 × 5 × 5 cm white 3D-printed cube** with **no markers**. Detection is driven by the user's click. The overlay is built procedurally — no model upload required.

The interface is styled as an **optical-bench instrument terminal**: black background, IBM Plex Mono, mint-cyan accent. The viewport shows a viewfinder with pulsing corner registration marks; a `● TRACKING` pill appears when the loop is active; a permanent telemetry sidebar shows live pose and calibration state; the bottom bar reports rolling latency, success rate, and uptime.

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

**Frontend:** Vanilla JavaScript (ES6 modules), Three.js r128 via CDN, OpenCV.js 4.10.0 (vendored), IBM Plex Mono / Plex Sans Condensed via Google Fonts. No build step for the runtime (Vitest for unit tests only).

**Backend:** FastAPI, OpenCV (headless), NumPy, Pydantic. Handles camera calibration only — one endpoint, stateless.

## Project Structure

```
ar-cube/
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── index.html
│   ├── package.json                # Vitest dev dependency
│   ├── vitest.config.js
│   ├── assets/
│   │   └── checkerboard-9x6-25mm.pdf
│   ├── css/styles.css
│   ├── js/
│   │   ├── main.js                 # Orchestrator (slim)
│   │   ├── webcamHandler.js        # getUserMedia
│   │   ├── sceneManager.js         # Three.js scene
│   │   ├── overlayManager.js       # Coord conversion + manual calibration nudges
│   │   ├── interactionControls.js  # Mouse wheel zoom
│   │   ├── tracker.js              # State machine
│   │   ├── poseFilter.js           # Hysteresis + still-detection + smoothing
│   │   ├── cvWorker.js             # Main-thread worker host
│   │   ├── cvWorker.worker.js      # OpenCV.js hot loop (worker)
│   │   ├── calibrationUI.js        # Chessboard capture flow
│   │   ├── apiClient.js            # Calibration POST wrapper
│   │   └── __tests__/              # Vitest unit tests (poseFilter, roi, tracker)
│   └── vendor/
│       └── opencv.js               # OpenCV.js 4.10.0
├── backend/
│   ├── Dockerfile
│   ├── main.py
│   ├── config.py
│   ├── api/routes.py               # POST /api/calibrate-camera
│   ├── services/
│   │   └── camera_calibrator.py    # cv2.calibrateCamera wrapper
│   ├── models/schemas.py
│   ├── utils/image_processor.py
│   ├── tests/                      # 11 pytest tests
│   └── requirements.txt
├── docs/
│   ├── HANDOVER.md
│   └── superpowers/
│       ├── specs/
│       └── plans/
└── README.md
```

## Setup

### Prerequisites

- Modern browser with `getUserMedia` and CSS `:has()` support (Chrome 105+, Safari 15.4+, Firefox 121+)
- A webcam
- A 5cm white 3D-printed cube (no markers required)
- **Either** Docker Desktop (recommended) **or** Python 3.9+ for a host install, and Node.js 18+ (for running frontend tests; not required for the runtime)

### Option 1: Docker (recommended)

```bash
docker compose up --build
```

First build takes a few minutes (pulls `python:3.11-slim` + `nginx:alpine`, installs OpenCV-headless). Subsequent starts are fast.

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000` (Swagger UI at `/docs`)

Source is volume-mounted, so editing files on your host is reflected in the running containers:

- Backend Python changes auto-reload (uvicorn `--reload`)
- Frontend changes appear after a browser hard-refresh (Cmd+Shift+R)

```bash
docker compose down                                    # stop and remove containers
docker compose logs -f backend                         # tail backend logs
docker compose exec backend python -m pytest tests/    # run tests in container
docker compose up --build                              # rebuild after dependency change
```

### Option 2: Host install

```bash
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py                    # API on http://localhost:8000

# Frontend (separate terminal)
cd frontend
python3 -m http.server 3000       # http://localhost:3000
```

The page must be served over HTTP (not opened as `file://`) for `getUserMedia` to work.

### Running tests

```bash
# Backend
docker compose exec backend python -m pytest tests/ -v
# Or on host:
cd backend && source venv/bin/activate && python -m pytest tests/ -v

# Frontend (host install required once)
cd frontend && npm install && npx vitest run
```

## Usage

1. **Start Camera** — click the button and grant webcam permission.
2. **Position the cube** in front of the webcam.
3. **Start Tracking** — click the toggle.
4. **Click directly on a white face of the cube in the viewport.** This is required. The click seeds `cv.floodFill` (HSV space) to segment the connected color region you pointed at; the system then tracks that region's centroid frame-to-frame.
5. **(Recommended first time)** Click **Calibrate Camera** in the topbar. Print the chessboard from `frontend/assets/checkerboard-9x6-25mm.pdf`. Hold it at varied angles until 12 frames are captured. Reprojection error < 0.5 px is good. Click Save. Intrinsics persist in localStorage and are used automatically by the tracker.

   After calibration, the `[` and `]` keys become an optional fallback for fine-tuning if needed.
6. **Inspect** — mouse wheel zooms both video and overlay together.
7. **Re-click** the cube any time tracking drifts. **Right-click or Esc** clears the target and resets pose smoothing.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Arrow keys** | Nudge model XY by 5mm (Shift = 25mm) |
| **PgUp / PgDn** | Nudge model Z (depth) by 5mm (Shift = 25mm) |
| **+ / −** | Scale model by ±5% |
| **[ / ]** | Adjust focal length scale by ±5% (compensates for FOV mismatch) |
| **L** | Toggle level-lock — render the cube axis-aligned, ignoring detected rotation |
| **R** | Reset all calibration (offsets, scale, focal scale) |
| **Esc** | Clear current target hint |

The telemetry sidebar shows current calibration state, e.g.:

```
calib :: dxyz=(-0.045, 0.012, -0.080) s=1.05 f=0.62 LVL
```

`dxyz` = translation offset (m), `s` = model size multiplier, `f` = focal-length scale, `LVL` appears when level-lock is on.

### Calibration procedure (first time on a new webcam)

1. Press **R** to reset.
2. Click the cube in the viewport.
3. Press **`[`** repeatedly. The model gets larger; watch when its size approximately matches the physical cube. (Wide-angle webcams typically land around `f = 0.55–0.65`.)
4. Use **arrows + PgUp/Dn** to fine-tune position. With focal scale right, these should be small adjustments (a few cm at most).
5. Press **L** if rotation is unstable (rendering picks up small detection noise as tilt). Level-lock keeps the cube axis-aligned and follows position only.
6. Refresh the page — calibration restores from localStorage.

If your `dz` calibration needs more than 10cm to align, your focal length is still off — go back to step 3.

### What you'll see

UI signals while tracking:

- **`● TRACKING` pill** in the top-left of the viewport with a pulsing red dot
- **Corner registration marks turn green** and pulse faster while tracking
- **HUD status overlay** at bottom-left: `cube locked` / `cube not visible` / `detection jumped (N/8)` / `detection drifted from click — re-click to recover`
- **Telemetry sidebar** updates per frame: frame count, FPS, success/fail counts, target, calibration, translation vector, distance, rotation matrix rows, last error
- **Bottom bar** — rolling 10-frame latency average, success rate, session uptime
- **Debug overlay on video** — green polygon + numbered corner dots showing the detected cube face; rejected detection candidates appear as faded yellow polygons with reason labels (only in contour fallback mode)

## API

The backend exposes a single endpoint used only during camera calibration setup.

**POST** `/api/calibrate-camera`

Request: `multipart/form-data` with up to 30 JPEG frames + a JSON sidecar containing per-frame corner pixel arrays (already detected client-side via `cv.findChessboardCornersSB`) + `frame_width`, `frame_height`, `pattern_size_inner_corners` (default `[9, 6]`), `square_size_mm` (default `25`).

Response (200):

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

On failure (insufficient frames, calibration didn't converge, corrupt JPEG): `success: false`, `error_message` populated. HTTP 400/422 for invalid input.

Interactive API docs: `http://localhost:8000/docs`

## Key Design Choices

| Decision | Choice | Why |
|----------|--------|-----|
| Hot loop | OpenCV.js in a Web Worker, browser-side | Eliminates JPEG-encode-POST-decode per frame; sustained 30+ fps realistic on a typical laptop. |
| Detection (primary) | HSV-space `cv.floodFill` with asymmetric tolerance from user click | The click is the disambiguator — segmentation is bounded to the connected color region the user pointed at. HSV (vs BGR) stops bleed onto white desks/paper: hue ±10, sat ±25, val ±40. |
| Tracking | Previous detection's centroid + velocity prediction → next frame's seed | Once initialized, system follows the cube. ROI crops to 1.5× expanded bbox for throughput. |
| Pose solver | `cv.solvePnPGeneric(SOLVEPNP_IPPE)` via OpenCV.js | `IPPE` returns 2 solutions for the planar 2-fold ambiguity; solution is picked by rotation hysteresis score. |
| Pose smoothing | Three layers — IPPE solution hysteresis, still-frame multi-frame averaging (Markley quaternion mean), EMA/slerp output smoothing | Hysteresis kills twitching; Markley averaging eliminates static jitter; lighter output smoothing reduces lag. |
| Camera calibration | Chessboard-based via 12-frame `cv2.calibrateCamera` batch (POST /api/calibrate-camera); intrinsics persisted to localStorage | Replaces `[`/`]` focal-scale guessing. One-time per camera setup; reproj error < 0.5 px is good. |
| Pose sanity check | Reject if distance < 8cm or > 3m | Catches solvePnP near-pose ambiguity that puts the cube absurdly close to camera. |
| Drift validation | Reject if target drifts > 250px from original click | Prevents slow drift onto another object frame-by-frame. |
| Manual calibration | Keyboard nudges (`dx, dy, dz, scale, focal_scale`) persisted to localStorage | Fine-tune fallback after chessboard calibration; arrows, PgUp/Dn, +/−, [/]. |
| Level lock | Optional toggle to ignore detected rotation | Markerless rotation estimation on a featureless cube is fundamentally noisy. Position-only mode is honest about that. |
| Lost detection | Keep last good pose | Stable visual experience; cube lags rather than blinks off. |
| Zoom | CSS scale on the video container | Preserves AR alignment — video and overlay scale uniformly. |
| Overlay model | Procedural Three.js multi-shell wireframe + corner spheres | No upload step. Glow effect via stacked wireframe shells (avoids EffectComposer/UnrealBloom transparency issues on the overlay canvas). |
| UI aesthetic | Optical-bench instrument terminal | Black field, IBM Plex Mono, hairline borders, mint-cyan accent. Treats video as a sensor feed and data as telemetry. |

## Known Limitations

Markerless detection of a featureless white cube is **fundamentally hard**. The system has been engineered as far as it can go on that constraint; specific limitations are listed honestly:

- **User click is required.** Without a click there's no way to disambiguate the cube from other white objects. This is a feature, not a bug.
- **Detection can spill** if the cube touches a similarly-colored surface in HSV space. HSV floodFill is much more resistant than BGR, but extreme overlap (very similar hue + saturation) can still cause issues. Re-click on a fully-bounded cube face.
- **Pose has 4-way rotational symmetry.** A square has no inherent "up" — solvePnP picks one of 4 rotations, possibly off by 90° from your intended orientation. Without markers this is unfixable.
- **Pose rotation can still jitter** during fast motion (IPPE hysteresis and still-averaging help most, but not all, cases). The level-lock toggle (`L` key) sidesteps this for use cases that only care about position.
- **Camera intrinsics need one-time chessboard calibration** for accurate distance/scale. Run Calibrate Camera before first use; intrinsics persist in localStorage.
- **Single camera, single cube.** No multi-camera or multi-cube support.

If detection is unreliable, the parameters to tune are in `frontend/js/cvWorker.worker.js`: `FLOOD_TOL_H/S/V` (HSV color tolerance — wider lets in more variation but risks bleeding), `SEGMENT_MIN_AREA` / `SEGMENT_MAX_AREA_RATIO` (size sanity), and `SEGMENT_SEARCH_RADIUS_PX` (how far from the click to search if the exact pixel doesn't seed a usable region).

## Troubleshooting

**Camera permission denied** — click "Start Camera" again to retry. Button re-enables on failure.

**"Cannot connect to backend"** — verify the backend is running on `localhost:8000`. Check the terminal for uvicorn startup output.

**"Click the cube in the viewport to start tracking"** — the system needs your click to know which white object is THE cube.

**Detection drifts off the cube** — HSV flood fill spilled into a similarly-colored surface. Right-click to clear, then re-click in the middle of a clean cube face. If it keeps happening, lower `FLOOD_TOL_H/S/V` in `frontend/js/cvWorker.worker.js` (more conservative segmentation).

**Detection clamps to a tiny region inside the cube** — your click landed on a shadow or speckle. Click again on a more uniformly lit area, or raise `FLOOD_TOL_S/V`.

**`detection drifted from click — re-click to recover`** — the auto-following centroid wandered more than 250px from where you originally clicked. This is the safety net catching slow drift onto other objects. Re-click.

**Cube model never appears** — likely a `matrixWorldNeedsUpdate` issue. `overlayManager.applyPose` must set this flag to `true` after writing to `model.matrix`. (Already fixed; mentioned for future regressions.)

**Cube renders much too big and close to camera** — solvePnP's near-pose ambiguity. Should already be caught by the distance sanity check (< 8cm rejected). Try running Calibrate Camera for accurate intrinsics.

**Cube position is consistently offset** — run Calibrate Camera for accurate intrinsics. As a quick fallback, `[` / `]` keys adjust focal scale until alignment improves; calibration persists in localStorage.

**Tracking is jumpy/anxious** — IPPE hysteresis + Markley still-averaging handle most jitter. For residual noise, lower `POSE_ROT_SMOOTHING` in `frontend/js/poseFilter.js` from 0.40 toward 0.15 (more damping, more lag). Or press `L` for level-lock.

## Documentation

- **Handover document:** `docs/HANDOVER.md` — frank account of project state, journey, known issues, what to try next.
- **Efficiency & stability design spec:** `docs/superpowers/specs/2026-05-14-efficiency-stability-design.md`
- **Efficiency & stability implementation plan:** `docs/superpowers/plans/2026-05-14-efficiency-stability.md`
- **Original design spec:** `docs/superpowers/specs/2026-05-09-ar-cube-phases-3-5-design.md`

## License

Internal testing tool — not for production use.
