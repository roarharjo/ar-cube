#!/usr/bin/env python3
"""Generate a printable ArUco marker PNG for the AR-Cube project.

Output: aruco_id0_4cm.png — print at 100% scale on A4/Letter and verify
the printed marker measures exactly 40mm × 40mm (excluding the white
quiet-zone border).

Run from project root:
    cd backend && source venv/bin/activate && python ../docs/marker/generate_marker.py
"""

import os
import sys

import cv2
import numpy as np

THIS_DIR = os.path.dirname(os.path.abspath(__file__))

# These should match backend/config.py
ARUCO_DICT_NAME = "DICT_4X4_50"
ARUCO_TARGET_ID = 0
MARKER_PHYSICAL_MM = 40.0          # 4 cm
QUIET_ZONE_MM = 6.0                # white border around marker (recommended >= 1 cell)
PRINT_DPI = 300                    # high-quality print

PIXELS_PER_MM = PRINT_DPI / 25.4
marker_px = int(round(MARKER_PHYSICAL_MM * PIXELS_PER_MM))
total_mm = MARKER_PHYSICAL_MM + 2 * QUIET_ZONE_MM
total_px = int(round(total_mm * PIXELS_PER_MM))


def main():
    dict_constant = getattr(cv2.aruco, ARUCO_DICT_NAME)
    dictionary = cv2.aruco.getPredefinedDictionary(dict_constant)

    if hasattr(cv2.aruco, "generateImageMarker"):
        marker = cv2.aruco.generateImageMarker(dictionary, ARUCO_TARGET_ID, marker_px)
    else:
        marker = cv2.aruco.drawMarker(dictionary, ARUCO_TARGET_ID, marker_px)

    # Compose with quiet-zone border
    canvas = np.full((total_px, total_px), 255, dtype=np.uint8)
    qz_px = int(round(QUIET_ZONE_MM * PIXELS_PER_MM))
    canvas[qz_px:qz_px + marker_px, qz_px:qz_px + marker_px] = marker

    out_path = os.path.join(THIS_DIR, "aruco_id0_4cm.png")
    cv2.imwrite(out_path, canvas)

    print(f"Wrote {out_path}")
    print(f"  marker:    {MARKER_PHYSICAL_MM:.1f} mm")
    print(f"  quiet zone: {QUIET_ZONE_MM:.1f} mm each side")
    print(f"  total:     {total_mm:.1f} mm × {total_mm:.1f} mm")
    print(f"  image:     {total_px} px @ {PRINT_DPI} dpi")
    print()
    print("Printing checklist:")
    print("  • Print at 100% scale (no 'fit to page')")
    print(f"  • Verify printed marker is exactly {MARKER_PHYSICAL_MM:.0f} mm × {MARKER_PHYSICAL_MM:.0f} mm with a ruler")
    print("  • Cut along the outer edge of the quiet zone")
    print("  • Apply CENTERED on one face of your 5cm cube")


if __name__ == "__main__":
    main()
