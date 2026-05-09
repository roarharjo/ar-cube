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

        this.tracking = false;
        this.webcamReady = false;

        this.frameCount = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.frameTimestamps = [];
        this.latencies = [];
        this.lastResult = null;
        this.lastError = null;

        this.startTime = performance.now();

        this._bindEvents();
        this._renderDebugPanel();
        this._updateViewportHeader();
        this._updateFooter();

        setInterval(() => this._updateFooter(), 1000);
    }

    _bindEvents() {
        window.addEventListener('webcamReady', (e) => this._onWebcamReady(e));
        this.trackingButton.addEventListener('click', () => this._toggleTracking());
    }

    _onWebcamReady(event) {
        const { width, height } = event.detail;
        this.webcamReady = true;

        if (!this.sceneManager.isReady()) {
            this.sceneManager.init(width, height);
            this.interactionControls.enable();
        }

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
    }

    async _trackingLoop() {
        while (this.tracking) {
            const loopStart = performance.now();
            this.frameCount += 1;

            try {
                const frameBlob = await this.webcamHandler.extractFrame();
                const { width, height } = this.webcamHandler.getDimensions();
                const result = await this.apiClient.sendFrame(frameBlob, width, height);
                const latency = performance.now() - loopStart;
                this._recordLatency(latency);

                this.lastResult = result;
                const cube = this.sceneManager.getCube();
                if (result.success) {
                    this.successCount += 1;
                    this.overlayManager.applyPose(result, cube);
                    cube.visible = true;
                    this._showStatus('cube locked');
                } else {
                    this.failCount += 1;
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
        } else if (this.lastResult && !this.lastResult.success) {
            detectLine = `detect   : ${this.lastResult.error_message || 'no cube'}`;
        }

        const errLine = `error    : ${this.lastError || placeholder}`;

        const lines = [
            `tracking : ${this.tracking ? 'ON' : 'OFF'}`,
            `webcam   : ${this.webcamReady ? `${dim.width}x${dim.height}` : 'not ready'}`,
            `frame #  : ${this.frameCount}`,
            `fps      : ${this._computeFps().toFixed(1)}`,
            `success  : ${this.successCount}`,
            `failed   : ${this.failCount}`,
            '',
            detectLine,
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
