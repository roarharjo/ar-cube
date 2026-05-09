# backend/services/aruco_detector.py
"""ArUco fiducial marker detection.

A single ArUco marker stuck on one face of the cube provides bulletproof
detection: OpenCV's marker decoder gives us 4 sharp corners with sub-pixel
accuracy and we know exactly which marker we're looking at by ID.

Used as the primary detection mode (configurable). If `DETECTION_MODE = "auto"`
the route falls back to the contour pipeline when no marker is visible.
"""

from typing import Optional

import numpy as np
import cv2

from config import ARUCO_DICT_NAME, ARUCO_TARGET_ID


def _build_detector():
    """Build the ArUco detector. Tolerates both old (<4.7) and new APIs."""
    dict_constant = getattr(cv2.aruco, ARUCO_DICT_NAME)
    dictionary = cv2.aruco.getPredefinedDictionary(dict_constant)

    # OpenCV 4.7+ has the new ArucoDetector class
    if hasattr(cv2.aruco, "ArucoDetector"):
        params = cv2.aruco.DetectorParameters()
        return cv2.aruco.ArucoDetector(dictionary, params), None
    # Fallback for older OpenCV
    return None, dictionary


def detect_aruco_marker(image: np.ndarray) -> Optional[np.ndarray]:
    """Detect the configured ArUco marker in the image.

    Args:
        image: BGR image as numpy array (H, W, 3).

    Returns:
        numpy array of shape (4, 2) with the detected marker's corner
        coordinates in clockwise order (top-left, top-right, bottom-right,
        bottom-left), as float32. Returns None if the marker is not found.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    detector, dictionary = _build_detector()

    if detector is not None:
        corners_list, ids, _ = detector.detectMarkers(gray)
    else:
        params = cv2.aruco.DetectorParameters_create()
        corners_list, ids, _ = cv2.aruco.detectMarkers(gray, dictionary, parameters=params)

    if ids is None or len(ids) == 0:
        return None

    # Find the target marker by ID
    flat_ids = ids.flatten()
    for idx, marker_id in enumerate(flat_ids):
        if int(marker_id) == ARUCO_TARGET_ID:
            # corners_list[idx] has shape (1, 4, 2)
            corners = corners_list[idx].reshape(4, 2).astype(np.float32)
            return corners

    return None
