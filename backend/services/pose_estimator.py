# backend/services/pose_estimator.py
"""Pose estimation via OpenCV solvePnP."""

from typing import Optional, Tuple

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
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
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

    try:
        success, rvec, tvec = cv2.solvePnP(
            object_points,
            image_pts,
            camera_matrix,
            dist_coeffs,
            flags=cv2.SOLVEPNP_IPPE_SQUARE,
        )
    except cv2.error:
        return None

    if not success:
        return None

    rotation_matrix, _ = cv2.Rodrigues(rvec)
    translation_vector = tvec.flatten()

    return rotation_matrix, translation_vector, camera_matrix
