/**
 * Video Handler Module
 * Handles video file upload, validation, playback, and frame extraction
 */

class VideoHandler {
    constructor() {
        this.videoPlayer = document.getElementById('videoPlayer');
        this.videoUpload = document.getElementById('videoUpload');
        this.videoStatus = document.getElementById('videoStatus');
        this.frameCanvas = document.getElementById('frameCanvas');
        this.frameContext = this.frameCanvas.getContext('2d');
        this.videoLoaded = false;
        this.currentVideoFile = null;

        // Video validation constraints
        this.maxVideoSize = 100 * 1024 * 1024; // 100MB
        this.acceptedFormats = ['video/mp4', 'video/webm', 'video/avi', 'video/quicktime'];

        this.init();
    }

    init() {
        // Set up event listeners
        this.videoUpload.addEventListener('change', (e) => this.handleVideoUpload(e));
        this.videoPlayer.addEventListener('pause', () => this.handleVideoPause());
        this.videoPlayer.addEventListener('loadedmetadata', () => this.handleVideoLoaded());
        this.videoPlayer.addEventListener('error', (e) => this.handleVideoError(e));
    }

    /**
     * Handle video file upload
     */
    handleVideoUpload(event) {
        const file = event.target.files[0];
        
        if (!file) {
            return;
        }

        // Validate the video file
        const validation = this.validateVideoFile(file);
        
        if (!validation.valid) {
            this.showError(validation.error);
            this.videoUpload.value = ''; // Reset input
            return;
        }

        this.currentVideoFile = file;
        this.loadVideo(file);
    }

    /**
     * Validate video file type and size
     */
    validateVideoFile(file) {
        // Check file type
        if (!this.acceptedFormats.includes(file.type)) {
            return {
                valid: false,
                error: `Invalid video format. Please upload MP4, WebM, or AVI files. (Got: ${file.type})`
            };
        }

        // Check file size
        if (file.size > this.maxVideoSize) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const maxSizeMB = (this.maxVideoSize / (1024 * 1024)).toFixed(0);
            return {
                valid: false,
                error: `Video file too large (${sizeMB}MB). Maximum size is ${maxSizeMB}MB.`
            };
        }

        return { valid: true };
    }

    /**
     * Load video file into video player
     */
    loadVideo(file) {
        const videoURL = URL.createObjectURL(file);
        this.videoPlayer.src = videoURL;
        this.videoPlayer.load();
        
        this.showStatus('Video uploading...');
    }

    /**
     * Handle video loaded metadata event
     */
    handleVideoLoaded() {
        this.videoLoaded = true;
        this.updateVideoStatus(true);
        this.showStatus(`Video loaded successfully! Duration: ${this.getVideoDuration()}`);
        
        // Update canvas size to match video
        this.frameCanvas.width = this.videoPlayer.videoWidth;
        this.frameCanvas.height = this.videoPlayer.videoHeight;

        // Dispatch custom event to notify other modules
        window.dispatchEvent(new CustomEvent('videoLoaded', {
            detail: {
                width: this.videoPlayer.videoWidth,
                height: this.videoPlayer.videoHeight,
                duration: this.videoPlayer.duration
            }
        }));
    }

    /**
     * Handle video error event
     */
    handleVideoError(event) {
        console.error('Video error:', event);
        this.showError('Failed to load video. Please try a different file.');
        this.videoLoaded = false;
        this.updateVideoStatus(false);
    }

    /**
     * Handle video pause event
     */
    handleVideoPause() {
        if (!this.videoLoaded) {
            return;
        }

        console.log('Video paused at:', this.videoPlayer.currentTime);
        
        // Dispatch custom event with pause info
        window.dispatchEvent(new CustomEvent('videoPaused', {
            detail: {
                currentTime: this.videoPlayer.currentTime,
                canExtractFrame: true
            }
        }));
    }

    /**
     * Extract current frame from video as a Blob
     * Returns a Promise that resolves with the frame Blob
     */
    extractFrame() {
        return new Promise((resolve, reject) => {
            if (!this.videoLoaded) {
                reject(new Error('No video loaded'));
                return;
            }

            if (this.videoPlayer.paused || this.videoPlayer.ended) {
                try {
                    // Draw current video frame to canvas
                    this.frameContext.drawImage(
                        this.videoPlayer,
                        0,
                        0,
                        this.frameCanvas.width,
                        this.frameCanvas.height
                    );

                    // Convert canvas to Blob (JPEG format)
                    this.frameCanvas.toBlob((blob) => {
                        if (blob) {
                            console.log('Frame extracted:', {
                                size: blob.size,
                                type: blob.type,
                                time: this.videoPlayer.currentTime
                            });
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to convert canvas to blob'));
                        }
                    }, 'image/jpeg', 0.95); // High quality JPEG
                } catch (error) {
                    console.error('Frame extraction error:', error);
                    reject(error);
                }
            } else {
                reject(new Error('Video must be paused to extract frame'));
            }
        });
    }

    /**
     * Get video duration as formatted string
     */
    getVideoDuration() {
        const duration = this.videoPlayer.duration;
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Update video status indicator
     */
    updateVideoStatus(loaded) {
        if (loaded) {
            this.videoStatus.textContent = '✓ Loaded';
            this.videoStatus.classList.add('loaded');
        } else {
            this.videoStatus.textContent = 'Not loaded';
            this.videoStatus.classList.remove('loaded');
        }
    }

    /**
     * Show status message
     */
    showStatus(message) {
        const statusMessage = document.getElementById('statusMessage');
        statusMessage.textContent = message;
        statusMessage.classList.add('show');
        
        // Hide error message if showing
        document.getElementById('errorMessage').classList.remove('show');
    }

    /**
     * Show error message
     */
    showError(message) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
        
        // Hide status message if showing
        document.getElementById('statusMessage').classList.remove('show');
    }

    /**
     * Check if video is loaded and ready
     */
    isReady() {
        return this.videoLoaded;
    }

    /**
     * Get current video time
     */
    getCurrentTime() {
        return this.videoPlayer.currentTime;
    }

    /**
     * Get video dimensions
     */
    getVideoDimensions() {
        return {
            width: this.videoPlayer.videoWidth,
            height: this.videoPlayer.videoHeight
        };
    }
}

// Export for use in other modules
export default VideoHandler;

