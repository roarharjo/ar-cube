# backend/tests/test_image_processor.py
import numpy as np
import cv2
import pytest
from utils.image_processor import decode_image


def _make_jpeg_bytes(width=640, height=480):
    """Create a valid JPEG image as bytes."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (200, 200, 200)  # gray
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


def _make_png_bytes(width=640, height=480):
    """Create a valid PNG image as bytes."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".png", img)
    return buf.tobytes()


def test_decode_valid_jpeg():
    jpeg_bytes = _make_jpeg_bytes(640, 480)
    img = decode_image(jpeg_bytes)
    assert img is not None
    assert img.shape == (480, 640, 3)
    assert img.dtype == np.uint8


def test_decode_valid_png():
    png_bytes = _make_png_bytes(320, 240)
    img = decode_image(png_bytes)
    assert img is not None
    assert img.shape == (240, 320, 3)


def test_decode_invalid_bytes():
    with pytest.raises(ValueError, match="Failed to decode image"):
        decode_image(b"not an image")


def test_decode_empty_bytes():
    with pytest.raises(ValueError, match="Empty image data"):
        decode_image(b"")
