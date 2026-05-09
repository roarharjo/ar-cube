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
    # Rotated quadrilateral (diamond)
    quad = np.array([
        [320, 100],   # top
        [500, 240],   # right
        [320, 380],   # bottom
        [140, 240],   # left
    ], dtype=np.int32)
    img = _make_image_with_white_quad(quad_points=quad)
    result = detect_cube_face(img)
    assert result is not None
    assert result.shape == (4, 2)
    # First corner should be the topmost (smallest y)
    top_idx = np.argmin(result[:, 1])
    assert top_idx == 0, f"Expected top corner first, got index {top_idx}"
    # Verify clockwise ordering: after topmost, x should increase (move right)
    # then y should increase (move down)
    assert result[1][0] > result[0][0], "Second corner should be to the right of first"
    assert result[2][1] > result[0][1], "Third corner should be below first"


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
