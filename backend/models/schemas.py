# backend/models/schemas.py
"""Pydantic models for API request/response schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class PoseEstimationResponse(BaseModel):
    success: bool
    rotation_matrix: Optional[List[List[float]]] = None
    translation_vector: Optional[List[float]] = None
    camera_matrix: Optional[List[List[float]]] = None
    image_points: Optional[List[List[float]]] = None  # 4 detected 2D corners (x, y) in image px
    candidates: Optional[List[Dict[str, Any]]] = None  # debug: all considered quads (contour mode only)
    detection_method: Optional[str] = None  # "aruco" or "contour"
    error_message: Optional[str] = None
