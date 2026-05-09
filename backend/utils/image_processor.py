# backend/utils/image_processor.py
"""Image decoding utilities for converting uploaded bytes to OpenCV format."""

import numpy as np
import cv2


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode image bytes (JPEG/PNG) to a BGR numpy array.

    Args:
        image_bytes: Raw image file bytes.

    Returns:
        numpy array in BGR format (H, W, 3), dtype uint8.

    Raises:
        ValueError: If image data is empty or cannot be decoded.
    """
    if not image_bytes:
        raise ValueError("Empty image data")

    np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Failed to decode image")

    return img
