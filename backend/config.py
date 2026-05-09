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
MIN_CONTOUR_AREA = 250  # Minimum pixel area for a valid contour
MAX_CONTOUR_AREA_RATIO = 0.20  # Max ratio of contour area to image area (cube is small)
APPROX_POLY_EPSILON = 0.04  # Polygon approximation accuracy (fraction of perimeter)
ADAPTIVE_THRESH_BLOCK_SIZE = 21  # Block size for adaptive threshold (larger = smoother)
ADAPTIVE_THRESH_C = 5  # Constant subtracted from mean
MORPH_CLOSE_KERNEL = 5  # Kernel size for morphological close (smooths threshold artifacts)

# White-cube discriminators (HSV-based) — reject non-white candidate quads
MAX_MEAN_SATURATION = 70  # Reject if mean S inside contour exceeds this (0–255)
MIN_MEAN_VALUE = 110  # Reject if mean V (brightness) inside contour is below this (0–255)
MAX_BOUNDING_ASPECT = 2.5  # Reject if bounding-rect aspect (max(w/h, h/w)) exceeds this
MIN_QUAD_FILL_RATIO = 0.70  # contour area / minAreaRect area — rejects skewed/irregular shapes

# Target-hint proximity bonus (click-to-track)
TARGET_HINT_SIGMA = 120.0  # gaussian sigma in pixels — bigger = wider tolerance

# Detection mode (markerless is the project requirement)
#   "click_segment" — flood-fill segmentation from user click (primary)
#   "contour"       — global candidate scoring (fallback when no click)
#   "aruco"         — disabled by default, requires marker on cube face (NOT used)
DETECTION_MODE = "click_segment"

# Click-segment parameters
# With FLOODFILL_FIXED_RANGE the tolerance is comparing each pixel to the SEED
# color (not to neighbors), so the fill is bounded — larger values are safe.
FLOOD_TOLERANCE_LO = (30, 30, 30)  # BGR units below seed color
FLOOD_TOLERANCE_HI = (30, 30, 30)  # BGR units above seed color
SEGMENT_MIN_AREA = 250
SEGMENT_MAX_AREA_RATIO = 0.40  # cube shouldn't fill more than 40% of frame
SEGMENT_SEARCH_RADIUS_PX = 25  # if exact seed pixel doesn't yield a region, try nearby

# Pose sanity check — reject implausible distances for a hand-held cube
MIN_POSE_DISTANCE_M = 0.08  # closer than 8cm = solvePnP near-pose ambiguity
MAX_POSE_DISTANCE_M = 3.0   # farther than 3m = unreasonable for desk testing

# ArUco config retained for code completeness but DETECTION_MODE = "click_segment"
# means it never runs. Kept so the code path can be re-enabled without re-writing.
ARUCO_DICT_NAME = "DICT_4X4_50"
ARUCO_TARGET_ID = 0
ARUCO_MARKER_SIZE = 0.04
# When the marker is centered on the cube's front face, its corners sit at
# z = +CUBE_SIDE_LENGTH/2 in the cube's local frame (origin at cube center).
ARUCO_MARKER_3D_POINTS = [
    [-ARUCO_MARKER_SIZE / 2, -ARUCO_MARKER_SIZE / 2, CUBE_SIDE_LENGTH / 2],
    [+ARUCO_MARKER_SIZE / 2, -ARUCO_MARKER_SIZE / 2, CUBE_SIDE_LENGTH / 2],
    [+ARUCO_MARKER_SIZE / 2, +ARUCO_MARKER_SIZE / 2, CUBE_SIDE_LENGTH / 2],
    [-ARUCO_MARKER_SIZE / 2, +ARUCO_MARKER_SIZE / 2, CUBE_SIDE_LENGTH / 2],
]

# Debug visualization
MAX_DEBUG_CANDIDATES = 6  # Max quads to return in response for debug display

# Corner sub-pixel refinement
CORNER_SUBPIX_WIN_SIZE = (5, 5)
CORNER_SUBPIX_ZERO_ZONE = (-1, -1)
CORNER_SUBPIX_CRITERIA = (3, 100, 0.001)  # (type, maxCount, epsilon)
# type 3 = cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER

# Image constraints
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"]
