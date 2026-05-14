/**
 * Calibration UI: drives the modal capture flow.
 *
 * Constructor takes a CvWorker instance and a callback (intrinsics) => void
 * to invoke when calibration succeeds and the user saves.
 */

const TARGET_FRAMES = 12;
const DIVERSITY_PX = 80;          // min translational difference between captures
const PATTERN_SIZE = [9, 6];
const SQUARE_SIZE_MM = 25.0;

class CalibrationUI {
  constructor(cvWorker, apiClient, onSave) {
    this.cvWorker = cvWorker;
    this.apiClient = apiClient;
    this.onSave = onSave;
    this.modal = document.getElementById('calibrationModal');
    this.startBtn = document.getElementById('calibStartButton');
    this.saveBtn = document.getElementById('calibSaveButton');
    this.cancelBtn = document.getElementById('calibCancelButton');
    this.progressFill = document.getElementById('calibProgressFill');
    this.progressLabel = document.getElementById('calibProgressLabel');
    this.resultEl = document.getElementById('calibResult');

    this.captures = []; // { corners }
    this.running = false;
    this._lastResult = null;

    this.startBtn.addEventListener('click', () => this._beginCapture());
    this.saveBtn.addEventListener('click', () => this._save());
    this.cancelBtn.addEventListener('click', () => this.close());
  }

  open() { this.modal.classList.remove('hidden'); this._reset(); }
  close() { this.running = false; this.modal.classList.add('hidden'); }

  _reset() {
    this.captures = [];
    this._lastResult = null;
    this.progressFill.style.width = '0%';
    this.progressLabel.textContent = `0 / ${TARGET_FRAMES}`;
    this.resultEl.textContent = '';
    this.startBtn.classList.remove('hidden');
    this.saveBtn.classList.add('hidden');
  }

  async _beginCapture() {
    this.startBtn.classList.add('hidden');
    this.running = true;
    const videoEl = document.getElementById('videoPlayer');
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');

    while (this.running && this.captures.length < TARGET_FRAMES) {
      ctx.drawImage(videoEl, 0, 0);
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85)
      );
      if (!blob) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      let res;
      try {
        res = await this.apiClient.detectChessboard(blob, PATTERN_SIZE[0], PATTERN_SIZE[1]);
      } catch (err) {
        this.resultEl.textContent = `Backend unreachable: ${err.message}`;
        this.running = false;
        break;
      }
      if (res.success && this._isDiverse(res.corners)) {
        this.captures.push({ corners: res.corners });
        this._updateProgress();
      }
      await new Promise(r => setTimeout(r, 150));
    }

    if (this.running) await this._submit();
  }

  _isDiverse(corners) {
    if (this.captures.length === 0) return true;
    // Approximate diversity via mean corner position alone (simple and robust enough).
    const mean = corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / corners.length);
    for (const cap of this.captures) {
      const m = cap.corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / cap.corners.length);
      const d = Math.hypot(mean[0] - m[0], mean[1] - m[1]);
      if (d < DIVERSITY_PX) return false;
    }
    return true;
  }

  _updateProgress() {
    const pct = (this.captures.length / TARGET_FRAMES) * 100;
    this.progressFill.style.width = `${pct}%`;
    this.progressLabel.textContent = `${this.captures.length} / ${TARGET_FRAMES}`;
  }

  async _submit() {
    this.progressLabel.textContent = 'Computing intrinsics…';
    const videoEl = document.getElementById('videoPlayer');
    const body = {
      frames: this.captures.map(c => c.corners),
      frame_width: videoEl.videoWidth,
      frame_height: videoEl.videoHeight,
      pattern_size: PATTERN_SIZE,
      square_size_mm: SQUARE_SIZE_MM,
    };
    try {
      const data = await this.apiClient.submitCalibration(body);
      if (!data.success) {
        this.resultEl.textContent = `Calibration failed: ${data.error_message}`;
        return;
      }
      this._lastResult = data;
      this.resultEl.textContent =
        `Reprojection error: ${data.reproj_err_px.toFixed(2)} px · ${data.frames_used} frames used.`;
      this.saveBtn.classList.remove('hidden');
    } catch (err) {
      this.resultEl.textContent = `Calibration error: ${err.message}`;
    }
  }

  _save() {
    if (!this._lastResult) return;
    const videoEl = document.getElementById('videoPlayer');
    const stream = videoEl.srcObject;
    const cameraLabel = stream && stream.getVideoTracks()[0] ? stream.getVideoTracks()[0].label : 'unknown';
    const intrinsics = {
      version: 1,
      cameraLabel,
      K: this._lastResult.camera_matrix,
      distCoeffs: this._lastResult.dist_coeffs,
      errPx: this._lastResult.reproj_err_px,
      capturedAt: new Date().toISOString(),
      frameSize: [videoEl.videoWidth, videoEl.videoHeight],
    };
    localStorage.setItem('arcube.intrinsics', JSON.stringify(intrinsics));
    this.onSave(intrinsics);
    this.close();
  }
}

export default CalibrationUI;
