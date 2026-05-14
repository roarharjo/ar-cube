# backend/models/schemas.py
"""Pydantic models for the calibration API."""

from typing import List, Optional
from pydantic import BaseModel


class CalibrationResponse(BaseModel):
    success: bool
    camera_matrix: Optional[List[List[float]]] = None
    dist_coeffs: Optional[List[float]] = None
    reproj_err_px: Optional[float] = None
    frames_used: Optional[int] = None
    error_message: Optional[str] = None


class PoseSolution(BaseModel):
    R: List[List[float]]
    t: List[float]
    err_px: float


class PoseSolveResponse(BaseModel):
    success: bool
    solutions: Optional[List[PoseSolution]] = None
    error_message: Optional[str] = None


class ChessboardResponse(BaseModel):
    success: bool
    corners: Optional[List[List[float]]] = None
    error_message: Optional[str] = None
