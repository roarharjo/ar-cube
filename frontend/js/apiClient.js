/**
 * API Client. Backend handles:
 *   - solvePnPGeneric (the worker's OpenCV.js build doesn't ship it)
 *   - chessboard corner detection
 *   - camera calibration
 *
 * Detection (HSV floodFill + contour + corners) stays client-side in the worker.
 */

const API_BASE_URL = 'http://localhost:8000';

class ApiClient {
  async solvePose(corners, cameraMatrix, distCoeffs) {
    const r = await fetch(`${API_BASE_URL}/api/solve-pose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corners,
        camera_matrix: cameraMatrix,
        dist_coeffs: distCoeffs,
      }),
    });
    if (!r.ok) throw new Error(`solve-pose ${r.status}`);
    return r.json();
  }

  async detectChessboard(jpegBlob, cols, rows) {
    const form = new FormData();
    form.append('image', jpegBlob, 'frame.jpg');
    form.append('cols', String(cols));
    form.append('rows', String(rows));
    const r = await fetch(`${API_BASE_URL}/api/detect-chessboard`, {
      method: 'POST',
      body: form,
    });
    if (!r.ok) throw new Error(`detect-chessboard ${r.status}`);
    return r.json();
  }

  async submitCalibration(payload) {
    const r = await fetch(`${API_BASE_URL}/api/calibrate-camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { detail = (await r.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    return r.json();
  }
}

export default ApiClient;
