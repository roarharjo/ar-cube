/**
 * Interaction Controls Module
 * Handles mouse wheel zoom by scaling the entire video container (both video and overlay together).
 * Scaling the container preserves AR overlay alignment because video and canvas scale uniformly.
 */

const ZOOM_SPEED = 0.001;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4.0;

class InteractionControls {
    constructor() {
        this.container = null;
        this.scale = 1.0;
        this.enabled = false;
    }

    enable() {
        this.container = document.querySelector('.video-container');
        this.container.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false });
        this.enabled = true;
    }

    _handleWheel(event) {
        if (!this.enabled) return;
        event.preventDefault();

        const delta = -event.deltaY * ZOOM_SPEED;
        this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta));
        this.container.style.transform = `scale(${this.scale})`;
        this.container.style.transformOrigin = 'center center';
    }
}

export default InteractionControls;
