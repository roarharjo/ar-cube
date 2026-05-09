# backend/services/feature_detector.py
"""Hybrid contour-based cube face detection with sub-pixel corner refinement."""

import numpy as np
import cv2

from config import (
    MIN_CONTOUR_AREA,
    MAX_CONTOUR_AREA_RATIO,
    APPROX_POLY_EPSILON,
    ADAPTIVE_THRESH_BLOCK_SIZE,
    ADAPTIVE_THRESH_C,
    CORNER_SUBPIX_WIN_SIZE,
    CORNER_SUBPIX_ZERO_ZONE,
    CORNER_SUBPIX_CRITERIA,
)


def detect_cube_face(image: np.ndarray):
    """Detect a single cube face in the image and return its 4 corner points.

    Uses Otsu global thresholding first (good for bimodal histograms), then
    falls back to adaptive thresholding for complex real-world lighting. Contour
    detection identifies quadrilateral shapes and cornerSubPix refines to
    sub-pixel accuracy.

    Args:
        image: BGR image as numpy array (H, W, 3).

    Returns:
        numpy array of shape (4, 2) with corner coordinates in (x, y) order,
        sorted clockwise from top-left. Returns None if no valid face found.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Try Otsu global threshold first — works well for bimodal (bright/dark)
    # histograms. Falls back to adaptive for complex real-world lighting.
    best_quad = _find_best_quad_in_threshold(
        gray, _otsu_threshold(gray)
    )

    if best_quad is None:
        best_quad = _find_best_quad_in_threshold(
            gray, _adaptive_threshold(gray)
        )

    if best_quad is None:
        return None

    # Reshape from (4, 1, 2) to (4, 2)
    corners = best_quad.reshape(4, 2).astype(np.float32)

    # Order corners clockwise from top-left
    corners = _order_corners(corners)

    # Sub-pixel corner refinement
    corners_refined = cv2.cornerSubPix(
        gray,
        corners,
        CORNER_SUBPIX_WIN_SIZE,
        CORNER_SUBPIX_ZERO_ZONE,
        CORNER_SUBPIX_CRITERIA,
    )

    return corners_refined


def _otsu_threshold(gray: np.ndarray) -> np.ndarray:
    """Apply Otsu's global binarization."""
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def _adaptive_threshold(gray: np.ndarray) -> np.ndarray:
    """Apply adaptive Gaussian thresholding."""
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        ADAPTIVE_THRESH_BLOCK_SIZE,
        ADAPTIVE_THRESH_C,
    )


def _find_best_quad_in_threshold(gray: np.ndarray, thresh: np.ndarray):
    """Find the best quadrilateral contour in a thresholded image.

    Args:
        gray: Grayscale image (used for area ratio calculation).
        thresh: Binary thresholded image.

    Returns:
        Best contour approx of shape (4, 1, 2), or None if not found.
    """
    image_area = gray.shape[0] * gray.shape[1]
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_quad = None
    best_score = -1

    for contour in contours:
        area = cv2.contourArea(contour)

        # Filter by area
        if area < MIN_CONTOUR_AREA:
            continue
        if area > MAX_CONTOUR_AREA_RATIO * image_area:
            continue

        # Approximate to polygon
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, APPROX_POLY_EPSILON * perimeter, True)

        # Keep only quadrilaterals
        if len(approx) != 4:
            continue

        # Check convexity
        if not cv2.isContourConvex(approx):
            continue

        # Score: prefer larger quads
        score = area
        if score > best_score:
            best_score = score
            best_quad = approx

    return best_quad


def _order_corners(corners: np.ndarray) -> np.ndarray:
    """Order 4 corners clockwise starting from the topmost-left point.

    Uses centroid + atan2 angular sort, which works correctly for any
    convex quadrilateral (including rotated ones).

    Args:
        corners: array of shape (4, 2).

    Returns:
        Reordered array of shape (4, 2), clockwise from top.
    """
    centroid = corners.mean(axis=0)
    # Angle from centroid to each corner. atan2(dy, dx) returns -pi..pi.
    # In image coords (y increases downward), -pi/2 is "up", so we negate y
    # to get a math-convention angle, then sort clockwise.
    angles = np.arctan2(-(corners[:, 1] - centroid[1]), corners[:, 0] - centroid[0])
    # Sort clockwise (descending angle) starting from the top
    sorted_indices = np.argsort(-angles)
    ordered = corners[sorted_indices].astype(np.float32)

    # Rotate so the first point is the topmost (smallest y)
    top_idx = int(np.argmin(ordered[:, 1]))
    ordered = np.roll(ordered, -top_idx, axis=0)
    return ordered
