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
