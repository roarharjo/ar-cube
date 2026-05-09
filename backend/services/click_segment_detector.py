# backend/services/click_segment_detector.py
"""Markerless cube detection via flood-fill segmentation from a user click.

The user clicks the cube once. We use that click point as a seed for
`cv2.floodFill` with color tolerance — the flood spreads through pixels
of similar color, so we get the exact connected region the user pointed
at. The bounding rotated rectangle of that region gives us 4 corners for
solvePnP.

For continuous tracking, the centroid of the previous detection becomes
the seed for the next frame. This way the system follows the cube without
needing further clicks unless detection is lost.

Reliability comes from the user's click — not from heuristics that try to
guess which white shape is the cube. Trades zero scene assumptions for
one click of user input.
"""

from typing import Optional

import numpy as np
import cv2

from config import (
    FLOOD_TOLERANCE_LO,
    FLOOD_TOLERANCE_HI,
    SEGMENT_MIN_AREA,
    SEGMENT_MAX_AREA_RATIO,
    SEGMENT_SEARCH_RADIUS_PX,
)


def detect_via_click_segment(
    image: np.ndarray,
    seed_x: float,
    seed_y: float,
) -> dict:
    """Segment the cube using floodFill from a user-provided seed point.

    Args:
        image: BGR image (H, W, 3).
        seed_x, seed_y: seed pixel coordinates in image space.

    Returns:
        dict with keys:
          - "ok": bool — whether segmentation produced usable corners
          - "status": short tag describing what happened
          - "corners": (4, 2) np.float32 if ok, else None
          - "centroid": (x, y) if ok, else None
          - "area": float, contour area
          - "tried_seeds": int, how many seed positions were tested
    """
    h, w = image.shape[:2]
    image_area = h * w

    sx, sy = int(round(seed_x)), int(round(seed_y))
    if not (0 <= sx < w and 0 <= sy < h):
        return {"ok": False, "status": "seed_out_of_bounds", "corners": None}

    seeds = [(sx, sy)]
    for r in range(4, SEGMENT_SEARCH_RADIUS_PX + 1, 4):
        for dx, dy in ((r, 0), (-r, 0), (0, r), (0, -r)):
            seeds.append((sx + dx, sy + dy))

    last_failure = "no_seeds_tried"
    last_area = 0.0
    tried = 0

    for cx, cy in seeds:
        if not (0 <= cx < w and 0 <= cy < h):
            continue
        tried += 1
        region = _floodfill_at(image, cx, cy)
        if region is None:
            last_failure = "fill_empty"
            continue
        area = region["area"]
        last_area = area
        if area < SEGMENT_MIN_AREA:
            last_failure = f"too_small({int(area)})"
            continue
        if area > SEGMENT_MAX_AREA_RATIO * image_area:
            last_failure = f"too_big({int(area)})"
            continue

        # First plausible region wins.
        contour = region["contour"]

        # Prefer a sharp 4-vertex polygon approximation when available
        # (gives tighter corners than the rotated bounding box). Try a
        # few epsilon values to find one that yields exactly 4 vertices.
        perimeter = cv2.arcLength(contour, True)
        box = None
        method = "rect"
        for eps_factor in (0.02, 0.04, 0.06, 0.08):
            approx = cv2.approxPolyDP(contour, eps_factor * perimeter, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                box = approx.reshape(4, 2).astype(np.float32)
                method = f"poly[{eps_factor:.2f}]"
                break

        if box is None:
            rect = cv2.minAreaRect(contour)
            box = cv2.boxPoints(rect).astype(np.float32)

        ordered = _order_corners(box)
        cx_f = float(np.mean(ordered[:, 0]))
        cy_f = float(np.mean(ordered[:, 1]))
        return {
            "ok": True,
            "status": f"ok area={int(area)} {method} seed=({cx},{cy})",
            "corners": ordered,
            "centroid": (cx_f, cy_f),
            "area": float(area),
            "tried_seeds": tried,
        }

    return {
        "ok": False,
        "status": f"all_seeds_failed last={last_failure} last_area={int(last_area)}",
        "corners": None,
        "tried_seeds": tried,
    }


def _floodfill_at(image: np.ndarray, sx: int, sy: int) -> Optional[dict]:
    h, w = image.shape[:2]
    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)

    # FLOODFILL_FIXED_RANGE: compare each pixel to the SEED's color, not to its
    # neighbor. This bounds the fill so it doesn't spread through gentle gradients.
    flags = (
        4
        | (255 << 8)
        | cv2.FLOODFILL_MASK_ONLY
        | cv2.FLOODFILL_FIXED_RANGE
    )

    try:
        cv2.floodFill(
            image,
            mask,
            (sx, sy),
            0,
            FLOOD_TOLERANCE_LO,
            FLOOD_TOLERANCE_HI,
            flags,
        )
    except cv2.error:
        return None

    inner_mask = mask[1:-1, 1:-1]
    contours, _ = cv2.findContours(inner_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(contour))
    if area <= 0:
        return None

    return {"contour": contour, "area": area, "mask": inner_mask}


def _order_corners(corners: np.ndarray) -> np.ndarray:
    """Order 4 corners clockwise starting from the topmost point."""
    centroid = corners.mean(axis=0)
    angles = np.arctan2(-(corners[:, 1] - centroid[1]), corners[:, 0] - centroid[0])
    sorted_indices = np.argsort(-angles)
    ordered = corners[sorted_indices].astype(np.float32)
    top_idx = int(np.argmin(ordered[:, 1]))
    ordered = np.roll(ordered, -top_idx, axis=0)
    return ordered
