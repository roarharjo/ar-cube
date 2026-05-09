/**
 * Scene Manager Module
 * Manages Three.js scene, camera, renderer, and the procedural glowing cube model.
 *
 * Glow is faked via multi-shell wireframe (stacked edges at increasing sizes with
 * decreasing opacity). This avoids the canvas-transparency issues that come with
 * EffectComposer-based bloom on a transparent overlay canvas.
 */

class SceneManager {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;
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
            premultipliedAlpha: false,
        });
        this.renderer.setSize(videoWidth, videoHeight);
        this.renderer.setClearColor(0x000000, 0);

        const fov = 2 * Math.atan(videoHeight / (2 * videoWidth)) * (180 / Math.PI);
        const aspect = videoWidth / videoHeight;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
        this.camera.position.set(0, 0, 0);

        this._buildCube();

        this.initialized = true;
        this._animate();
    }

    getCube() {
        return this.cube;
    }

    getCamera() {
        return this.camera;
    }

    isReady() {
        return this.initialized;
    }

    _buildCube() {
        const group = new THREE.Group();

        // Multi-shell wireframe — fakes a glow halo without postprocessing.
        // Inner shell is the real cube (size 1.0); outer shells are larger and
        // increasingly transparent, giving a soft halo around the edges.
        const shells = [
            { size: 1.00, opacity: 1.00 },
            { size: 1.04, opacity: 0.40 },
            { size: 1.08, opacity: 0.18 },
            { size: 1.14, opacity: 0.08 },
        ];
        for (const { size, opacity } of shells) {
            const geom = new THREE.BoxGeometry(size, size, size);
            const edges = new THREE.EdgesGeometry(geom);
            const material = new THREE.LineBasicMaterial({
                color: 0x00ffff, // cyan
                transparent: true,
                opacity,
                depthWrite: false,
            });
            group.add(new THREE.LineSegments(edges, material));
        }

        // Bright corner markers at the 8 vertices of the inner cube
        const cornerGeom = new THREE.SphereGeometry(0.04, 12, 12);
        const cornerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const half = 0.5;
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const sphere = new THREE.Mesh(cornerGeom, cornerMat);
                    sphere.position.set(sx * half, sy * half, sz * half);
                    group.add(sphere);
                }
            }
        }

        group.matrixAutoUpdate = false;
        group.visible = false; // shown after first successful pose

        this.cube = group;
        this.scene.add(group);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.initialized) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

export default SceneManager;
