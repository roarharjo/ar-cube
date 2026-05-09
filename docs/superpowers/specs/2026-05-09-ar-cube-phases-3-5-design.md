# AR-Cube Phases 3-5 Design Spec

**Date:** 2026-05-09
**Scope:** Backend pose estimation, frontend 3D system with live webcam, orchestration & integration
**Approach:** Parallel build (backend + frontend 3D), then integration

> **Pivot 2026-05-09:** Original plan used file upload of recorded video. Updated to live webcam feed with continuous tracking. File upload removed entirely. Sections 2-3 below describe the post-pivot frontend.
>
> **Second pivot 2026-05-09:** OBJ model upload removed. The overlay is now a procedurally-built glowing Three.js cube (neon edges + corner markers + bloom postprocessing). `modelLoader.js` deleted. The cube is built inside `sceneManager.js` during `init()`. Postprocessing dependencies (`EffectComposer`, `RenderPass`, `UnrealBloomPass`, etc.) loaded from CDN.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feature detection | Hybrid contour + cornerSubPix | White 3D-printed cube, no markers. Contour detection finds faces, sub-pixel refinement improves pose accuracy |
| Camera intrinsics | Estimated from video resolution | Internal testing tool — focal length = frame width, principal point = center, zero distortion |
| OBJ model origin | Center | User controls the model, will export with center origin |
| OBJ scale | Normalize in pipeline | Scale doesn't matter in OBJ — overlay pipeline normalizes to match solvePnP output |
| Cube dimensions | 5cm x 5cm x 5cm | Physical 3D-printed cube |
| Video source | Live webcam via `getUserMedia` | Replaces file upload — real-time tracking is the primary use case |
| Tracking cadence | In-flight throttling, max ~10 fps | Send next frame only after previous response returns. Auto-adapts to backend latency |
| Lost detection | Keep last good pose | Stable visual experience; model lags rather than blinks off |
| Tracking control | Start/Stop toggle button | User can pause processing while inspecting; webcam preview remains live |
| Camera selection | Default device | No multi-camera picker for v1 |
| Build sequence | Parallel (Approach B) | Backend + frontend 3D built in parallel with defined API contract; integration phase wires them together |

---

## 1. Backend (Phase 3)

### 1.1 Server — `main.py` + `config.py`

- FastAPI application with CORS middleware (all origins for dev)
- Uvicorn on `localhost:8000`
- `config.py` constants:
  - Cube side length: 0.05 (meters)
  - Detection params: threshold values, min/max contour area, polygon approximation epsilon
  - Default camera intrinsic heuristic parameters

### 1.2 API Contract — `POST /api/estimate-pose`

**Input:** Multipart form with `image` field (JPEG blob). Query params: `video_width`, `video_height` (integers, for camera matrix estimation).

**Output (200):**
```json
{
  "success": true,
  "rotation_matrix": [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]],
  "translation_vector": [tx, ty, tz],
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "error_message": null
}
```

On detection failure: `success: false`, `error_message` describes why (e.g. "No cube faces detected").
On invalid input: 400/422 with validation error details.

### 1.3 Schemas — `models/schemas.py`

Pydantic models for the response structure: `PoseEstimationResponse` with `success`, `rotation_matrix`, `translation_vector`, `camera_matrix`, `error_message` fields.

### 1.4 Image Processing — `utils/image_processor.py`

- Decode uploaded JPEG bytes to numpy array (BGR, OpenCV format)
- Validate image dimensions and format
- Convert color spaces as needed

### 1.5 Feature Detection — `services/feature_detector.py`

Pipeline:
1. Convert input frame to grayscale
2. Apply adaptive threshold (handles varying lighting better than global threshold)
3. Find contours with `cv2.findContours`
4. Filter contours: minimum area threshold, polygon approximation via `cv2.approxPolyDP` — keep quadrilaterals (4-vertex polygons)
5. Score candidates by convexity and aspect ratio to identify cube faces
6. Extract corner points from best face(s) — minimum 4 points required for solvePnP
7. Refine corner positions with `cv2.cornerSubPix` for sub-pixel accuracy

Returns: list of 2D image points (corner coordinates), or error if no valid faces found.

### 1.6 Pose Estimation — `services/pose_estimator.py`

1. Define 3D object points: 5cm cube with origin at center. Visible face corners mapped to their 3D coordinates.
2. Build camera intrinsic matrix from video dimensions:
   - `fx = fy = video_width` (reasonable default focal length)
   - `cx = video_width / 2`, `cy = video_height / 2`
   - Distortion coefficients: all zeros
3. Run `cv2.solvePnP` with object points + detected image points + camera matrix
4. Convert rotation vector to 3x3 rotation matrix via `cv2.Rodrigues`
5. Return rotation matrix (3x3) + translation vector (3x1)

---

## 2. Frontend (Phases 4-5, post-pivot)

### 2.0 Webcam Handler — `webcamHandler.js` (replaces `videoHandler.js`)

- Requests camera access via `navigator.mediaDevices.getUserMedia({ video: true })`
- Streams into the existing `<video>` element (autoplay, muted, no controls)
- `extractFrame()` — same JPEG blob output as the previous video handler, but operates on the live stream
- Status indicator: "Camera off" → "Requesting camera…" → "Camera live"
- Dispatches `webcamReady` event with stream dimensions when video metadata loads
- Cleanup: stops stream tracks on page unload
- The original file-upload `videoHandler.js` is removed entirely

### 2.1 Scene Manager — `sceneManager.js`

- `THREE.WebGLRenderer` attached to existing `renderCanvas` element
- Alpha-transparent background (`alpha: true`) so video is visible underneath
- `THREE.PerspectiveCamera` — FOV and aspect ratio derived from video dimensions
- Camera matrix can be updated from backend response via `updateCamera(cameraMatrix)`
- Lighting: ambient light (soft fill) + directional light (depth cues on white model)
- `requestAnimationFrame` render loop
- Exposes: `updateCamera()`, `setModel(mesh)`, `getScene()`, `getCamera()`

### 2.2 Model Loader — `modelLoader.js`

- Uses `THREE.OBJLoader` (loaded via CDN in index.html, Three.js r128)
- File validation: `.obj` extension, max 1MB file size
- On load: normalize geometry scale (fit to unit bounding box), center at origin via `geometry.center()` as safety check
- Updates OBJ status indicator in UI
- Dispatches `modelLoaded` custom event with mesh reference

### 2.3 Overlay Manager — `overlayManager.js`

- Receives backend JSON response (rotation_matrix, translation_vector)
- Coordinate system conversion — OpenCV (Y-down, Z-forward) to Three.js (Y-up, Z-toward-camera):
  - Flip sign of Y and Z rows in rotation matrix
  - Negate Y and Z components of translation vector
- Constructs `THREE.Matrix4` from converted rotation + translation
- Applies to model: `mesh.matrixAutoUpdate = false`, then `mesh.matrix.copy(matrix4)`
- Scale normalization: the OBJ is loaded and normalized to a unit bounding box. A scale factor is then applied to match the cube's physical size (0.05m) in the solvePnP coordinate space. This factor is `cube_side_length / obj_bounding_box_size`.

### 2.4 Interaction Controls — `interactionControls.js`

- Mouse wheel listener on the canvas/viewer area
- Zoom by adjusting camera Z position (not FOV — preserves perspective match with video)
- Clamp zoom range to prevent camera flip or losing the model
- Alignment maintained during zoom (only camera distance changes, not model pose)

---

## 3. Orchestration & Integration (Phase 5)

### 3.1 API Client — `apiClient.js`

- `sendFrame(blob, videoWidth, videoHeight)` — constructs `FormData`, POSTs to `http://localhost:8000/api/estimate-pose?video_width=W&video_height=H`
- Returns parsed JSON on success
- Handles: network errors, fetch failures, non-200 HTTP status, timeout
- Surfaces error messages to the UI status area

### 3.2 Main Orchestrator — `main.js`

Initializes all modules on `DOMContentLoaded` and coordinates the workflow:

**Event wiring:**
1. "Start Camera" click → request webcam access via `webcamHandler`
2. `webcamReady` event → init scene with stream dimensions, enable Start Tracking when model also loaded
3. `modelLoaded` event → add model to scene, enable Start Tracking when webcam also ready
4. "Start Tracking" / "Stop Tracking" button → toggles continuous tracking loop

**Button state logic:**
- "Start Tracking" enabled only when: webcam ready AND model loaded
- Label toggles between "Start Tracking" and "Stop Tracking"

**Tracking loop (in-flight throttling):**
1. Capture frame from webcam stream → JPEG blob
2. POST to `/api/estimate-pose` (no spinner — would flicker; status text instead)
3. If `success`: `overlayManager.applyPose(response)` → updates model pose
4. If `!success` (no cube detected): keep current pose (no visual change)
5. If network error: stop loop, show error
6. As soon as the response returns, schedule the next iteration (cap to ~10 fps via min interval, e.g. 100ms)
7. Loop continues until user clicks "Stop Tracking"

**No spinner during tracking:** the spinner is only shown briefly during initial webcam request. Continuous frame processing uses an unobtrusive status text ("Tracking…" / "Cube not visible").

### 3.3 State Dependency Graph

```
Start Camera click ──► webcamReady ──┐
                                     ├── Start Tracking enabled
Model uploaded ──► modelLoaded ──────┘
                                     │
                          Toggle ──► tracking loop (continuous)
```

---

## 4. Error Handling

| Scenario | Handling |
|----------|----------|
| No cube detected in frame | Backend returns `success: false`. Frontend keeps last pose, updates status text quietly. |
| Backend unreachable | apiClient catches network error, stops tracking loop, shows error |
| OBJ parse failure | modelLoader catches OBJLoader error, shows message, keeps button disabled |
| Webcam permission denied | webcamHandler catches `getUserMedia` rejection, shows error message |
| Webcam not available | Same as denied — error message |

---

## 5. Risk: Detection Reliability

The hybrid contour approach on a plain white cube depends heavily on:
- **Contrast** between cube and background — good contrast needed for threshold to separate cube edges
- **Lighting** — even lighting avoids shadows that create false edges; adaptive threshold mitigates this partially
- **Camera angle** — extreme angles may make faces too narrow for contour detection

This is acceptable for an internal testing tool. If detection proves unreliable with real video, the detection pipeline (`feature_detector.py`) is isolated and can be swapped or tuned without affecting the rest of the system.
