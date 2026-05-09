# AR Cube Overlay Tool

Browser-based tool for testing AR overlay accuracy on a live webcam feed. Point a webcam at a 5cm white cube, click the cube once in the viewport, and the system tracks it continuously, overlaying a glowing procedural 3D cube via OpenCV pose estimation. Includes a manual calibration system (keyboard nudges) so you can dial visual alignment in for your specific webcam without writing camera-calibration code.

## Overview

Continuous tracking loop:

1. Webcam streams live video into the browser
2. User **clicks the cube once** to seed detection (markerless — the click is the disambiguator)
3. Each captured frame is sent to a local FastAPI backend
4. Backend uses `cv2.floodFill` from the click point with color tolerance to segment the connected color region under the click, fits 4 corners to that region, and runs `cv2.solvePnP` (IPPE solver) to recover pose
5. Subsequent frames use the previous detection's centroid as the new flood-fill seed; system follows the cube as it moves
6. Frontend smooths the pose (translation lerp, rotation slerp), applies any user calibration offset, and renders a procedural multi-shell wireframe cube on top of the live video
7. Mouse wheel zooms the entire view (video + overlay) for inspection

The target cube is a **5 × 5 × 5 cm white 3D-printed cube** with **no markers**. Detection is driven by the user's click. The overlay is built procedurally — no model upload required.

The interface is styled as an **optical-bench instrument terminal**: black background, IBM Plex Mono, mint-cyan accent. The viewport shows a viewfinder with pulsing corner registration marks; a `● TRACKING` pill appears when the loop is active; a permanent telemetry sidebar shows live pose and calibration state; the bottom bar reports rolling latency, success rate, and uptime.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    Browser                        │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐  │
│  │ Webcam  │  │ Three.js│  │ Tracking loop    │  │
│  │ <video> │  │ overlay │  │ + calibration    │  │
│  └────┬────┘  └────┬────┘  └────────┬─────────┘  │
│       └────────────┴────────────────┘             │
│                    │                              │
│         JPEG frame │ POST + target hint           │
└────────────────────┼──────────────────────────────┘
                     │
┌────────────────────┼──────────────────────────────┐
│        FastAPI backend (localhost:8000)            │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │ Image    │→ │ click_segment│→ │ Pose solver  │  │
│  │ decode   │  │ (floodFill) │  │ (solvePnP    │  │
│  │          │  │ or contour  │  │  + IPPE)     │  │
│  │          │  │ fallback    │  │ + sanity     │  │
│  │          │  │             │  │ check        │  │
│  └──────────┘  └─────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────┘
```

**Frontend:** Vanilla JavaScript (ES6 modules), Three.js r128 via CDN, IBM Plex Mono / Plex Sans Condensed via Google Fonts. No build step.

**Backend:** FastAPI, OpenCV (headless), NumPy, Pydantic. Stateless — each request processes one frame independently.

## Project Structure

```
ar-cube/
├── docker-compose.yml               # Dev orchestration
├── frontend/
│   ├── Dockerfile                   # nginx-alpine
│   ├── .dockerignore
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── main.js                  # Orchestrator, tracking loop, keyboard, telemetry
│       ├── webcamHandler.js         # getUserMedia + frame capture
│       ├── sceneManager.js          # Three.js scene + procedural cube + focal scale
│       ├── apiClient.js             # fetch wrapper (sends target_x/y if set)
│       ├── overlayManager.js        # Coord conversion + pose smoothing + manual calib
│       └── interactionControls.js   # Mouse wheel zoom (CSS scale on container)
├── backend/
│   ├── Dockerfile                   # python:3.11-slim + opencv deps
│   ├── .dockerignore
│   ├── main.py                      # FastAPI app + CORS
│   ├── config.py                    # All tunable constants
│   ├── api/routes.py                # POST /api/estimate-pose
│   ├── services/
│   │   ├── click_segment_detector.py  # Primary: floodFill from click point
│   │   ├── feature_detector.py        # Fallback: global candidate scoring
│   │   ├── aruco_detector.py          # Inactive (DETECTION_MODE = "click_segment")
│   │   └── pose_estimator.py          # solvePnP (IPPE) + distance sanity
│   ├── models/schemas.py            # Pydantic response model
│   ├── utils/image_processor.py     # JPEG/PNG decode
│   ├── tests/                       # 16 pytest tests
│   └── requirements.txt
├── docs/
│   ├── HANDOVER.md                  # Frank account of state, journey, known issues
│   ├── marker/                      # Inactive — ArUco generator + sample marker
│   └── superpowers/
│       ├── specs/                   # Design specs (with mid-flight pivots noted)
│       └── plans/                   # Implementation plan
└── README.md                        # This file
```

## Setup

### Prerequisites

- Modern browser with `getUserMedia` and CSS `:has()` support (Chrome 105+, Safari 15.4+, Firefox 121+)
- A webcam
- A 5cm white 3D-printed cube (no markers required)
- **Either** Docker Desktop (recommended) **or** Python 3.9+ for a host install

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
# In Docker
docker compose exec backend python -m pytest tests/ -v

# On host
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```

## Usage

1. **Start Camera** — click the button and grant webcam permission.
2. **Position the cube** in front of the webcam.
3. **Start Tracking** — click the toggle.
4. **Click directly on a white face of the cube in the viewport.** This is required. The click seeds `cv2.floodFill` to segment the connected color region you pointed at; the system then tracks that region's centroid frame-to-frame.
5. **Calibrate** — use keyboard shortcuts (below) to nudge the rendered overlay onto the physical cube. Calibration persists in `localStorage` between sessions.
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

**POST** `/api/estimate-pose`

| Param | Location | Description |
|-------|----------|-------------|
| `image` | multipart form | JPEG or PNG frame, max 10 MB |
| `video_width` | query string | Frame width in pixels |
| `video_height` | query string | Frame height in pixels |
| `target_x`, `target_y` | query string (optional) | Click-segment seed point in image px |

Response (200):

```json
{
  "success": true,
  "rotation_matrix": [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]],
  "translation_vector": [tx, ty, tz],
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "image_points": [[x0, y0], [x1, y1], [x2, y2], [x3, y3]],
  "candidates": [{ "corners": [...], "score": 1234.5, "accepted": false, "reason": "rej[poly]:sat=120" }, ...],
  "detection_method": "click_segment",
  "error_message": null
}
```

When the cube isn't detected: `success: false`, `error_message` populated, matrices `null`. HTTP 400/422 for invalid input. The `candidates` field is populated only in contour-fallback mode for debug visualization.

Interactive API docs: `http://localhost:8000/docs`

## Key Design Choices

| Decision | Choice | Why |
|----------|--------|-----|
| Detection (primary) | `cv2.floodFill` with color tolerance from user click | The click is the disambiguator — segmentation is bounded to the connected color region the user pointed at. Eliminates "which white quad is the cube" guessing. |
| Tracking | Previous detection's centroid → next frame's seed | Once initialized, system follows the cube. EMA smoothing (factor 0.4) on the seed for stability. |
| Detection (fallback) | Otsu/adaptive threshold + contour filtering + whiteness/aspect/fill discriminators | Used when user hasn't clicked yet. Unreliable in cluttered scenes. |
| Pose solver | `cv2.SOLVEPNP_IPPE` via `solvePnPGeneric` + min-reprojection-error pick | `IPPE_SQUARE` returned wrong solutions (huge reprojection errors) in our OpenCV 4.13. `IPPE` returns 2 solutions for the planar 2-fold ambiguity; we pick the one with smallest reprojection error and plausible distance. |
| Pose sanity check | Reject if distance < 8cm or > 3m | Catches solvePnP near-pose ambiguity that puts the cube absurdly close to camera. |
| Frame-to-frame validation | Reject detection if centroid jumps > 80px (after 8 consecutive rejects, accept anyway) | Prevents tracking from leaking onto adjacent objects without blocking real fast movements. |
| Drift validation | Reject if target drifts > 250px from original click | Prevents slow drift onto another object frame-by-frame. |
| Pose smoothing | Translation EMA 0.30, rotation slerp 0.15 | Translation stays responsive; rotation noise is the dominant jitter source so it's heavily damped. |
| Manual calibration | Keyboard nudges (`dx, dy, dz, scale, focal_scale`) persisted to localStorage | Cleaner than implementing full camera calibration; one-time visual tune per camera setup. |
| Level lock | Optional toggle to ignore detected rotation | Markerless rotation estimation on a featureless cube is fundamentally noisy. Position-only mode is honest about that. |
| Camera intrinsics | `focal = video_width × focal_scale`, principal point at center | Tunable via `[ / ]` keys. Default 1.0 is a starting heuristic, not a calibration. |
| Tracking cadence | In-flight throttling, ~10 fps cap | Auto-adapts to backend latency without queueing requests. |
| Lost detection | Keep last good pose | Stable visual experience; cube lags rather than blinks off. |
| Zoom | CSS scale on the video container | Preserves AR alignment — video and overlay scale uniformly. |
| Overlay model | Procedural Three.js multi-shell wireframe + corner spheres | No upload step. Glow effect via stacked wireframe shells (avoids EffectComposer/UnrealBloom transparency issues on the overlay canvas). |
| UI aesthetic | Optical-bench instrument terminal | Black field, IBM Plex Mono, hairline borders, mint-cyan accent. Treats video as a sensor feed and data as telemetry. |

## Known Limitations

Markerless detection of a featureless white cube is **fundamentally hard**. The system has been engineered as far as it can go on that constraint; specific limitations are listed honestly:

- **User click is required.** Without a click there's no way to disambiguate the cube from other white objects. This is a feature, not a bug.
- **Detection can spill** if the cube touches a similarly-colored surface (white wall, white desk). Re-click on a fully-bounded cube face.
- **Pose has 4-way rotational symmetry.** A square has no inherent "up" — solvePnP picks one of 4 rotations, possibly off by 90° from your intended orientation.
- **Pose rotation is noisy.** Slight detection corner noise → meaningfully different rotation. The level-lock toggle (`L` key) sidesteps this for use cases that only care about position.
- **Camera intrinsics are heuristic.** Default `focal = video_width` is approximate. Different webcams have different actual focal lengths. Tune via `[ / ]` keys; calibration persists in localStorage.
- **Single camera, single cube.** No multi-camera or multi-cube support.

If detection is unreliable, the parameters in `backend/config.py` to tune are: `FLOOD_TOLERANCE_LO/HI` (color tolerance — wider lets in more variation but risks bleeding into background), `SEGMENT_MIN_AREA` / `SEGMENT_MAX_AREA_RATIO` (size sanity), and `SEGMENT_SEARCH_RADIUS_PX` (how far from the click to search if the exact pixel doesn't seed a usable region).

## Troubleshooting

**Camera permission denied** — click "Start Camera" again to retry. Button re-enables on failure.

**"Cannot connect to backend"** — verify the backend is running on `localhost:8000`. Check the terminal for uvicorn startup output.

**"Click the cube in the viewport to start tracking"** — the system needs your click to know which white object is THE cube.

**Detection drifts off the cube** — flood fill spilled into a similarly-colored surface. Right-click to clear, then re-click in the middle of a clean cube face. If it keeps happening, lower `FLOOD_TOLERANCE_LO/HI` (more conservative segmentation).

**Detection clamps to a tiny region inside the cube** — your click landed on a shadow or speckle. Click again on a more uniformly lit area, or raise `FLOOD_TOLERANCE_LO/HI`.

**`detection drifted from click — re-click to recover`** — the auto-following centroid wandered more than 250px from where you originally clicked. This is the safety net catching slow drift onto other objects. Re-click.

**Cube model never appears** — likely a `matrixWorldNeedsUpdate` issue. `overlayManager.applyPose` must set this flag to `true` after writing to `model.matrix`. (Already fixed; mentioned for future regressions.)

**Cube renders much too big and close to camera** — solvePnP's near-pose ambiguity. Should already be caught by the distance sanity check (< 8cm rejected). If it slips through, tighten `MIN_POSE_DISTANCE_M` in `backend/config.py`.

**Cube position is consistently offset** — your webcam's actual focal length differs from `video_width`. Press `[` repeatedly to reduce `focal_scale` until alignment improves. Save by leaving the page (calibration persists).

**Tracking is jumpy/anxious** — already heavily damped via translation/rotation smoothing. To go further, lower `POSE_ROT_SMOOTHING` in `frontend/js/overlayManager.js` from 0.15 toward 0.05 (more damping, more lag). Or press `L` for level-lock.

## Documentation

- **Handover document:** `docs/HANDOVER.md` — frank account of project state, journey, known issues, what to try next.
- **Design spec:** `docs/superpowers/specs/2026-05-09-ar-cube-phases-3-5-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-05-09-ar-cube-phases-3-5.md`
- **Docker spec:** `docs/superpowers/specs/2026-05-09-docker-dev-setup-design.md`

## License

Internal testing tool — not for production use.
