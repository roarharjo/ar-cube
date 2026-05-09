/**
 * Main Orchestrator
 * Wires modules together and runs the continuous tracking loop.
 */

import WebcamHandler from './webcamHandler.js';
import SceneManager from './sceneManager.js';
import ApiClient from './apiClient.js';
import OverlayManager from './overlayManager.js';
import InteractionControls from './interactionControls.js';

const MIN_FRAME_INTERVAL_MS = 100; // ~10 fps cap
const FPS_WINDOW = 10;              // rolling FPS window
const LATENCY_WINDOW = 10;          // rolling latency window
const TARGET_SIGMA_PX = 120;        // mirror of backend TARGET_HINT_SIGMA, for visualization
const TARGET_SMOOTHING = 0.4;       // EMA factor when updating target from detection (0=hold, 1=jump)
const MAX_FRAME_JUMP_PX = 80;       // max plausible centroid jump between frames at ~10fps
const MAX_REJECT_STREAK = 8;        // give up after this many consecutive jump-rejections (cube moved far)
const MAX_DRIFT_FROM_CLICK_PX = 250; // if target wanders this far from original click, force re-anchor

class App {
    constructor() {
        this.webcamHandler = new WebcamHandler();
        this.sceneManager = new SceneManager();
        this.apiClient = new ApiClient();
        this.overlayManager = new OverlayManager(this.sceneManager);
        this.interactionControls = new InteractionControls();

        this.trackingButton = document.getElementById('trackingButton');
        this.debugPanel = document.getElementById('debugPanel');
        this.viewportHeader = document.getElementById('viewportHeader');
        this.footerLatency = document.getElementById('footerLatency');
        this.footerSuccess = document.getElementById('footerSuccess');
        this.footerUptime = document.getElementById('footerUptime');
        this.debugCanvas = document.getElementById('debugCanvas');
        this.debugCtx = this.debugCanvas.getContext('2d');

        this.tracking = false;
        this.webcamReady = false;

        this.frameCount = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.rejectStreak = 0;
        this.frameTimestamps = [];
        this.latencies = [];
        this.lastResult = null;
        this.lastError = null;

        // Click-to-track target hint, in image-pixel coordinates. null means no hint.
        this.target = null;
        this.originalClick = null; // anchor — target may not drift far from this

        this.startTime = performance.now();

        this._loadCalibration();
        this._bindEvents();
        this._renderDebugPanel();
        this._updateViewportHeader();
        this._updateFooter();

        setInterval(() => this._updateFooter(), 1000);
    }

    _loadCalibration() {
        try {
            const raw = localStorage.getItem('arcube.calib');
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.calib) {
                this.overlayManager.calib = { ...this.overlayManager.calib, ...saved.calib };
            }
            this._pendingFocalScale = typeof saved.focalScale === 'number' ? saved.focalScale : null;
        } catch {
            // ignore corrupt localStorage
        }
    }

    _saveCalibration() {
        try {
            const data = {
                calib: this.overlayManager.getCalibration(),
                focalScale: this.sceneManager.isReady() ? this.sceneManager.getFocalScale() : 1.0,
            };
            localStorage.setItem('arcube.calib', JSON.stringify(data));
        } catch {
            // localStorage may be disabled — fail silently
        }
    }

    _bindEvents() {
        window.addEventListener('webcamReady', (e) => this._onWebcamReady(e));
        this.trackingButton.addEventListener('click', () => this._toggleTracking());

        // Click-to-track: clicking the viewport sets the detection target.
        // Right-click clears it.
        const viewport = document.querySelector('.video-container');
        viewport.addEventListener('click', (e) => this._onViewportClick(e));
        viewport.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._clearTarget();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._clearTarget();
                return;
            }
            // Manual calibration nudges. Translation in metres, scale unitless.
            const T_STEP = 0.005;     // 5mm per keypress
            const T_FAST = 0.025;     // 25mm with shift
            const S_STEP = 0.05;      // 5% scale per keypress
            const step = e.shiftKey ? T_FAST : T_STEP;
            let nudged = true;
            const F_STEP = 0.05; // focal-scale step per keypress
            switch (e.key) {
                case 'ArrowLeft':  this.overlayManager.nudge('x', -step); break;
                case 'ArrowRight': this.overlayManager.nudge('x', +step); break;
                case 'ArrowUp':    this.overlayManager.nudge('y', +step); break;
                case 'ArrowDown':  this.overlayManager.nudge('y', -step); break;
                case 'PageUp':     this.overlayManager.nudge('z', +step); break;
                case 'PageDown':   this.overlayManager.nudge('z', -step); break;
                case '+':
                case '=':          this.overlayManager.nudge('s', +S_STEP); break;
                case '-':
                case '_':          this.overlayManager.nudge('s', -S_STEP); break;
                case '[':          this.sceneManager.nudgeFocalScale(-F_STEP); break;
                case ']':          this.sceneManager.nudgeFocalScale(+F_STEP); break;
                case 'l':
                case 'L':
                    this.overlayManager.toggleLevelLock();
                    break;
                case 'r':
                case 'R':
                    this.overlayManager.resetCalibration();
                    this.sceneManager.setFocalScale(1.0);
                    break;
                default:           nudged = false;
            }
            if (nudged) {
                e.preventDefault();
                this._saveCalibration();
                this._renderDebugPanel();
            }
        });
    }

    _onViewportClick(event) {
        if (!this.webcamReady) return;
        // Convert screen coords to image-pixel coords. The video element is
        // displayed at some CSS size but the actual frame is videoWidth × videoHeight.
        const videoEl = document.getElementById('videoPlayer');
        const rect = videoEl.getBoundingClientRect();
        const { width, height } = this.webcamHandler.getDimensions();
        const x = ((event.clientX - rect.left) / rect.width) * width;
        const y = ((event.clientY - rect.top) / rect.height) * height;
        this.target = { x, y };
        this.originalClick = { x, y };
        this.rejectStreak = 0;
        this.overlayManager.reset(); // snap pose smoothing to new position
        this._showStatus(`target set @ ${Math.round(x)},${Math.round(y)} — right-click or Esc to clear`);
        // Redraw immediately so the user sees the crosshair even before next frame
        this._drawDetectorDebug(
            this.lastResult ? this.lastResult.image_points : null,
            this.lastResult ? this.lastResult.candidates : null,
        );
    }

    _clearTarget() {
        if (!this.target) return;
        this.target = null;
        this.originalClick = null;
        this.rejectStreak = 0;
        this.overlayManager.reset();
        this._showStatus('target cleared');
        this._drawDetectorDebug(
            this.lastResult ? this.lastResult.image_points : null,
            this.lastResult ? this.lastResult.candidates : null,
        );
    }

    _onWebcamReady(event) {
        const { width, height } = event.detail;
        this.webcamReady = true;

        if (!this.sceneManager.isReady()) {
            this.sceneManager.init(width, height);
            this.interactionControls.enable();
            // Restore focal-scale calibration if it was loaded before scene init
            if (typeof this._pendingFocalScale === 'number') {
                this.sceneManager.setFocalScale(this._pendingFocalScale);
                this._pendingFocalScale = null;
            }
        }

        // Match the debug canvas backing-store to the actual webcam frame
        this.debugCanvas.width = width;
        this.debugCanvas.height = height;

        this._updateTrackingButton();
        this._updateViewportHeader();
        this._renderDebugPanel();
    }

    _updateTrackingButton() {
        this.trackingButton.disabled = !this.webcamReady;
        if (!this.tracking) {
            this.trackingButton.textContent = 'Start Tracking';
        }
    }

    _toggleTracking() {
        if (this.tracking) {
            this._stopTracking();
        } else {
            this._startTracking();
        }
    }

    _startTracking() {
        if (this.tracking) return;
        this.tracking = true;
        document.body.classList.add('is-tracking');
        this.trackingButton.textContent = 'Stop Tracking';
        this._showStatus('tracking…');
        this._clearError();
        this.frameCount = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.rejectStreak = 0;
        this.frameTimestamps = [];
        this.latencies = [];
        this.lastError = null;
        this._trackingLoop();
    }

    _stopTracking() {
        this.tracking = false;
        document.body.classList.remove('is-tracking');
        this.trackingButton.textContent = 'Start Tracking';
        this._showStatus('tracking stopped');
        this._renderDebugPanel();
        this._updateViewportHeader();
        this._clearDebugCanvas();
    }

    _drawDetectorDebug(winnerPoints, candidates) {
        const ctx = this.debugCtx;
        const w = this.debugCanvas.width;
        const h = this.debugCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const baseLine = Math.max(2, w / 900);
        const labelSize = Math.max(13, Math.round(w / 95));

        // Draw target hint first (under everything else)
        if (this.target) this._drawTarget(ctx, this.target, baseLine);

        // Draw rejected candidates first (under the winner) — solid yellow with score+reason
        if (Array.isArray(candidates)) {
            for (const cand of candidates) {
                if (cand.accepted) continue;
                const pts = cand.corners;
                if (!pts || pts.length < 4) continue;

                ctx.strokeStyle = 'rgba(255, 200, 80, 0.85)';
                ctx.lineWidth = baseLine * 1.4;
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.closePath();
                ctx.stroke();

                const [lx, ly] = pts[0];
                const tag = `${cand.reason} · score=${this._fmtScore(cand.score)}`;
                this._drawTag(ctx, tag, lx + 4, ly - 4, labelSize, 'rgba(255, 220, 100, 1)');
            }
        }

        const points = winnerPoints || (candidates && candidates.find(c => c.accepted)?.corners);
        if (!points || points.length < 4) return;

        // Winner: bold green polygon
        ctx.strokeStyle = 'rgba(0, 255, 153, 0.95)';
        ctx.lineWidth = baseLine * 3;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.closePath();
        ctx.stroke();

        // Winner score label
        const winner = candidates && candidates.find(c => c.accepted);
        if (winner) {
            const [tx, ty] = points[0];
            this._drawTag(ctx, `WINNER · score=${this._fmtScore(winner.score)}`, tx + 4, ty - 4, labelSize, '#00ff99');
        }

        // Color-coded corner markers
        const colors = ['#ff5566', '#ffcc66', '#00ffcc', '#66aaff'];
        const radius = Math.max(8, w / 180);
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i];
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = colors[i];
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#000';
            ctx.font = `bold ${Math.round(radius * 1.4)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i), x, y);
        }
    }

    _fmtScore(s) {
        if (typeof s !== 'number') return '?';
        if (s >= 1000) return Math.round(s).toString();
        return s.toFixed(1);
    }

    _drawTarget(ctx, target, baseLine) {
        const { x, y } = target;
        // Faint sigma circle showing the proximity-bonus zone
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.18)';
        ctx.lineWidth = baseLine;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(x, y, TARGET_SIGMA_PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Crosshair
        const arm = Math.max(14, this.debugCanvas.width / 60);
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.95)';
        ctx.lineWidth = baseLine * 1.5;
        ctx.beginPath();
        ctx.moveTo(x - arm, y); ctx.lineTo(x - arm * 0.3, y);
        ctx.moveTo(x + arm * 0.3, y); ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm); ctx.lineTo(x, y - arm * 0.3);
        ctx.moveTo(x, y + arm * 0.3); ctx.lineTo(x, y + arm);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = 'rgba(0, 255, 204, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, baseLine * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawTag(ctx, text, x, y, fontSize, color) {
        ctx.font = `${fontSize}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const padX = fontSize * 0.4;
        const padY = fontSize * 0.25;
        const metrics = ctx.measureText(text);
        const tw = metrics.width + padX * 2;
        const th = fontSize + padY * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
        ctx.fillRect(x, y - th, tw, th);
        ctx.fillStyle = color;
        ctx.fillText(text, x + padX, y - padY);
    }

    _clearDebugCanvas() {
        const ctx = this.debugCtx;
        ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
    }

    async _trackingLoop() {
        while (this.tracking) {
            const loopStart = performance.now();
            this.frameCount += 1;

            try {
                const frameBlob = await this.webcamHandler.extractFrame();
                const { width, height } = this.webcamHandler.getDimensions();
                const result = await this.apiClient.sendFrame(frameBlob, width, height, this.target);
                const latency = performance.now() - loopStart;
                this._recordLatency(latency);

                this.lastResult = result;
                const cube = this.sceneManager.getCube();
                if (result.success) {
                    // Frame-to-frame jump validation: if the new centroid is far
                    // from the current target, the detection probably latched
                    // onto something other than the cube. Reject — but give up
                    // the validation after MAX_REJECT_STREAK frames so the user
                    // can recover from a fast cube move.
                    const newCentroid = this._centroidOf(result.image_points);
                    const jumpedTooFar = (
                        this.target
                        && newCentroid
                        && this._distance(newCentroid, this.target) > MAX_FRAME_JUMP_PX
                        && this.rejectStreak < MAX_REJECT_STREAK
                    );
                    const driftedFromClick = (
                        this.originalClick
                        && newCentroid
                        && this._distance(newCentroid, this.originalClick) > MAX_DRIFT_FROM_CLICK_PX
                    );

                    if (jumpedTooFar || driftedFromClick) {
                        this.rejectStreak += 1;
                        this.failCount += 1;
                        this._drawDetectorDebug(null, result.candidates);
                        const reason = driftedFromClick ? 'drifted from click' : `jumped (${this.rejectStreak}/${MAX_REJECT_STREAK})`;
                        this._showStatus(`detection ${reason} — re-click to recover`);
                    } else {
                        this.rejectStreak = 0;
                        this.successCount += 1;
                        this.overlayManager.applyPose(result, cube);
                        cube.visible = true;
                        this._updateTargetFromDetection(result.image_points);
                        this._drawDetectorDebug(result.image_points, result.candidates);
                        this._showStatus(this.target ? 'cube locked · tracking hint' : 'cube locked');
                    }
                } else {
                    this.failCount += 1;
                    this._drawDetectorDebug(null, result.candidates);
                    this._showStatus('cube not visible');
                }
            } catch (err) {
                this.lastError = err.message;
                this._showError('tracking stopped: ' + err.message);
                this._stopTracking();
                return;
            }

            this._recordFrameTime();
            this._renderDebugPanel();
            this._updateViewportHeader();

            const elapsed = performance.now() - loopStart;
            const wait = Math.max(0, MIN_FRAME_INTERVAL_MS - elapsed);
            if (wait > 0) {
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }

    _centroidOf(points) {
        if (!points || points.length < 1) return null;
        let cx = 0, cy = 0;
        for (const [x, y] of points) { cx += x; cy += y; }
        return { x: cx / points.length, y: cy / points.length };
    }

    _distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _updateTargetFromDetection(points) {
        // If the user has set a target, update it (smoothly) toward the detected
        // centroid so the hint follows the cube as it moves. Without an existing
        // target we leave it null — user must click to opt-in.
        if (!this.target || !points || points.length < 4) return;
        let cx = 0, cy = 0;
        for (const [x, y] of points) { cx += x; cy += y; }
        cx /= points.length;
        cy /= points.length;
        this.target = {
            x: this.target.x + (cx - this.target.x) * TARGET_SMOOTHING,
            y: this.target.y + (cy - this.target.y) * TARGET_SMOOTHING,
        };
    }

    _recordFrameTime() {
        const now = performance.now();
        this.frameTimestamps.push(now);
        if (this.frameTimestamps.length > FPS_WINDOW) {
            this.frameTimestamps.shift();
        }
    }

    _recordLatency(latency) {
        this.latencies.push(latency);
        if (this.latencies.length > LATENCY_WINDOW) {
            this.latencies.shift();
        }
    }

    _computeFps() {
        if (this.frameTimestamps.length < 2) return 0;
        const span = this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];
        return span > 0 ? ((this.frameTimestamps.length - 1) / span) * 1000 : 0;
    }

    _computeAvgLatency() {
        if (this.latencies.length === 0) return 0;
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        return sum / this.latencies.length;
    }

    _computeSuccessRate() {
        if (this.frameCount === 0) return 0;
        return (this.successCount / this.frameCount) * 100;
    }

    _updateViewportHeader() {
        if (!this.webcamReady) {
            this.viewportHeader.textContent = 'CAM.0 // STANDBY';
            return;
        }
        const { width, height } = this.webcamHandler.getDimensions();
        const dim = `${width}×${height}`;
        if (this.tracking) {
            const fps = this._computeFps().toFixed(1);
            this.viewportHeader.textContent = `CAM.0 // ${dim} // ${fps} FPS`;
        } else {
            this.viewportHeader.textContent = `CAM.0 // ${dim}`;
        }
    }

    _updateFooter() {
        // Latency
        if (this.latencies.length > 0) {
            this.footerLatency.textContent = `${Math.round(this._computeAvgLatency())} ms`;
        } else {
            this.footerLatency.textContent = '—';
        }

        // Success rate
        if (this.frameCount > 0) {
            this.footerSuccess.textContent = `${this._computeSuccessRate().toFixed(0)}%`;
        } else {
            this.footerSuccess.textContent = '—';
        }

        // Uptime mm:ss (or hh:mm:ss for long sessions)
        const seconds = Math.floor((performance.now() - this.startTime) / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        this.footerUptime.textContent = h > 0
            ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    _renderDebugPanel() {
        // Always render exactly the same lines so the panel size never changes.
        const dim = this.webcamReady ? this.webcamHandler.getDimensions() : null;
        const placeholder = '—';

        let txLine = `tx,ty,tz : ${placeholder}`;
        let distLine = `distance : ${placeholder}`;
        let r0 = `R[0]     : ${placeholder}`;
        let r1 = `R[1]     : ${placeholder}`;
        let r2 = `R[2]     : ${placeholder}`;
        let detectLine = `detect   : ${placeholder}`;
        let methodLine = `method   : ${placeholder}`;

        if (this.lastResult && this.lastResult.success) {
            const t = this.lastResult.translation_vector;
            const dist = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
            const r = this.lastResult.rotation_matrix;
            txLine = `tx,ty,tz : ${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}`;
            distLine = `distance : ${dist.toFixed(3)} m`;
            r0 = `R[0]     : ${r[0].map(v => v.toFixed(2)).join(', ')}`;
            r1 = `R[1]     : ${r[1].map(v => v.toFixed(2)).join(', ')}`;
            r2 = `R[2]     : ${r[2].map(v => v.toFixed(2)).join(', ')}`;
            detectLine = `detect   : locked`;
            methodLine = `method   : ${this.lastResult.detection_method || '—'}`;
        } else if (this.lastResult && !this.lastResult.success) {
            detectLine = `detect   : ${this.lastResult.error_message || 'no cube'}`;
        }

        const errLine = `error    : ${this.lastError || placeholder}`;
        const targetLine = this.target
            ? `target   : ${Math.round(this.target.x)}, ${Math.round(this.target.y)}`
            : `target   : ${placeholder} (click cube)`;
        const c = this.overlayManager.getCalibration();
        const focalScale = this.sceneManager.isReady() ? this.sceneManager.getFocalScale() : 1.0;
        const levelTag = this.overlayManager.levelLock ? ' LVL' : '';
        const calibLine =
            `calib    : dxyz=(${c.dx.toFixed(3)},${c.dy.toFixed(3)},${c.dz.toFixed(3)}) s=${c.scale.toFixed(2)} f=${focalScale.toFixed(2)}${levelTag}`;

        const lines = [
            `tracking : ${this.tracking ? 'ON' : 'OFF'}`,
            `webcam   : ${this.webcamReady ? `${dim.width}x${dim.height}` : 'not ready'}`,
            `frame #  : ${this.frameCount}`,
            `fps      : ${this._computeFps().toFixed(1)}`,
            `success  : ${this.successCount}`,
            `failed   : ${this.failCount}`,
            targetLine,
            calibLine,
            '',
            detectLine,
            methodLine,
            txLine,
            distLine,
            r0,
            r1,
            r2,
            errLine,
        ];

        this.debugPanel.textContent = lines.join('\n');
    }

    _showStatus(message) {
        const el = document.getElementById('statusMessage');
        el.textContent = message;
        el.classList.add('show');
    }

    _showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('statusMessage').classList.remove('show');
    }

    _clearError() {
        document.getElementById('errorMessage').classList.remove('show');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
