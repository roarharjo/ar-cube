# backend/services/chessboard_detector.py
"""Server-side chessboard corner detection.

Used by the calibration UI: each captured frame is POSTed to
/api/detect-chessboard, which returns the (inner-corner-count × 2)
corner array. Calibration then sends accumulated corners to
/api/calibrate-camera.
"""

from typing import List, Tuple, Dict
import numpy as np
import cv2


def detect_chessboard_corners(
    image: np.ndarray,
    pattern_size: Tuple[int, int],
) -> Dict:
    """Detect chessboard inner corners.

    Args:
        image: BGR numpy array.
        pattern_size: (cols, rows) of inner corners.

    Returns:
        dict with success/corners/error_message. corners is a list of [x, y]
        floats in image pixels.
    """
    if image is None or image.size == 0:
        return {"success": False, "error_message": "Empty image"}

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    cols, rows = pattern_size
    expected = cols * rows

    # Use the classic findChessboardCorners + cornerSubPix path only.
    # findChessboardCornersSB segfaults on some macOS Python OpenCV builds;
    # the classic path is widely compatible and accurate enough for one-time
    # camera calibration.
    flags = cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE
    found, corners = cv2.findChessboardCorners(gray, (cols, rows), flags=flags)
    if found:
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01)
        corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)

    if not found or corners is None or len(corners) != expected:
        return {"success": False, "error_message": "Chessboard not found"}

    corners_list = [[float(p[0][0]), float(p[0][1])] for p in corners]
    return {"success": True, "corners": corners_list}
