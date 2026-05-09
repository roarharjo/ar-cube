# AR-Cube Phases 3-5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend pose estimation API, frontend 3D rendering system, and orchestration layer to complete the AR overlay pipeline.

**Architecture:** FastAPI backend receives a JPEG frame, detects a white cube via hybrid contour detection + cornerSubPix, estimates pose via solvePnP, and returns rotation/translation. Frontend loads an OBJ model into a Three.js scene overlaid on the video, applies the pose with coordinate conversion, and supports zoom inspection.

**Tech Stack:** Python (FastAPI, OpenCV, NumPy, Pydantic), JavaScript (Three.js r128, OBJLoader, Fetch API), HTML5 Video/Canvas

---

## File Map

### Backend — create all

| File | Responsibility |
|------|----------------|
| `backend/config.py` | Constants: cube dimensions, detection params, camera heuristics |
| `backend/models/schemas.py` | Pydantic response model |
| `backend/utils/image_processor.py` | JPEG bytes → OpenCV numpy array |
| `backend/services/feature_detector.py` | Hybrid contour detection → 2D corner points |
| `backend/services/pose_estimator.py` | solvePnP → rotation matrix + translation vector |
| `backend/api/routes.py` | POST /api/estimate-pose endpoint |
| `backend/main.py` | FastAPI app, CORS, uvicorn entry point |
| `backend/tests/test_image_processor.py` | Tests for image decoding |
| `backend/tests/test_feature_detector.py` | Tests for contour detection |
| `backend/tests/test_pose_estimator.py` | Tests for solvePnP pipeline |
| `backend/tests/test_api.py` | Integration tests for the endpoint |
| `backend/requirements.txt` | Add pytest + httpx (modify existing) |

### Frontend — webcam version (post-pivot)

> **Pivot 2026-05-09:** File upload `videoHandler.js` is being replaced with live webcam capture. Tasks 6-12 below are revised. The original `videoHandler.js` will be deleted.

| File | Responsibility |
|------|----------------|
| `frontend/js/webcamHandler.js` | getUserMedia, stream into video element, frame extraction (replaces videoHandler.js) |
| `frontend/js/sceneManager.js` | Three.js scene, camera, renderer, lighting, render loop |
| `frontend/js/modelLoader.js` | OBJ file validation, loading, normalization |
| `frontend/js/apiClient.js` | Fetch wrapper for backend communication |
| `frontend/js/overlayManager.js` | OpenCV→Three.js coordinate conversion, pose application |
| `frontend/js/interactionControls.js` | Mouse wheel zoom |
| `frontend/js/main.js` | Orchestrator: webcam init, modelLoaded coordination, continuous tracking loop with in-flight throttling |
| `frontend/index.html` | Replace video file input with "Start Camera" button; rename Align button to Start/Stop Tracking; enable pointer-events on renderCanvas |
| `frontend/js/videoHandler.js` | **DELETE** — replaced by webcamHandler.js |

---

## Task 1: Backend Config & Schemas

**Files:**
- Create: `backend/config.py`
- Create: `backend/models/__init__.py`
- Create: `backend/models/schemas.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add test dependencies to requirements.txt**

Add `pytest` and `httpx` (for FastAPI test client) to `backend/requirements.txt`:

```
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
opencv-python>=4.9.0
numpy>=1.26.0
python-multipart>=0.0.6
Pillow>=10.2.0
pydantic>=2.6.0
pytest>=8.0.0
httpx>=0.27.0
```

- [ ] **Step 2: Create virtual environment and install dependencies**

Run:
```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

- [ ] **Step 3: Create config.py**

```python
# backend/config.py
"""Configuration constants for AR cube pose estimation."""

# Cube dimensions (meters)
CUBE_SIDE_LENGTH = 0.05  # 5cm

# 3D object points for one face of the cube (origin at center)
# Front face corners in clockwise order, Z = +half
CUBE_FACE_POINTS_3D = [
    [-CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [-CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
]

# Detection parameters
MIN_CONTOUR_AREA = 500  # Minimum pixel area for a valid contour
MAX_CONTOUR_AREA_RATIO = 0.9  # Max ratio of contour area to image area
APPROX_POLY_EPSILON = 0.02  # Polygon approximation accuracy (fraction of perimeter)
ADAPTIVE_THRESH_BLOCK_SIZE = 11  # Block size for adaptive threshold
ADAPTIVE_THRESH_C = 2  # Constant subtracted from mean

# Corner sub-pixel refinement
CORNER_SUBPIX_WIN_SIZE = (5, 5)
CORNER_SUBPIX_ZERO_ZONE = (-1, -1)
CORNER_SUBPIX_CRITERIA = (3, 100, 0.001)  # (type, maxCount, epsilon)
# type 3 = cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER

# Image constraints
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"]
```

- [ ] **Step 4: Create models directory and schemas**

Create `backend/models/__init__.py` (empty file).

Create `backend/models/schemas.py`:

```python
# backend/models/schemas.py
"""Pydantic models for API request/response schemas."""

from pydantic import BaseModel


class PoseEstimationResponse(BaseModel):
    success: bool
    rotation_matrix: list[list[float]] | None = None
    translation_vector: list[float] | None = None
    camera_matrix: list[list[float]] | None = None
    error_message: str | None = None
```

- [ ] **Step 5: Verify imports work**

Run:
```bash
cd backend && source venv/bin/activate && python -c "from config import CUBE_SIDE_LENGTH; from models.schemas import PoseEstimationResponse; print('OK')"
```

Expected: `OK`

---

## Task 2: Image Processor

**Files:**
- Create: `backend/utils/__init__.py`
- Create: `backend/utils/image_processor.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_image_processor.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/__init__.py` (empty file).

Create `backend/tests/test_image_processor.py`:

```python
# backend/tests/test_image_processor.py
import numpy as np
import cv2
import pytest
from utils.image_processor import decode_image


def _make_jpeg_bytes(width=640, height=480):
    """Create a valid JPEG image as bytes."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (200, 200, 200)  # gray
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


def _make_png_bytes(width=640, height=480):
    """Create a valid PNG image as bytes."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".png", img)
    return buf.tobytes()


def test_decode_valid_jpeg():
    jpeg_bytes = _make_jpeg_bytes(640, 480)
    img = decode_image(jpeg_bytes)
    assert img is not None
    assert img.shape == (480, 640, 3)
    assert img.dtype == np.uint8


def test_decode_valid_png():
    png_bytes = _make_png_bytes(320, 240)
    img = decode_image(png_bytes)
    assert img is not None
    assert img.shape == (240, 320, 3)


def test_decode_invalid_bytes():
    with pytest.raises(ValueError, match="Failed to decode image"):
        decode_image(b"not an image")


def test_decode_empty_bytes():
    with pytest.raises(ValueError, match="Empty image data"):
        decode_image(b"")
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_image_processor.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'utils.image_processor'`

- [ ] **Step 3: Write implementation**

Create `backend/utils/__init__.py` (empty file).

Create `backend/utils/image_processor.py`:

```python
# backend/utils/image_processor.py
"""Image decoding utilities for converting uploaded bytes to OpenCV format."""

import numpy as np
import cv2


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode image bytes (JPEG/PNG) to a BGR numpy array.

    Args:
        image_bytes: Raw image file bytes.

    Returns:
        numpy array in BGR format (H, W, 3), dtype uint8.

    Raises:
        ValueError: If image data is empty or cannot be decoded.
    """
    if not image_bytes:
        raise ValueError("Empty image data")

    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Failed to decode image")

    return img
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_image_processor.py -v
```

Expected: 4 passed

---

## Task 3: Feature Detector

**Files:**
- Create: `backend/services/__init__.py`
- Create: `backend/services/feature_detector.py`
- Create: `backend/tests/test_feature_detector.py`

- [ ] **Step 1: Write the failing test**

Create `backend/services/__init__.py` (empty file).

Create `backend/tests/test_feature_detector.py`:

```python
# backend/tests/test_feature_detector.py
import numpy as np
import cv2
import pytest
from services.feature_detector import detect_cube_face


def _make_image_with_white_quad(width=640, height=480, quad_points=None):
    """Create a dark image with a white quadrilateral drawn on it."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (40, 40, 40)  # dark background
    if quad_points is None:
        quad_points = np.array([
            [200, 150],
            [440, 150],
            [440, 350],
            [200, 350],
        ], dtype=np.int32)
    cv2.fillPoly(img, [quad_points], (255, 255, 255))
    return img


def test_detect_white_quad_on_dark_bg():
    img = _make_image_with_white_quad()
    result = detect_cube_face(img)
    assert result is not None
    assert result.shape == (4, 2)  # 4 corner points, each (x, y)
    # Corners should be near the quad vertices (within ~10px due to refinement)
    for point in result:
        assert 180 < point[0] < 460
        assert 130 < point[1] < 370


def test_detect_rotated_quad():
    # Rotated quadrilateral
    quad = np.array([
        [320, 100],
        [500, 240],
        [320, 380],
        [140, 240],
    ], dtype=np.int32)
    img = _make_image_with_white_quad(quad_points=quad)
    result = detect_cube_face(img)
    assert result is not None
    assert result.shape == (4, 2)


def test_detect_no_quad_in_uniform_image():
    img = np.full((480, 640, 3), 128, dtype=np.uint8)  # uniform gray
    result = detect_cube_face(img)
    assert result is None


def test_detect_too_small_quad():
    # Tiny quad below minimum area
    quad = np.array([
        [300, 230],
        [310, 230],
        [310, 240],
        [300, 240],
    ], dtype=np.int32)
    img = _make_image_with_white_quad(quad_points=quad)
    result = detect_cube_face(img)
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_feature_detector.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'services.feature_detector'`

- [ ] **Step 3: Write implementation**

Create `backend/services/feature_detector.py`:

```python
# backend/services/feature_detector.py
"""Hybrid contour-based cube face detection with sub-pixel corner refinement."""

import numpy as np
import cv2

from config import (
    MIN_CONTOUR_AREA,
    MAX_CONTOUR_AREA_RATIO,
    APPROX_POLY_EPSILON,
    ADAPTIVE_THRESH_BLOCK_SIZE,
    ADAPTIVE_THRESH_C,
    CORNER_SUBPIX_WIN_SIZE,
    CORNER_SUBPIX_ZERO_ZONE,
    CORNER_SUBPIX_CRITERIA,
)


def detect_cube_face(image: np.ndarray) -> np.ndarray | None:
    """Detect a single cube face in the image and return its 4 corner points.

    Uses adaptive thresholding to find bright regions, contour detection to
    identify quadrilateral shapes, and cornerSubPix for sub-pixel refinement.

    Args:
        image: BGR image as numpy array (H, W, 3).

    Returns:
        numpy array of shape (4, 2) with corner coordinates in (x, y) order,
        sorted clockwise from top-left. Returns None if no valid face found.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    image_area = gray.shape[0] * gray.shape[1]

    # Adaptive threshold — white cube on arbitrary background
    thresh = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        ADAPTIVE_THRESH_BLOCK_SIZE,
        ADAPTIVE_THRESH_C,
    )

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_quad = None
    best_score = -1

    for contour in contours:
        area = cv2.contourArea(contour)

        # Filter by area
        if area < MIN_CONTOUR_AREA:
            continue
        if area > MAX_CONTOUR_AREA_RATIO * image_area:
            continue

        # Approximate to polygon
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, APPROX_POLY_EPSILON * perimeter, True)

        # Keep only quadrilaterals
        if len(approx) != 4:
            continue

        # Check convexity
        if not cv2.isContourConvex(approx):
            continue

        # Score: prefer larger, more convex quads
        score = area
        if score > best_score:
            best_score = score
            best_quad = approx

    if best_quad is None:
        return None

    # Reshape from (4, 1, 2) to (4, 2)
    corners = best_quad.reshape(4, 2).astype(np.float32)

    # Order corners clockwise from top-left
    corners = _order_corners(corners)

    # Sub-pixel corner refinement
    criteria = (
        cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER,
        CORNER_SUBPIX_CRITERIA[1],
        CORNER_SUBPIX_CRITERIA[2],
    )
    corners_refined = cv2.cornerSubPix(
        gray,
        corners,
        CORNER_SUBPIX_WIN_SIZE,
        CORNER_SUBPIX_ZERO_ZONE,
        criteria,
    )

    return corners_refined


def _order_corners(corners: np.ndarray) -> np.ndarray:
    """Order 4 corners clockwise starting from top-left.

    Args:
        corners: array of shape (4, 2).

    Returns:
        Reordered array of shape (4, 2).
    """
    # Sort by sum (x+y): smallest = top-left, largest = bottom-right
    s = corners.sum(axis=1)
    diff = np.diff(corners, axis=1).flatten()

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = corners[np.argmin(s)]      # top-left
    ordered[1] = corners[np.argmin(diff)]   # top-right
    ordered[2] = corners[np.argmax(s)]      # bottom-right
    ordered[3] = corners[np.argmax(diff)]   # bottom-left

    return ordered
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_feature_detector.py -v
```

Expected: 4 passed

---

## Task 4: Pose Estimator

**Files:**
- Create: `backend/services/pose_estimator.py`
- Create: `backend/tests/test_pose_estimator.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_pose_estimator.py`:

```python
# backend/tests/test_pose_estimator.py
import numpy as np
import pytest
from services.pose_estimator import estimate_pose, build_camera_matrix


def test_build_camera_matrix():
    cam = build_camera_matrix(1920, 1080)
    assert cam.shape == (3, 3)
    assert cam[0, 0] == 1920.0  # fx = video_width
    assert cam[1, 1] == 1920.0  # fy = video_width
    assert cam[0, 2] == 960.0   # cx = width / 2
    assert cam[1, 2] == 540.0   # cy = height / 2
    assert cam[2, 2] == 1.0


def test_build_camera_matrix_square():
    cam = build_camera_matrix(640, 640)
    assert cam[0, 0] == 640.0
    assert cam[0, 2] == 320.0
    assert cam[1, 2] == 320.0


def test_estimate_pose_returns_rotation_and_translation():
    # Simulate 4 image points that form a reasonable quadrilateral
    image_points = np.array([
        [200.0, 150.0],
        [440.0, 150.0],
        [440.0, 350.0],
        [200.0, 350.0],
    ], dtype=np.float32)

    result = estimate_pose(image_points, video_width=640, video_height=480)

    assert result is not None
    rotation_matrix, translation_vector, camera_matrix = result
    assert rotation_matrix.shape == (3, 3)
    assert translation_vector.shape == (3,)
    assert camera_matrix.shape == (3, 3)


def test_estimate_pose_degenerate_points_returns_none():
    # All points at the same location — solvePnP should fail
    image_points = np.array([
        [320.0, 240.0],
        [320.0, 240.0],
        [320.0, 240.0],
        [320.0, 240.0],
    ], dtype=np.float32)

    result = estimate_pose(image_points, video_width=640, video_height=480)
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_pose_estimator.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'services.pose_estimator'`

- [ ] **Step 3: Write implementation**

Create `backend/services/pose_estimator.py`:

```python
# backend/services/pose_estimator.py
"""Pose estimation via OpenCV solvePnP."""

import numpy as np
import cv2

from config import CUBE_FACE_POINTS_3D


def build_camera_matrix(video_width: int, video_height: int) -> np.ndarray:
    """Build an estimated camera intrinsic matrix from video dimensions.

    Uses the heuristic: focal length = video_width, principal point = center.

    Args:
        video_width: Video frame width in pixels.
        video_height: Video frame height in pixels.

    Returns:
        3x3 camera intrinsic matrix as numpy array.
    """
    fx = fy = float(video_width)
    cx = video_width / 2.0
    cy = video_height / 2.0

    return np.array([
        [fx, 0.0, cx],
        [0.0, fy, cy],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)


def estimate_pose(
    image_points: np.ndarray,
    video_width: int,
    video_height: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Estimate 3D pose of the cube face from 2D image points.

    Args:
        image_points: 2D corner positions in the image, shape (4, 2).
        video_width: Video frame width in pixels.
        video_height: Video frame height in pixels.

    Returns:
        Tuple of (rotation_matrix (3x3), translation_vector (3,), camera_matrix (3x3)),
        or None if pose estimation fails.
    """
    object_points = np.array(CUBE_FACE_POINTS_3D, dtype=np.float64)
    image_pts = image_points.astype(np.float64)
    camera_matrix = build_camera_matrix(video_width, video_height)
    dist_coeffs = np.zeros(4, dtype=np.float64)

    success, rvec, tvec = cv2.solvePnP(
        object_points,
        image_pts,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )

    if not success:
        return None

    rotation_matrix, _ = cv2.Rodrigues(rvec)
    translation_vector = tvec.flatten()

    return rotation_matrix, translation_vector, camera_matrix
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_pose_estimator.py -v
```

Expected: 4 passed

---

## Task 5: API Route & FastAPI App

**Files:**
- Create: `backend/api/__init__.py`
- Create: `backend/api/routes.py`
- Create: `backend/main.py`
- Create: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Create `backend/api/__init__.py` (empty file).

Create `backend/tests/test_api.py`:

```python
# backend/tests/test_api.py
import numpy as np
import cv2
import pytest
from fastapi.testclient import TestClient
from main import app


def _make_jpeg_bytes(width=640, height=480, draw_quad=False):
    """Create a JPEG image, optionally with a white quad on dark background."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    if draw_quad:
        img[:] = (40, 40, 40)
        quad = np.array([[200, 150], [440, 150], [440, 350], [200, 350]], dtype=np.int32)
        cv2.fillPoly(img, [quad], (255, 255, 255))
    else:
        img[:] = (128, 128, 128)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


@pytest.fixture
def client():
    return TestClient(app)


def test_estimate_pose_success(client):
    jpeg = _make_jpeg_bytes(640, 480, draw_quad=True)
    response = client.post(
        "/api/estimate-pose?video_width=640&video_height=480",
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["rotation_matrix"]) == 3
    assert len(data["rotation_matrix"][0]) == 3
    assert len(data["translation_vector"]) == 3
    assert len(data["camera_matrix"]) == 3


def test_estimate_pose_no_cube(client):
    jpeg = _make_jpeg_bytes(640, 480, draw_quad=False)
    response = client.post(
        "/api/estimate-pose?video_width=640&video_height=480",
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["error_message"] is not None


def test_estimate_pose_invalid_file(client):
    response = client.post(
        "/api/estimate-pose?video_width=640&video_height=480",
        files={"image": ("frame.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 400


def test_estimate_pose_missing_dimensions(client):
    jpeg = _make_jpeg_bytes()
    response = client.post(
        "/api/estimate-pose",
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_api.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 3: Write the route**

Create `backend/api/routes.py`:

```python
# backend/api/routes.py
"""API routes for pose estimation."""

from fastapi import APIRouter, File, Query, UploadFile, HTTPException

from config import ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE
from models.schemas import PoseEstimationResponse
from utils.image_processor import decode_image
from services.feature_detector import detect_cube_face
from services.pose_estimator import estimate_pose

router = APIRouter()


@router.post("/api/estimate-pose", response_model=PoseEstimationResponse)
async def estimate_pose_endpoint(
    image: UploadFile = File(...),
    video_width: int = Query(..., gt=0),
    video_height: int = Query(..., gt=0),
) -> PoseEstimationResponse:
    # Validate content type
    if image.content_type not in ACCEPTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type: {image.content_type}. Accepted: {ACCEPTED_IMAGE_TYPES}",
        )

    image_bytes = await image.read()

    # Validate size
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    # Decode
    try:
        frame = decode_image(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Detect cube face
    corners = detect_cube_face(frame)
    if corners is None:
        return PoseEstimationResponse(
            success=False,
            error_message="No cube face detected in the image",
        )

    # Estimate pose
    result = estimate_pose(corners, video_width, video_height)
    if result is None:
        return PoseEstimationResponse(
            success=False,
            error_message="Pose estimation failed — could not solve PnP",
        )

    rotation_matrix, translation_vector, camera_matrix = result

    return PoseEstimationResponse(
        success=True,
        rotation_matrix=rotation_matrix.tolist(),
        translation_vector=translation_vector.tolist(),
        camera_matrix=camera_matrix.tolist(),
    )
```

- [ ] **Step 4: Write the FastAPI app**

Create `backend/main.py`:

```python
# backend/main.py
"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router

app = FastAPI(title="AR Cube Pose Estimation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

- [ ] **Step 5: Run all tests**

Run:
```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```

Expected: All tests pass (12 total: 4 image_processor + 4 feature_detector + 4 pose_estimator + 4 api — though `test_estimate_pose_success` may need detection tuning, see Step 6)

- [ ] **Step 6: Manual smoke test — start server and curl**

Run:
```bash
cd backend && source venv/bin/activate && python main.py
```

In another terminal, test with a synthetic image:
```bash
python -c "
import cv2, numpy as np
img = np.zeros((480,640,3), dtype=np.uint8)
img[:] = (40,40,40)
cv2.fillPoly(img, [np.array([[200,150],[440,150],[440,350],[200,350]])], (255,255,255))
cv2.imwrite('/tmp/test_cube.jpg', img)
"
curl -X POST "http://localhost:8000/api/estimate-pose?video_width=640&video_height=480" \
  -F "image=@/tmp/test_cube.jpg" | python -m json.tool
```

Expected: JSON with `"success": true` and populated rotation/translation matrices.

---

## Task 6: Scene Manager

**Files:**
- Create: `frontend/js/sceneManager.js`

- [ ] **Step 1: Create sceneManager.js**

```javascript
// frontend/js/sceneManager.js
/**
 * Scene Manager Module
 * Manages Three.js scene, camera, renderer, and lighting.
 */

class SceneManager {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;
        this.model = null;
        this.initialized = false;
    }

    /**
     * Initialize the Three.js scene with video dimensions.
     * @param {number} videoWidth
     * @param {number} videoHeight
     */
    init(videoWidth, videoHeight) {
        // Renderer — transparent background so video shows through
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
        });
        this.renderer.setSize(videoWidth, videoHeight);
        this.renderer.setClearColor(0x000000, 0);

        // Camera — perspective, FOV derived from focal length heuristic
        // Default focal length = videoWidth, so FOV = 2 * atan(videoHeight / (2 * videoWidth))
        const fov = 2 * Math.atan(videoHeight / (2 * videoWidth)) * (180 / Math.PI);
        const aspect = videoWidth / videoHeight;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
        this.camera.position.set(0, 0, 0);

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(1, 1, 1);
        this.scene.add(directional);

        this.initialized = true;
        this._animate();
    }

    /**
     * Set the 3D model in the scene.
     * @param {THREE.Object3D} model
     */
    setModel(model) {
        if (this.model) {
            this.scene.remove(this.model);
        }
        this.model = model;
        this.model.matrixAutoUpdate = false;
        this.scene.add(this.model);
    }

    /**
     * Get the current camera.
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Render loop.
     */
    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.initialized) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Check if the scene is initialized.
     * @returns {boolean}
     */
    isReady() {
        return this.initialized;
    }
}

export default SceneManager;
```

- [ ] **Step 2: Manual browser test**

Open `frontend/index.html` in a browser (via a local HTTP server). Open dev console. Verify no errors from the Three.js CDN scripts. The canvas should be transparent (no visible change yet — model and pose not loaded).

---

## Task 7: Model Loader

**Files:**
- Create: `frontend/js/modelLoader.js`

- [ ] **Step 1: Create modelLoader.js**

```javascript
// frontend/js/modelLoader.js
/**
 * Model Loader Module
 * Handles OBJ file upload, validation, parsing, and normalization.
 */

class ModelLoader {
    constructor() {
        this.objUpload = document.getElementById('objUpload');
        this.objStatus = document.getElementById('objStatus');
        this.loader = new THREE.OBJLoader();
        this.model = null;
        this.modelLoaded = false;

        this.maxFileSize = 1 * 1024 * 1024; // 1MB

        this.init();
    }

    init() {
        this.objUpload.addEventListener('change', (e) => this.handleObjUpload(e));
    }

    /**
     * Handle OBJ file selection.
     */
    handleObjUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const validation = this.validateObjFile(file);
        if (!validation.valid) {
            this._showError(validation.error);
            this.objUpload.value = '';
            return;
        }

        this.loadObj(file);
    }

    /**
     * Validate OBJ file.
     */
    validateObjFile(file) {
        if (!file.name.toLowerCase().endsWith('.obj')) {
            return { valid: false, error: 'Invalid file type. Please upload an .obj file.' };
        }
        if (file.size > this.maxFileSize) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            return { valid: false, error: `OBJ file too large (${sizeMB}MB). Maximum is 1MB.` };
        }
        return { valid: true };
    }

    /**
     * Load and parse OBJ file.
     */
    loadObj(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const object = this.loader.parse(e.target.result);
                this.model = this._normalizeModel(object);
                this.modelLoaded = true;
                this._updateStatus(true);
                this._showStatus('OBJ model loaded successfully');

                window.dispatchEvent(new CustomEvent('modelLoaded', {
                    detail: { model: this.model }
                }));
            } catch (err) {
                this._showError('Failed to parse OBJ file: ' + err.message);
                this.modelLoaded = false;
                this._updateStatus(false);
            }
        };
        reader.readAsText(file);
    }

    /**
     * Normalize model: center at origin, fit to unit bounding box.
     */
    _normalizeModel(object) {
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Center the model
        object.position.sub(center);

        // Scale to unit bounding box (will be rescaled by overlayManager)
        if (maxDim > 0) {
            const scale = 1.0 / maxDim;
            object.scale.set(scale, scale, scale);
        }

        // Apply the centering transform so it's baked in
        object.updateMatrixWorld(true);

        // Set wireframe material for visibility on white cube
        object.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshPhongMaterial({
                    color: 0x00ff88,
                    wireframe: false,
                    transparent: true,
                    opacity: 0.7,
                });
            }
        });

        return object;
    }

    /**
     * Get the loaded model.
     * @returns {THREE.Object3D|null}
     */
    getModel() {
        return this.model;
    }

    /**
     * Check if model is loaded.
     * @returns {boolean}
     */
    isReady() {
        return this.modelLoaded;
    }

    _updateStatus(loaded) {
        if (loaded) {
            this.objStatus.textContent = '\u2713 Loaded';
            this.objStatus.classList.add('loaded');
        } else {
            this.objStatus.textContent = 'Not loaded';
            this.objStatus.classList.remove('loaded');
        }
    }

    _showStatus(message) {
        const el = document.getElementById('statusMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('errorMessage').classList.remove('show');
    }

    _showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('statusMessage').classList.remove('show');
    }
}

export default ModelLoader;
```

- [ ] **Step 2: Manual browser test**

Create a simple test OBJ file:
```bash
cat > /tmp/test_cube.obj << 'EOF'
# Simple cube
v -0.5 -0.5 -0.5
v  0.5 -0.5 -0.5
v  0.5  0.5 -0.5
v -0.5  0.5 -0.5
v -0.5 -0.5  0.5
v  0.5 -0.5  0.5
v  0.5  0.5  0.5
v -0.5  0.5  0.5
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
EOF
```

Upload this file in the browser. Verify the OBJ status indicator turns green and console shows no errors.

---

## Task 8: API Client

**Files:**
- Create: `frontend/js/apiClient.js`

- [ ] **Step 1: Create apiClient.js**

```javascript
// frontend/js/apiClient.js
/**
 * API Client Module
 * Handles communication with the backend pose estimation API.
 */

const API_BASE_URL = 'http://localhost:8000';

class ApiClient {
    /**
     * Send a video frame to the backend for pose estimation.
     * @param {Blob} frameBlob - JPEG image blob
     * @param {number} videoWidth
     * @param {number} videoHeight
     * @returns {Promise<Object>} Parsed JSON response
     */
    async sendFrame(frameBlob, videoWidth, videoHeight) {
        const formData = new FormData();
        formData.append('image', frameBlob, 'frame.jpg');

        const url = `${API_BASE_URL}/api/estimate-pose?video_width=${videoWidth}&video_height=${videoHeight}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                body: formData,
            });
        } catch (err) {
            throw new Error('Cannot connect to backend. Is the server running on localhost:8000?');
        }

        if (!response.ok) {
            let detail = `Server error (${response.status})`;
            try {
                const errData = await response.json();
                detail = errData.detail || detail;
            } catch {
                // ignore JSON parse failure on error responses
            }
            throw new Error(detail);
        }

        return response.json();
    }
}

export default ApiClient;
```

---

## Task 9: Overlay Manager

**Files:**
- Create: `frontend/js/overlayManager.js`

- [ ] **Step 1: Create overlayManager.js**

```javascript
// frontend/js/overlayManager.js
/**
 * Overlay Manager Module
 * Converts OpenCV pose data to Three.js transforms and applies to the model.
 */

const CUBE_SIDE_LENGTH = 0.05; // Must match backend config

class OverlayManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
    }

    /**
     * Apply pose estimation result to the 3D model.
     * @param {Object} poseData - Backend response with rotation_matrix, translation_vector
     * @param {THREE.Object3D} model - The loaded OBJ model
     */
    applyPose(poseData, model) {
        const { rotation_matrix: rot, translation_vector: tvec } = poseData;

        // Convert OpenCV coordinate system to Three.js
        // OpenCV: X-right, Y-down, Z-forward
        // Three.js: X-right, Y-up, Z-toward-camera
        // Conversion: negate Y and Z rows of rotation, negate Y and Z of translation

        const matrix = new THREE.Matrix4();
        matrix.set(
            rot[0][0],  rot[0][1],  rot[0][2],  tvec[0],
            -rot[1][0], -rot[1][1], -rot[1][2], -tvec[1],
            -rot[2][0], -rot[2][1], -rot[2][2], -tvec[2],
            0,          0,          0,           1
        );

        // Extract scale: the model was normalized to unit bounding box,
        // so we need to scale it to the cube's physical size
        const scaleMatrix = new THREE.Matrix4();
        scaleMatrix.makeScale(CUBE_SIDE_LENGTH, CUBE_SIDE_LENGTH, CUBE_SIDE_LENGTH);

        // Combine: first scale, then pose transform
        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(matrix, scaleMatrix);

        model.matrixAutoUpdate = false;
        model.matrix.copy(finalMatrix);
    }
}

export default OverlayManager;
```

---

## Task 10: Interaction Controls

**Files:**
- Create: `frontend/js/interactionControls.js`
- Modify: `frontend/index.html` (line 48 — remove `pointer-events: none` for zoom)
- Modify: `frontend/css/styles.css` (renderCanvas pointer-events)

- [ ] **Step 1: Create interactionControls.js**

```javascript
// frontend/js/interactionControls.js
/**
 * Interaction Controls Module
 * Handles mouse wheel zoom on the 3D overlay.
 */

class InteractionControls {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.zoomSpeed = 0.01;
        this.minZoom = -2.0;
        this.maxZoom = 2.0;
        this.currentZoom = 0;
        this.enabled = false;
    }

    /**
     * Enable zoom controls on the viewer container.
     */
    enable() {
        const container = document.querySelector('.video-container');
        container.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false });
        this.enabled = true;
    }

    /**
     * Handle mouse wheel for zoom.
     */
    _handleWheel(event) {
        if (!this.enabled || !this.sceneManager.isReady()) return;

        event.preventDefault();

        const delta = -event.deltaY * this.zoomSpeed;
        this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom + delta));

        const camera = this.sceneManager.getCamera();
        camera.position.z = this.currentZoom;
    }
}

export default InteractionControls;
```

- [ ] **Step 2: Update CSS — enable pointer-events on renderCanvas**

In `frontend/css/styles.css`, change `#renderCanvas` rule: replace `pointer-events: none` with `pointer-events: auto` so the canvas can receive wheel events for zoom.

```css
#renderCanvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
}
```

Note: This means the canvas will intercept mouse events over the video. The video controls remain accessible below the canvas edge.

---

## Task 11: Main Orchestrator

**Files:**
- Create: `frontend/js/main.js`

- [ ] **Step 1: Create main.js**

```javascript
// frontend/js/main.js
/**
 * Main Orchestrator
 * Initializes all modules and coordinates the alignment workflow.
 */

import VideoHandler from './videoHandler.js';
import ModelLoader from './modelLoader.js';
import SceneManager from './sceneManager.js';
import ApiClient from './apiClient.js';
import OverlayManager from './overlayManager.js';
import InteractionControls from './interactionControls.js';

class App {
    constructor() {
        this.videoHandler = new VideoHandler();
        this.modelLoader = new ModelLoader();
        this.sceneManager = new SceneManager();
        this.apiClient = new ApiClient();
        this.overlayManager = new OverlayManager(this.sceneManager);
        this.interactionControls = new InteractionControls(this.sceneManager);

        this.alignButton = document.getElementById('alignButton');
        this.spinner = document.getElementById('loadingSpinner');

        this.videoReady = false;
        this.videoPaused = false;

        this._bindEvents();
    }

    _bindEvents() {
        window.addEventListener('videoLoaded', (e) => this._onVideoLoaded(e));
        window.addEventListener('videoPaused', () => this._onVideoPaused());
        window.addEventListener('modelLoaded', (e) => this._onModelLoaded(e));

        // Also listen for play to update paused state
        const videoPlayer = document.getElementById('videoPlayer');
        videoPlayer.addEventListener('play', () => {
            this.videoPaused = false;
            this._updateAlignButton();
        });

        this.alignButton.addEventListener('click', () => this._onAlignClick());
    }

    _onVideoLoaded(event) {
        const { width, height } = event.detail;
        this.videoReady = true;

        // Initialize Three.js scene with video dimensions
        if (!this.sceneManager.isReady()) {
            this.sceneManager.init(width, height);
            this.interactionControls.enable();
        }

        this._updateAlignButton();
    }

    _onVideoPaused() {
        this.videoPaused = true;
        this._updateAlignButton();
    }

    _onModelLoaded(event) {
        const { model } = event.detail;
        this.sceneManager.setModel(model);
        this._updateAlignButton();
    }

    _updateAlignButton() {
        const canAlign = this.videoReady
            && this.modelLoader.isReady()
            && this.videoPaused;
        this.alignButton.disabled = !canAlign;
    }

    async _onAlignClick() {
        this._showSpinner(true);
        this._clearMessages();

        try {
            // Extract frame
            const frameBlob = await this.videoHandler.extractFrame();
            const { width, height } = this.videoHandler.getVideoDimensions();

            // Send to backend
            const result = await this.apiClient.sendFrame(frameBlob, width, height);

            if (result.success) {
                this.overlayManager.applyPose(result, this.modelLoader.getModel());
                this._showStatus('Model aligned successfully');
            } else {
                this._showError(result.error_message || 'Alignment failed');
            }
        } catch (err) {
            this._showError(err.message);
        } finally {
            this._showSpinner(false);
        }
    }

    _showSpinner(visible) {
        this.spinner.classList.toggle('hidden', !visible);
    }

    _showStatus(message) {
        const el = document.getElementById('statusMessage');
        el.textContent = message;
        el.classList.add('show');
    }

    _showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.classList.add('show');
    }

    _clearMessages() {
        document.getElementById('statusMessage').classList.remove('show');
        document.getElementById('errorMessage').classList.remove('show');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
```

---

## Task 12: End-to-End Integration Test

**Files:** None — manual testing workflow

- [ ] **Step 1: Start the backend**

```bash
cd backend && source venv/bin/activate && python main.py
```

Verify: `Uvicorn running on http://0.0.0.0:8000`

- [ ] **Step 2: Serve the frontend**

In a separate terminal:
```bash
cd frontend && python3 -m http.server 3000
```

Open `http://localhost:3000` in Chrome.

- [ ] **Step 3: Test the full workflow**

1. Upload a video file (any MP4) — verify status turns green
2. Upload `test_cube.obj` (created in Task 7) — verify status turns green
3. Play the video, then pause — verify "Align Model" button becomes enabled
4. Click "Align Model" — verify:
   - Spinner appears
   - Either: success message + model overlay visible
   - Or: error "No cube face detected" (if video doesn't contain a white cube)
5. Test zoom with mouse wheel over the viewer area

- [ ] **Step 4: Test error cases**

1. Click "Align Model" without pausing video — button should be disabled
2. Stop the backend and click "Align Model" — should show connection error
3. Upload an invalid (non-OBJ) file — should show error message

- [ ] **Step 5: Run all backend tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -v
```

Expected: All tests pass.
