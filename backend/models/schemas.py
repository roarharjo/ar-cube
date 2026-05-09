# backend/models/schemas.py
"""Pydantic models for API request/response schemas."""

from typing import List, Optional

from pydantic import BaseModel


class PoseEstimationResponse(BaseModel):
    success: bool
    rotation_matrix: Optional[List[List[float]]] = None
    translation_vector: Optional[List[float]] = None
    camera_matrix: Optional[List[List[float]]] = None
    error_message: Optional[str] = None
