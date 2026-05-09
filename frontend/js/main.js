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

class App {
    constructor() {
        this.webcamHandler = new WebcamHandler();
        this.sceneManager = new SceneManager();
        this.apiClient = new ApiClient();
        this.overlayManager = new OverlayManager(this.sceneManager);
        this.interactionControls = new InteractionControls();

        this.trackingButton = document.getElementById('trackingButton');

        this.tracking = false;
        this.webcamReady = false;

        this._bindEvents();
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
        this.trackingButton.textContent = 'Stop Tracking';
        this._showStatus('Tracking...');
        this._clearError();
        this._trackingLoop();
    }

    _stopTracking() {
        this.tracking = false;
        this.trackingButton.textContent = 'Start Tracking';
        this._showStatus('Tracking stopped');
    }

    async _trackingLoop() {
        while (this.tracking) {
            const loopStart = performance.now();

            try {
                const frameBlob = await this.webcamHandler.extractFrame();
                const { width, height } = this.webcamHandler.getDimensions();
                const result = await this.apiClient.sendFrame(frameBlob, width, height);

                const cube = this.sceneManager.getCube();
                if (result.success) {
                    this.overlayManager.applyPose(result, cube);
                    cube.visible = true;
                    this._showStatus('Tracking — cube locked');
                } else {
                    // Keep last good pose; quiet status update
                    this._showStatus('Tracking — cube not visible');
                }
            } catch (err) {
                this._showError('Tracking stopped: ' + err.message);
                this._stopTracking();
                return;
            }

            const elapsed = performance.now() - loopStart;
            const wait = Math.max(0, MIN_FRAME_INTERVAL_MS - elapsed);
            if (wait > 0) {
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
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
