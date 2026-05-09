/**
 * Scene Manager Module
 * Manages Three.js scene, camera, renderer, and lighting.
 */

class SceneManager {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;
        this.model = null;
        this.initialized = false;
    }

    /**
     * Initialize the Three.js scene with video dimensions.
     * @param {number} videoWidth
     * @param {number} videoHeight
     */
    init(videoWidth, videoHeight) {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
        });
        this.renderer.setSize(videoWidth, videoHeight);
        this.renderer.setClearColor(0x000000, 0);

        const fov = 2 * Math.atan(videoHeight / (2 * videoWidth)) * (180 / Math.PI);
        const aspect = videoWidth / videoHeight;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
        this.camera.position.set(0, 0, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(1, 1, 1);
        this.scene.add(directional);

        this.initialized = true;
        this._animate();
    }

    /**
     * Set the 3D model in the scene.
     * @param {THREE.Object3D} model
     */
    setModel(model) {
        if (this.model) {
            this.scene.remove(this.model);
        }
        this.model = model;
        this.model.matrixAutoUpdate = false;
        this.scene.add(this.model);
    }

    /**
     * Get the current camera.
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Render loop.
     */
    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.initialized) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Check if the scene is initialized.
     * @returns {boolean}
     */
    isReady() {
        return this.initialized;
    }
}

export default SceneManager;
