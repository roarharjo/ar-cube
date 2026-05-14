"""Unit tests for the chessboard_detector service using a synthetic board."""

import numpy as np
import cv2
from services.chessboard_detector import detect_chessboard_corners


def make_synthetic_chessboard_image(
    cols=9, rows=6, square_px=60, margin=80, frame_w=1280, frame_h=720
):
    img = np.full((frame_h, frame_w, 3), 255, dtype=np.uint8)
    ox = (frame_w - (cols + 1) * square_px) // 2
    oy = (frame_h - (rows + 1) * square_px) // 2
    for r in range(rows + 1):
        for c in range(cols + 1):
            if (r + c) % 2 == 0:
                x = ox + c * square_px
                y = oy + r * square_px
                cv2.rectangle(img, (x, y), (x + square_px, y + square_px), (0, 0, 0), -1)
    return img


def test_detect_chessboard_finds_corners_on_synthetic_image():
    img = make_synthetic_chessboard_image()
    result = detect_chessboard_corners(img, (9, 6))
    assert result["success"], result.get("error_message")
    assert len(result["corners"]) == 9 * 6


def test_detect_chessboard_returns_failure_on_blank_image():
    img = np.full((720, 1280, 3), 128, dtype=np.uint8)  # uniform gray
    result = detect_chessboard_corners(img, (9, 6))
    assert not result["success"]


def test_detect_chessboard_returns_failure_on_empty_image():
    result = detect_chessboard_corners(np.zeros((0, 0, 3), dtype=np.uint8), (9, 6))
    assert not result["success"]
