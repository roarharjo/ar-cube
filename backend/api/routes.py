# backend/api/routes.py
"""API routes for pose estimation."""

from fastapi import APIRouter, File, Query, UploadFile, HTTPException

from config import (
    ACCEPTED_IMAGE_TYPES,
    MAX_IMAGE_SIZE,
    DETECTION_MODE,
)
from models.schemas import PoseEstimationResponse
from utils.image_processor import decode_image
from services.feature_detector import detect_cube_face_with_candidates
from services.click_segment_detector import detect_via_click_segment
from services.pose_estimator import estimate_pose

router = APIRouter()


@router.post("/api/estimate-pose", response_model=PoseEstimationResponse)
async def estimate_pose_endpoint(
    image: UploadFile = File(...),
    video_width: int = Query(..., gt=0),
    video_height: int = Query(..., gt=0),
    target_x: float = Query(None),
    target_y: float = Query(None),
) -> PoseEstimationResponse:
    if image.content_type not in ACCEPTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type: {image.content_type}. Accepted: {ACCEPTED_IMAGE_TYPES}",
        )

    image_bytes = await image.read()
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    try:
        frame = decode_image(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    has_target = target_x is not None and target_y is not None

    corners = None
    candidates = None
    detection_method = None
    click_status = None

    if DETECTION_MODE == "click_segment":
        if has_target:
            # Click-segment is authoritative once the user has clicked.
            # If it fails, we DO NOT fall back to contour — that would let
            # the global candidate scorer "jump to other shapes" between
            # successful click-segment frames.
            seg = detect_via_click_segment(frame, target_x, target_y)
            click_status = seg.get("status")
            if seg.get("ok"):
                corners = seg["corners"]
                detection_method = "click_segment"
        else:
            # No click yet — give a one-shot contour pass so the user sees
            # *something* and can decide where to click.
            corners, candidates = detect_cube_face_with_candidates(frame, target=None)
            if corners is not None:
                detection_method = "contour"
    else:
        # Pure contour mode (legacy / experimental)
        target = (target_x, target_y) if has_target else None
        corners, candidates = detect_cube_face_with_candidates(frame, target=target)
        if corners is not None:
            detection_method = "contour"

    if corners is None:
        if DETECTION_MODE == "click_segment" and not has_target:
            msg = "Click the cube in the viewport to start tracking"
        elif click_status:
            msg = f"click-segment: {click_status}; contour fallback also failed"
        else:
            msg = "No cube detected"
        return PoseEstimationResponse(
            success=False,
            candidates=candidates,
            error_message=msg,
        )

    pose = estimate_pose(corners, video_width, video_height)
    if pose is None:
        return PoseEstimationResponse(
            success=False,
            candidates=candidates,
            image_points=corners.tolist(),
            error_message="Pose estimation failed — could not solve PnP",
        )

    rotation_matrix, translation_vector, camera_matrix = pose

    return PoseEstimationResponse(
        success=True,
        rotation_matrix=rotation_matrix.tolist(),
        translation_vector=translation_vector.tolist(),
        camera_matrix=camera_matrix.tolist(),
        image_points=corners.tolist(),
        candidates=candidates,
        detection_method=detection_method,
    )
