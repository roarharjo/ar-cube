# backend/api/routes.py
"""API routes for pose estimation."""

from fastapi import APIRouter, File, Query, UploadFile, HTTPException

from config import ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE
from models.schemas import PoseEstimationResponse
from utils.image_processor import decode_image
from services.feature_detector import detect_cube_face
from services.pose_estimator import estimate_pose

router = APIRouter()


@router.post("/api/estimate-pose", response_model=PoseEstimationResponse)
async def estimate_pose_endpoint(
    image: UploadFile = File(...),
    video_width: int = Query(..., gt=0),
    video_height: int = Query(..., gt=0),
) -> PoseEstimationResponse:
    # Validate content type
    if image.content_type not in ACCEPTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type: {image.content_type}. Accepted: {ACCEPTED_IMAGE_TYPES}",
        )

    image_bytes = await image.read()

    # Validate size
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    # Decode
    try:
        frame = decode_image(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Detect cube face
    corners = detect_cube_face(frame)
    if corners is None:
        return PoseEstimationResponse(
            success=False,
            error_message="No cube face detected in the image",
        )

    # Estimate pose
    result = estimate_pose(corners, video_width, video_height)
    if result is None:
        return PoseEstimationResponse(
            success=False,
            error_message="Pose estimation failed — could not solve PnP",
        )

    rotation_matrix, translation_vector, camera_matrix = result

    return PoseEstimationResponse(
        success=True,
        rotation_matrix=rotation_matrix.tolist(),
        translation_vector=translation_vector.tolist(),
        camera_matrix=camera_matrix.tolist(),
    )
