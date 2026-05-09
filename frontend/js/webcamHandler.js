/**
 * Webcam Handler Module
 * Manages live webcam capture, video element streaming, and frame extraction.
 */

class WebcamHandler {
    constructor() {
        this.videoPlayer = document.getElementById('videoPlayer');
        this.frameCanvas = document.getElementById('frameCanvas');
        this.frameContext = this.frameCanvas.getContext('2d');
        this.startButton = document.getElementById('startCameraButton');
        this.cameraStatus = document.getElementById('cameraStatus');

        this.stream = null;
        this.ready = false;

        this._init();
    }

    _init() {
        this.startButton.addEventListener('click', () => this.start());
        this.videoPlayer.addEventListener('loadedmetadata', () => this._handleStreamReady());
        window.addEventListener('beforeunload', () => this.stop());
    }

    /**
     * Request webcam access and stream into video element.
     */
    async start() {
        if (this.ready) return;

        this._updateStatus('Requesting camera...');
        this.startButton.disabled = true;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            this.videoPlayer.srcObject = this.stream;
        } catch (err) {
            this._showError('Camera access denied or unavailable: ' + err.message);
            this._updateStatus('Camera off', false);
            this.startButton.disabled = false;
        }
    }

    /**
     * Stop the webcam stream.
     */
    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }
        this.ready = false;
    }

    _handleStreamReady() {
        if (!this.stream) return;
        this.ready = true;
        this._updateStatus('Camera live', true);
        this.frameCanvas.width = this.videoPlayer.videoWidth;
        this.frameCanvas.height = this.videoPlayer.videoHeight;

        window.dispatchEvent(new CustomEvent('webcamReady', {
            detail: {
                width: this.videoPlayer.videoWidth,
                height: this.videoPlayer.videoHeight,
            }
        }));
    }

    /**
     * Extract the current frame as a JPEG Blob.
     * @returns {Promise<Blob>}
     */
    extractFrame() {
        return new Promise((resolve, reject) => {
            if (!this.ready) {
                reject(new Error('Camera not ready'));
                return;
            }
            try {
                this.frameContext.drawImage(
                    this.videoPlayer,
                    0, 0,
                    this.frameCanvas.width,
                    this.frameCanvas.height
                );
                this.frameCanvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Failed to extract frame'));
                }, 'image/jpeg', 0.85);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Whether the webcam is streaming and ready.
     */
    isReady() {
        return this.ready;
    }

    /**
     * Get the stream dimensions.
     */
    getDimensions() {
        return {
            width: this.videoPlayer.videoWidth,
            height: this.videoPlayer.videoHeight,
        };
    }

    _updateStatus(text, isLive = false) {
        this.cameraStatus.textContent = text;
        this.cameraStatus.classList.toggle('loaded', isLive);
    }

    _showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('statusMessage').classList.remove('show');
    }
}

export default WebcamHandler;
