# backend/api/routes.py
"""Camera calibration, pose solving, and chessboard detection endpoints."""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Tuple

from config import (
    DEFAULT_PATTERN_SIZE,
    DEFAULT_SQUARE_SIZE_MM,
    MIN_FRAMES_FOR_CALIBRATION,
    MAX_FRAMES_FOR_CALIBRATION,
)
from models.schemas import CalibrationResponse, PoseSolveResponse, ChessboardResponse
from services.camera_calibrator import calibrate
from services.pose_solver import solve_pose
from services.chessboard_detector import detect_chessboard_corners
from utils.image_processor import decode_image

router = APIRouter()


class CalibrationRequest(BaseModel):
    frames: List[List[Tuple[float, float]]]  # per-frame corner arrays in image px
    frame_width: int
    frame_height: int
    pattern_size: Tuple[int, int] = DEFAULT_PATTERN_SIZE
    square_size_mm: float = DEFAULT_SQUARE_SIZE_MM


class PoseSolveRequest(BaseModel):
    corners: List[Tuple[float, float]]
    camera_matrix: List[List[float]]
    dist_coeffs: List[float] = [0.0, 0.0, 0.0, 0.0, 0.0]


@router.post("/api/calibrate-camera", response_model=CalibrationResponse)
async def calibrate_camera_endpoint(req: CalibrationRequest) -> CalibrationResponse:
    n = len(req.frames)
    if n < MIN_FRAMES_FOR_CALIBRATION:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {MIN_FRAMES_FOR_CALIBRATION} frames, got {n}",
        )
    if n > MAX_FRAMES_FOR_CALIBRATION:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_FRAMES_FOR_CALIBRATION} frames, got {n}",
        )

    result = calibrate(
        req.frames,
        req.pattern_size,
        req.square_size_mm,
        (req.frame_width, req.frame_height),
    )
    return CalibrationResponse(**result)


@router.post("/api/solve-pose", response_model=PoseSolveResponse)
async def solve_pose_endpoint(req: PoseSolveRequest) -> PoseSolveResponse:
    result = solve_pose(req.corners, req.camera_matrix, req.dist_coeffs)
    return PoseSolveResponse(**result)


@router.post("/api/detect-chessboard", response_model=ChessboardResponse)
async def detect_chessboard_endpoint(
    image: UploadFile = File(...),
    cols: int = Form(9),
    rows: int = Form(6),
) -> ChessboardResponse:
    if image.content_type not in ("image/jpeg", "image/png"):
        return ChessboardResponse(success=False, error_message=f"Unsupported content type: {image.content_type}")
    image_bytes = await image.read()
    try:
        frame = decode_image(image_bytes)
    except Exception as e:
        return ChessboardResponse(success=False, error_message=f"Decode failed: {e}")
    result = detect_chessboard_corners(frame, (cols, rows))
    return ChessboardResponse(**result)
