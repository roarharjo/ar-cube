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
