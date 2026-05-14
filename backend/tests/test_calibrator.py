"""Unit tests for the camera_calibrator service using a synthetic chessboard."""

import numpy as np
import pytest
from services.camera_calibrator import calibrate


def make_synthetic_chessboard_corners(
    pattern=(9, 6), square_m=0.025, K=None, image_size=(1280, 720), n_views=8
):
    """Generate ground-truth-projected chessboard corners from known intrinsics."""
    if K is None:
        f = image_size[0]
        K = np.array([[f, 0, image_size[0] / 2], [0, f, image_size[1] / 2], [0, 0, 1]], dtype=np.float64)

    cols, rows = pattern
    obj = np.zeros((cols * rows, 3), dtype=np.float32)
    obj[:, :2] = np.indices((cols, rows)).T.reshape(-1, 2) * square_m

    rng = np.random.default_rng(42)
    views = []
    for _ in range(n_views):
        # Random rotation around Y and tilt around X
        ry = rng.uniform(-0.6, 0.6)
        rx = rng.uniform(-0.4, 0.4)
        Rx = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
        Ry = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
        R = Ry @ Rx
        t = np.array([rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), rng.uniform(0.30, 0.60)])

        pts_cam = (R @ obj.T).T + t
        pts_img = (K @ pts_cam.T).T
        pts_img = pts_img[:, :2] / pts_img[:, 2:3]
        views.append([(float(p[0]), float(p[1])) for p in pts_img])
    return views, K


def test_calibrate_recovers_focal_length():
    views, K_true = make_synthetic_chessboard_corners()
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert result["success"], result.get("error_message")
    fx = result["camera_matrix"][0][0]
    fy = result["camera_matrix"][1][1]
    assert abs(fx - K_true[0, 0]) / K_true[0, 0] < 0.05
    assert abs(fy - K_true[1, 1]) / K_true[1, 1] < 0.05


def test_calibrate_reproj_error_small():
    views, _ = make_synthetic_chessboard_corners()
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert result["success"]
    assert result["reproj_err_px"] < 1.0


def test_calibrate_rejects_too_few_frames():
    views, _ = make_synthetic_chessboard_corners(n_views=2)
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert not result["success"]
    assert "at least" in result["error_message"].lower()


def test_calibrate_rejects_mismatched_corner_count():
    views, _ = make_synthetic_chessboard_corners()
    # Truncate one frame's corners.
    views[0] = views[0][:-1]
    result = calibrate(views, (9, 6), 25.0, (1280, 720))
    assert not result["success"]
    assert "corners" in result["error_message"].lower()
