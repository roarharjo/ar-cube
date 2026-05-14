"""Unit tests for the pose_solver service."""

import numpy as np
from services.pose_solver import solve_pose, CUBE_FACE_POINTS_3D


def _project(R, t, K, points_3d):
    pts_cam = (R @ points_3d.T).T + t
    pts_img = (K @ pts_cam.T).T
    pts_img = pts_img[:, :2] / pts_img[:, 2:3]
    return pts_img


def test_solve_pose_recovers_translation_from_synthetic_corners():
    K = [[1280.0, 0.0, 640.0], [0.0, 1280.0, 360.0], [0.0, 0.0, 1.0]]
    K_np = np.array(K)
    R_true = np.eye(3)
    t_true = np.array([0.0, 0.0, 0.5])
    projected = _project(R_true, t_true, K_np, CUBE_FACE_POINTS_3D)
    corners = [(float(p[0]), float(p[1])) for p in projected]
    result = solve_pose(corners, K, [0.0, 0.0, 0.0, 0.0, 0.0])
    assert result["success"], result.get("error_message")
    assert len(result["solutions"]) >= 1
    best = min(result["solutions"], key=lambda s: s["err_px"])
    t = np.array(best["t"])
    assert np.allclose(t, t_true, atol=1e-3)


def test_solve_pose_returns_two_ippe_solutions_for_planar_target():
    K = [[1280.0, 0.0, 640.0], [0.0, 1280.0, 360.0], [0.0, 0.0, 1.0]]
    K_np = np.array(K)
    R_true = np.eye(3)
    t_true = np.array([0.0, 0.0, 0.5])
    projected = _project(R_true, t_true, K_np, CUBE_FACE_POINTS_3D)
    corners = [(float(p[0]), float(p[1])) for p in projected]
    result = solve_pose(corners, K, [0.0, 0.0, 0.0, 0.0, 0.0])
    assert result["success"]
    # IPPE returns 2 solutions for a planar target.
    assert len(result["solutions"]) == 2


def test_solve_pose_rejects_wrong_corner_count():
    K = [[1280.0, 0.0, 640.0], [0.0, 1280.0, 360.0], [0.0, 0.0, 1.0]]
    result = solve_pose([(0.0, 0.0), (1.0, 1.0)], K, [0.0, 0.0, 0.0, 0.0, 0.0])
    assert not result["success"]


def test_solve_pose_filters_nan_solutions():
    # Degenerate input that may produce NaN solutions — function must still
    # return success=False rather than passing NaN through.
    K = [[1280.0, 0.0, 640.0], [0.0, 1280.0, 360.0], [0.0, 0.0, 1.0]]
    corners = [(0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)]  # all colocated
    result = solve_pose(corners, K, [0.0, 0.0, 0.0, 0.0, 0.0])
    # Either success=False or success=True with at least one finite solution.
    if result["success"]:
        for sol in result["solutions"]:
            for row in sol["R"]:
                for v in row:
                    assert np.isfinite(v)
            for v in sol["t"]:
                assert np.isfinite(v)
