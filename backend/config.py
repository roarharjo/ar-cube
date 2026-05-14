# backend/config.py
"""Configuration for AR cube backend (calibration only)."""

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB per frame
ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"]

# Default chessboard pattern (inner corners on a 10×7 squares board).
DEFAULT_PATTERN_SIZE = (9, 6)
DEFAULT_SQUARE_SIZE_MM = 25.0

MIN_FRAMES_FOR_CALIBRATION = 6
MAX_FRAMES_FOR_CALIBRATION = 30
