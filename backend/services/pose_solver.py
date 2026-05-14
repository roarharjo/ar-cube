# backend/services/pose_solver.py
"""Wraps cv2.solvePnPGeneric with IPPE for a planar 5cm cube face.

Returns both IPPE solutions (planar 2-fold ambiguity) so the client can
apply rotation hysteresis. Falls back to single-solution solvePnP if
solvePnPGeneric is unavailable.
"""

from typing import List, Tuple, Dict, Optional
import numpy as np
import cv2


CUBE_SIDE_LENGTH = 0.05  # 5 cm
CUBE_FACE_POINTS_3D = np.array(
    [
        [-CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
        [+CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
        [+CUBE_SIDE_LENGTH / 2, +CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
        [-CUBE_SIDE_LENGTH / 2, +CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    ],
    dtype=np.float32,
)


def solve_pose(
    corners: List[Tuple[float, float]],
    camera_matrix: List[List[float]],
    dist_coeffs: List[float],
) -> Dict:
    """Solve PnP for a cube face given 4 detected corner points.

    Args:
        corners: 4 (x, y) image-pixel coordinates, ordered consistently with
                 CUBE_FACE_POINTS_3D (TL, TR, BR, BL).
        camera_matrix: 3x3 intrinsics.
        dist_coeffs: distortion coefficient array (length 4-8 ok).

    Returns:
        dict with success/solutions/error_message. solutions is a list of
        {R: 3x3, t: [3], err_px: float}.
    """
    if len(corners) != 4:
        return {"success": False, "error_message": f"Expected 4 corners, got {len(corners)}"}

    image_points = np.array(corners, dtype=np.float32).reshape(-1, 1, 2)
    K = np.array(camera_matrix, dtype=np.float64).reshape(3, 3)
    D = np.array(dist_coeffs, dtype=np.float64).reshape(-1)

    try:
        ret, rvecs, tvecs, errs = cv2.solvePnPGeneric(
            CUBE_FACE_POINTS_3D, image_points, K, D, flags=cv2.SOLVEPNP_IPPE,
        )
    except cv2.error as e:
        return {"success": False, "error_message": f"solvePnPGeneric failed: {e}"}

    if not ret or rvecs is None or len(rvecs) == 0:
        return {"success": False, "error_message": "No PnP solution"}

    solutions = []
    for i, (rvec, tvec) in enumerate(zip(rvecs, tvecs)):
        R, _ = cv2.Rodrigues(rvec)
        t = tvec.flatten().tolist()
        err_val = float(errs[i].item()) if errs is not None and i < len(errs) else 0.0
        if not all(np.isfinite(x) for x in t) or not np.all(np.isfinite(R)):
            continue
        solutions.append({
            "R": R.tolist(),
            "t": t,
            "err_px": err_val,
        })

    if not solutions:
        return {"success": False, "error_message": "All PnP solutions had NaN/Inf"}

    return {"success": True, "solutions": solutions}
