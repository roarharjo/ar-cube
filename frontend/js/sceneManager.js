/**
 * Scene Manager Module
 * Manages Three.js scene, camera, renderer, postprocessing (bloom), lighting,
 * and the procedural glowing cube model.
 */

class SceneManager {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.cube = null;
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

        this._setupLights();
        this._setupPostprocessing(videoWidth, videoHeight);
        this._buildCube();

        this.initialized = true;
        this._animate();
    }

    /**
     * Get the procedurally-built cube. The overlay manager applies pose
     * transforms to this object.
     * @returns {THREE.Group}
     */
    getCube() {
        return this.cube;
    }

    /**
     * Get the current camera.
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Whether the scene has been initialized.
     * @returns {boolean}
     */
    isReady() {
        return this.initialized;
    }

    _setupLights() {
        // Subtle ambient — main visual punch comes from emissive bloom
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
    }

    _setupPostprocessing(width, height) {
        this.composer = new THREE.EffectComposer(this.renderer);
        this.composer.setSize(width, height);

        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // UnrealBloomPass: (resolution, strength, radius, threshold)
        // Threshold 0 = bloom everything bright; tune strength/radius for taste.
        const bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(width, height),
            1.2,  // strength
            0.6,  // radius
            0.0   // threshold
        );
        this.composer.addPass(bloomPass);
    }

    _buildCube() {
        // Unit cube — overlayManager scales by physical CUBE_SIDE_LENGTH (0.05m)
        const cubeGeom = new THREE.BoxGeometry(1, 1, 1);

        // Bright neon edges — bloom picks these up
        const edgesGeom = new THREE.EdgesGeometry(cubeGeom);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffff, // cyan
            linewidth: 2,
        });
        const wireframe = new THREE.LineSegments(edgesGeom, edgeMaterial);

        // Subtle inner fill, semi-transparent
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const fill = new THREE.Mesh(cubeGeom, fillMaterial);

        // Bright corner markers
        const cornerGeom = new THREE.SphereGeometry(0.03, 8, 8);
        const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const corners = new THREE.Group();
        const half = 0.5;
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const sphere = new THREE.Mesh(cornerGeom, cornerMaterial);
                    sphere.position.set(sx * half, sy * half, sz * half);
                    corners.add(sphere);
                }
            }
        }

        const group = new THREE.Group();
        group.add(fill);
        group.add(wireframe);
        group.add(corners);
        group.matrixAutoUpdate = false;
        group.visible = false; // Shown after first successful pose

        this.cube = group;
        this.scene.add(group);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.initialized) {
            this.composer.render();
        }
    }
}

export default SceneManager;
