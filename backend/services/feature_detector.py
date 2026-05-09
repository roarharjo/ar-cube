# backend/services/feature_detector.py
"""Hybrid contour-based cube face detection with sub-pixel corner refinement.

Targets a plain white cube. Discriminators ensure we don't latch onto
arbitrary bright quadrilaterals in the scene:

  - whiteness: mean HSV inside the candidate must be low-saturation and
    high-value (actually white-ish, not a colored object)
  - aspect ratio: cube faces under reasonable perspective have bounding-box
    aspect under ~3; reject elongated rectangles
  - score combines size with whiteness, so a large white quad beats a larger
    but more saturated one

Tries Otsu thresholding first (good for bimodal histograms) and falls back
to adaptive Gaussian for complex lighting.
"""

from typing import List, Optional, Tuple

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
    MAX_MEAN_SATURATION,
    MIN_MEAN_VALUE,
    MAX_BOUNDING_ASPECT,
    MIN_QUAD_FILL_RATIO,
    MAX_DEBUG_CANDIDATES,
    MORPH_CLOSE_KERNEL,
    TARGET_HINT_SIGMA,
)


def detect_cube_face(image: np.ndarray, target=None) -> Optional[np.ndarray]:
    """Detect a single cube face. Returns (4, 2) corner array, or None."""
    best, _ = detect_cube_face_with_candidates(image, target=target)
    return best


def detect_cube_face_with_candidates(
    image: np.ndarray,
    target: Optional[Tuple[float, float]] = None,
) -> Tuple[Optional[np.ndarray], List[dict]]:
    """Same as detect_cube_face but also returns candidate diagnostics.

    Args:
        image: BGR image as numpy array (H, W, 3).
        target: Optional (x, y) hint in image coordinates. When provided,
            candidates closer to this point get a Gaussian proximity bonus
            in their score. Useful for click-to-track to disambiguate
            multiple white quads in the scene.

    Returns:
        (best_corners | None, candidates list).
        Each candidate dict: {
          "corners": [[x, y], ...] (4 corners, ordered),
          "score": float,
          "accepted": bool,
          "reason": str  # short tag explaining filter outcome
        }
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    candidates: List[dict] = []

    # Pass 1: Otsu
    _collect_candidates(gray, hsv, _otsu_threshold(gray), candidates, target)
    # Pass 2: Adaptive
    _collect_candidates(gray, hsv, _adaptive_threshold(gray), candidates, target)

    # Pick the best accepted candidate
    accepted = [c for c in candidates if c["accepted"]]
    accepted.sort(key=lambda c: c["score"], reverse=True)

    # Build a debug-friendly trimmed list (top N by score, mix accepted + rejected)
    candidates.sort(key=lambda c: c["score"], reverse=True)
    debug_list = candidates[:MAX_DEBUG_CANDIDATES]

    if not accepted:
        return None, debug_list

    best = accepted[0]
    raw_corners = np.array(best["corners"], dtype=np.float32)
    refined = _refine_corners_safe(gray, raw_corners)
    return refined, debug_list


def _refine_corners_safe(gray: np.ndarray, raw_corners: np.ndarray) -> np.ndarray:
    """Sub-pixel corner refinement that tolerates corners near image edges.

    cv2.cornerSubPix fails with an assertion if any corner sits outside the
    image (or so close to the edge that the search window would extend
    outside). minAreaRect can produce such corners. We clamp to a safe
    interior margin and fall back to the raw corners on any error.
    """
    h, w = gray.shape
    win_h, win_w = CORNER_SUBPIX_WIN_SIZE
    margin_x = win_w + 2
    margin_y = win_h + 2

    # If the safe interior is degenerate (tiny image), skip refinement
    if w <= 2 * margin_x or h <= 2 * margin_y:
        return raw_corners.copy()

    clamped = raw_corners.copy()
    clamped[:, 0] = np.clip(clamped[:, 0], margin_x, w - margin_x - 1)
    clamped[:, 1] = np.clip(clamped[:, 1], margin_y, h - margin_y - 1)

    try:
        return cv2.cornerSubPix(
            gray,
            clamped,
            CORNER_SUBPIX_WIN_SIZE,
            CORNER_SUBPIX_ZERO_ZONE,
            CORNER_SUBPIX_CRITERIA,
        )
    except cv2.error:
        return raw_corners.copy()


def _otsu_threshold(gray: np.ndarray) -> np.ndarray:
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _morph_close(thresh)


def _adaptive_threshold(gray: np.ndarray) -> np.ndarray:
    thresh = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        ADAPTIVE_THRESH_BLOCK_SIZE,
        ADAPTIVE_THRESH_C,
    )
    return _morph_close(thresh)


def _morph_close(thresh: np.ndarray) -> np.ndarray:
    """Morphological close — fills small gaps inside white regions and smooths
    speckle noise. Helps the cube face register as one clean blob instead of
    a fragmented contour."""
    k = MORPH_CLOSE_KERNEL
    kernel = np.ones((k, k), dtype=np.uint8)
    return cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)


def _collect_candidates(
    gray: np.ndarray,
    hsv: np.ndarray,
    thresh: np.ndarray,
    out: List[dict],
    target: Optional[Tuple[float, float]] = None,
) -> None:
    """Find quad-shaped candidates in a threshold image.

    For each sufficiently-large contour, generates up to two candidate quads:
      1. approxPolyDP if it returns exactly 4 convex vertices (sharp corners)
      2. minAreaRect always (robust for noisy contours with extra vertices)

    Both are filtered by aspect ratio + whiteness. Best-scoring accepted
    candidate wins overall.
    """
    image_area = gray.shape[0] * gray.shape[1]
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < MIN_CONTOUR_AREA:
            continue
        if area > MAX_CONTOUR_AREA_RATIO * image_area:
            continue

        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, APPROX_POLY_EPSILON * perimeter, True)

        # Quad fill ratio: how rectangular is this contour?
        rect = cv2.minAreaRect(contour)
        rect_w, rect_h = rect[1]
        rect_area = rect_w * rect_h
        fill_ratio = area / rect_area if rect_area > 0 else 0.0

        # Path A: sharp 4-vertex convex quad (preferred when it works)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            quad = approx.reshape(4, 2).astype(np.float32)
            _evaluate_quad(gray, hsv, quad, area, fill_ratio, out, source="poly", target=target)

        # Path B: minimum-area rotated rect (always 4 corners, robust to noise)
        box = cv2.boxPoints(rect).astype(np.float32)
        _evaluate_quad(gray, hsv, box, area, fill_ratio, out, source="rect", target=target)


def _evaluate_quad(
    gray: np.ndarray,
    hsv: np.ndarray,
    quad: np.ndarray,
    area: float,
    fill_ratio: float,
    out: List[dict],
    source: str,
    target: Optional[Tuple[float, float]] = None,
) -> None:
    """Apply discrimination filters to a candidate quad and append to `out`.

    Scoring favors moderately-sized, very-white, rectangular shapes:

        score = sqrt(area) * whiteness² * fill_ratio

    Compressing area with sqrt prevents huge bright surfaces (a desk top, a
    wall) from drowning out a small white cube purely on size. Squaring
    whiteness penalises any color cast more steeply.
    """
    ordered = _order_corners(quad)
    int_pts = ordered.astype(np.int32).reshape(-1, 1, 2)

    x, y, w, h = cv2.boundingRect(int_pts)
    if w == 0 or h == 0:
        return
    aspect = max(w / h, h / w)

    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.drawContours(mask, [int_pts], -1, 255, -1)
    mean_hsv = cv2.mean(hsv, mask=mask)
    mean_s = mean_hsv[1]
    mean_v = mean_hsv[2]
    whiteness = max(0.0, 1.0 - mean_s / 255.0)
    score = float((area ** 0.5) * (whiteness ** 2) * fill_ratio)

    # Apply target-hint proximity bonus if a target was provided. The hint
    # multiplies score by a Gaussian centered on the target, with sigma in
    # pixels. A candidate at the target gets a 1.0 multiplier; at sigma it
    # drops to 0.61; at 2*sigma to 0.14. This lets a smaller "correct"
    # candidate beat a larger but wrongly-located one.
    if target is not None:
        cx = float(np.mean(ordered[:, 0]))
        cy = float(np.mean(ordered[:, 1]))
        dx = cx - target[0]
        dy = cy - target[1]
        d2 = dx * dx + dy * dy
        proximity = float(np.exp(-d2 / (2.0 * TARGET_HINT_SIGMA ** 2)))
        score *= proximity

    accepted = True
    reasons = []
    if aspect > MAX_BOUNDING_ASPECT:
        accepted = False
        reasons.append(f"aspect={aspect:.1f}")
    if mean_s > MAX_MEAN_SATURATION:
        accepted = False
        reasons.append(f"sat={int(mean_s)}")
    if mean_v < MIN_MEAN_VALUE:
        accepted = False
        reasons.append(f"val={int(mean_v)}")
    if fill_ratio < MIN_QUAD_FILL_RATIO:
        accepted = False
        reasons.append(f"fill={fill_ratio:.2f}")

    if accepted:
        reason_str = f"ok[{source}]"
    else:
        reason_str = f"rej[{source}]:" + ",".join(reasons)

    out.append({
        "corners": ordered.tolist(),
        "score": score,
        "accepted": accepted,
        "reason": reason_str,
    })


def _order_corners(corners: np.ndarray) -> np.ndarray:
    """Order 4 corners clockwise starting from the topmost point."""
    centroid = corners.mean(axis=0)
    angles = np.arctan2(-(corners[:, 1] - centroid[1]), corners[:, 0] - centroid[0])
    sorted_indices = np.argsort(-angles)
    ordered = corners[sorted_indices].astype(np.float32)
    top_idx = int(np.argmin(ordered[:, 1]))
    ordered = np.roll(ordered, -top_idx, axis=0)
    return ordered
