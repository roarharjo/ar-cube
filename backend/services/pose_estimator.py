# backend/services/pose_estimator.py
"""Pose estimation via OpenCV solvePnP."""

from typing import List, Optional, Tuple

import numpy as np
import cv2

from config import CUBE_FACE_POINTS_3D, MIN_POSE_DISTANCE_M, MAX_POSE_DISTANCE_M


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
    object_points: Optional[List[List[float]]] = None,
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Estimate 3D pose of the target plane from 2D image points.

    Args:
        image_points: 2D corner positions in the image, shape (4, 2),
            ordered to match the object points (clockwise from top-left).
        video_width: Video frame width in pixels.
        video_height: Video frame height in pixels.
        object_points: Optional 4 × 3 array of 3D object points (in cube
            coordinates) corresponding to image_points. Defaults to
            CUBE_FACE_POINTS_3D (full cube front face). For ArUco marker
            detection pass ARUCO_MARKER_3D_POINTS instead.

    Returns:
        (rotation_matrix (3x3), translation_vector (3,), camera_matrix (3x3))
        or None if pose estimation fails.
    """
    if object_points is None:
        object_points = CUBE_FACE_POINTS_3D
    object_pts = np.array(object_points, dtype=np.float64)
    image_pts = image_points.astype(np.float64)
    camera_matrix = build_camera_matrix(video_width, video_height)
    dist_coeffs = np.zeros(4, dtype=np.float64)

    # Use SOLVEPNP_IPPE (not _SQUARE — that variant returns garbage with
    # huge reprojection errors for our setup). IPPE returns both solutions
    # of the planar 2-fold ambiguity; we pick the one with the smallest
    # reprojection error that's in a plausible distance range.
    try:
        retval, rvecs, tvecs, errors = cv2.solvePnPGeneric(
            object_pts,
            image_pts,
            camera_matrix,
            dist_coeffs,
            flags=cv2.SOLVEPNP_IPPE,
        )
    except cv2.error:
        return None

    if retval == 0 or not rvecs:
        return None

    # Pick the candidate with smallest reprojection error
    best_rvec = None
    best_tvec = None
    best_err = float("inf")
    for i, (rvec, tvec) in enumerate(zip(rvecs, tvecs)):
        try:
            err = float(np.array(errors[i]).flatten()[0])
        except Exception:
            err = 0.0
        if err < best_err:
            best_err = err
            best_rvec = rvec
            best_tvec = tvec

    if best_rvec is None:
        return None

    translation_vector = best_tvec.flatten()
    distance = float(np.linalg.norm(translation_vector))
    if distance < MIN_POSE_DISTANCE_M or distance > MAX_POSE_DISTANCE_M:
        return None

    rotation_matrix, _ = cv2.Rodrigues(best_rvec)
    return rotation_matrix, translation_vector, camera_matrix
