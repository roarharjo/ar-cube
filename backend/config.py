# backend/config.py
"""Configuration constants for AR cube pose estimation."""

# Cube dimensions (meters)
CUBE_SIDE_LENGTH = 0.05  # 5cm

# 3D object points for one face of the cube (origin at center)
# Front face corners in clockwise order, Z = +half
CUBE_FACE_POINTS_3D = [
    [-CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [CUBE_SIDE_LENGTH / 2, -CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
    [-CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2, CUBE_SIDE_LENGTH / 2],
]

# Detection parameters
MIN_CONTOUR_AREA = 500  # Minimum pixel area for a valid contour
MAX_CONTOUR_AREA_RATIO = 0.9  # Max ratio of contour area to image area
APPROX_POLY_EPSILON = 0.02  # Polygon approximation accuracy (fraction of perimeter)
ADAPTIVE_THRESH_BLOCK_SIZE = 11  # Block size for adaptive threshold
ADAPTIVE_THRESH_C = 2  # Constant subtracted from mean

# Corner sub-pixel refinement
CORNER_SUBPIX_WIN_SIZE = (5, 5)
CORNER_SUBPIX_ZERO_ZONE = (-1, -1)
CORNER_SUBPIX_CRITERIA = (3, 100, 0.001)  # (type, maxCount, epsilon)
# type 3 = cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER

# Image constraints
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"]
