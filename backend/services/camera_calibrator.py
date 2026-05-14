# backend/services/camera_calibrator.py
"""Wraps cv2.calibrateCamera. Takes pre-detected chessboard corners
(client-side detection) plus the image size; returns intrinsics.

Trusting the client's corner detection keeps the backend deterministic
and avoids re-running findChessboardCornersSB server-side.
"""

from typing import List, Tuple, Optional, Dict
import numpy as np
import cv2


def calibrate(
    corners_per_frame: List[List[Tuple[float, float]]],
    pattern_size: Tuple[int, int],
    square_size_mm: float,
    image_size: Tuple[int, int],  # (width, height)
) -> Dict:
    """Run cv2.calibrateCamera.

    Returns a dict with success/camera_matrix/dist_coeffs/reproj_err_px/error_message.
    """
    if len(corners_per_frame) < 4:
        return {"success": False, "error_message": "Need at least 4 frames"}

    cols, rows = pattern_size
    expected = cols * rows
    object_template = np.zeros((expected, 3), dtype=np.float32)
    object_template[:, :2] = np.indices((cols, rows)).T.reshape(-1, 2)
    object_template *= square_size_mm / 1000.0  # to metres

    object_points = []
    image_points = []
    for frame_corners in corners_per_frame:
        if len(frame_corners) != expected:
            return {
                "success": False,
                "error_message": f"Frame has {len(frame_corners)} corners, expected {expected}",
            }
        object_points.append(object_template.copy())
        image_points.append(np.array(frame_corners, dtype=np.float32).reshape(-1, 1, 2))

    try:
        ret, K, dist, _rvecs, _tvecs = cv2.calibrateCamera(
            object_points, image_points, image_size, None, None,
        )
    except cv2.error as e:
        return {"success": False, "error_message": f"calibrateCamera failed: {e}"}

    if not ret:
        return {"success": False, "error_message": "calibrateCamera returned no result"}

    return {
        "success": True,
        "camera_matrix": K.tolist(),
        "dist_coeffs": dist.flatten().tolist(),
        "reproj_err_px": float(ret),
        "frames_used": len(corners_per_frame),
    }
