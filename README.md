# AR Cube Overlay Tool

A browser-based tool for testing AR overlay accuracy and pose estimation on a live webcam feed. Point your webcam at a 5cm white cube, upload a matching 3D model, and the tool tracks the cube continuously and overlays the model in real time using OpenCV pose estimation.

## Overview

The tool runs a continuous tracking loop:

1. Webcam streams live video into the browser
2. Each captured frame is sent to a local FastAPI backend
3. The backend detects the cube via contour analysis + sub-pixel corner refinement, then estimates pose with `cv2.solvePnP`
4. The frontend converts the OpenCV pose to Three.js coordinates and renders the OBJ model on top of the live video
5. Mouse wheel zooms the entire view (video + overlay) for inspection

The target cube is a **5 × 5 × 5 cm white 3D-printed cube** with no markers — detection relies on geometry, not fiducials.

## Architecture

```
┌──────────────────────────────────────────┐
│              Browser                      │
│  ┌─────────┐  ┌────────┐  ┌───────────┐  │
│  │ Webcam  │  │ Three.js│  │ Tracking  │  │
│  │ <video> │  │ overlay │  │ loop      │  │
│  └────┬────┘  └────┬───┘  └─────┬─────┘  │
│       └────────────┴────────────┘        │
│                    │                      │
│         JPEG frame │ POST                 │
└────────────────────┼──────────────────────┘
                     │
┌────────────────────┼──────────────────────┐
│        FastAPI backend (localhost:8000)   │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Image    │→ │ Feature  │→ │ Pose   │  │
│  │ decode   │  │ detector │  │ solver │  │
│  └──────────┘  └──────────┘  └────────┘  │
│     (JPEG)      (Otsu →       (solvePnP, │
│                  contour →     IPPE_     │
│                  cornerSubPix) SQUARE)   │
└──────────────────────────────────────────┘
```

**Frontend:** Vanilla JavaScript (ES6 modules), Three.js r128 + OBJLoader via CDN, no build step.

**Backend:** FastAPI, OpenCV, NumPy, Pydantic. Stateless — each request processes one frame independently.

## Project Structure

```
ar-cube/
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── main.js                  # Orchestrator + tracking loop
│       ├── webcamHandler.js         # getUserMedia + frame capture
│       ├── modelLoader.js           # OBJ upload, parse, normalize
│       ├── sceneManager.js          # Three.js scene/camera/renderer
│       ├── apiClient.js             # fetch wrapper
│       ├── overlayManager.js        # OpenCV → Three.js coord conversion
│       └── interactionControls.js   # Mouse wheel zoom
├── backend/
│   ├── main.py                      # FastAPI app + CORS
│   ├── config.py                    # Constants (cube size, detection params)
│   ├── api/routes.py                # POST /api/estimate-pose
│   ├── services/
│   │   ├── feature_detector.py      # Otsu/adaptive threshold + contour + cornerSubPix
│   │   └── pose_estimator.py        # solvePnP (SOLVEPNP_IPPE_SQUARE)
│   ├── models/schemas.py            # Pydantic response model
│   ├── utils/image_processor.py     # JPEG/PNG decode
│   ├── tests/                       # 16 pytest tests
│   └── requirements.txt
└── docs/superpowers/
    ├── specs/                       # Design spec
    └── plans/                       # Implementation plan
```

## Setup

### Prerequisites

- Python 3.9+ (tested on 3.9.6)
- Modern browser with `getUserMedia` support (Chrome, Firefox, Safari, Edge)
- A webcam
- A 5cm white 3D-printed cube + matching OBJ model

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

The API runs on `http://localhost:8000`.

### Frontend

```bash
cd frontend
python3 -m http.server 3000
```

Open `http://localhost:3000` in your browser. The page must be served over HTTP (not opened as a `file://` URL) for `getUserMedia` to work.

### Running tests

```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v
```

## Usage

1. **Start Camera** — click the button and grant webcam permission. The video feed appears.
2. **Upload OBJ Model** — pick a `.obj` file (max 1 MB). Origin should be at the model's center; scale doesn't matter.
3. **Position the cube** in front of the webcam.
4. **Start Tracking** — click the toggle. The 3D model overlays the live cube and updates continuously.
5. **Inspect** — use the mouse wheel anywhere over the viewer to zoom both video and overlay together.
6. **Stop Tracking** — click the toggle again to pause processing. Webcam stays live.

### What you'll see

- **Cube locked** — overlay tracks the physical cube as you move it
- **Cube not visible** — detection failed for this frame; the overlay holds its last known position rather than disappearing
- **Tracking stopped: …** — the backend connection failed; restart the server and start tracking again

## API

**POST** `/api/estimate-pose`

| Param | Location | Description |
|-------|----------|-------------|
| `image` | multipart form | JPEG or PNG frame, max 10 MB |
| `video_width` | query string | Frame width in pixels |
| `video_height` | query string | Frame height in pixels |

Response (200):

```json
{
  "success": true,
  "rotation_matrix": [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]],
  "translation_vector": [tx, ty, tz],
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "error_message": null
}
```

When the cube isn't detected: `success: false`, matrices `null`, `error_message` populated. HTTP 400/422 for invalid input.

Interactive API docs: `http://localhost:8000/docs`

## Key Design Choices

| Decision | Choice | Why |
|----------|--------|-----|
| Detection | Otsu threshold (primary) + adaptive threshold (fallback) → contour filtering → `cornerSubPix` | White cube has bimodal histograms; Otsu handles them cleanly. Adaptive fallback covers complex lighting. |
| Pose solver | `cv2.SOLVEPNP_IPPE_SQUARE` | Optimal solver for 4 coplanar square corner points |
| Camera intrinsics | Estimated from frame dimensions (focal length = width, principal point = center, no distortion) | Internal tool; calibration would add scope without proportional benefit |
| Tracking cadence | In-flight throttling, ~10 fps cap | Auto-adapts to backend latency without queueing requests |
| Lost detection | Keep last good pose | Stable visual experience; model lags rather than blinks off |
| Zoom | CSS scale on the video container (not Three.js camera) | Preserves AR alignment — video and overlay scale uniformly |

## Known Limitations

- **Plain-white cube on a plain-white background** will likely fail detection (no contrast)
- **Extreme camera angles** can produce too-narrow faces for reliable contour detection
- **Strong perspective** can cause the corner-ordering heuristic to mismatch the fixed 3D point ordering, producing occasional wrong-but-non-`null` poses
- **No camera calibration** — the focal-length heuristic is approximate; absolute distance accuracy is limited
- **Single camera, single cube** — no multi-camera or multi-cube support

If detection is unreliable on your hardware, `backend/services/feature_detector.py` is the place to tune. The detection params live in `backend/config.py`.

## Troubleshooting

**Camera permission denied** — click "Start Camera" again to retry. The button is re-enabled on failure.

**"Cannot connect to backend"** — verify the backend is running on `localhost:8000`. Check the terminal for uvicorn startup output.

**Model loads but doesn't appear** — check the browser console for errors. Verify the OBJ has visible geometry (some exporters produce empty groups).

**Overlay drifts off the cube** — could be a coordinate-conversion or scale issue. Confirm the OBJ is centered at origin, and that `CUBE_SIDE_LENGTH` in `frontend/js/overlayManager.js` matches `backend/config.py` (both 0.05 m).

**Tracking is jumpy or unstable** — try tuning `MIN_FRAME_INTERVAL_MS` in `frontend/js/main.js` (raise it to reduce flicker at the cost of latency) or the detection params in `backend/config.py`.

## Documentation

- **Design spec:** `docs/superpowers/specs/2026-05-09-ar-cube-phases-3-5-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-05-09-ar-cube-phases-3-5.md`

## License

Internal testing tool — not for production use.
