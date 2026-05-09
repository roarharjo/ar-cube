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
