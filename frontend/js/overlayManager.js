/**
 * Overlay Manager Module
 * Converts OpenCV pose data to Three.js transforms, smooths across frames,
 * and supports a manual calibration offset to fine-tune visual alignment.
 *
 * Calibration is in OBJECT space (relative to the cube's local frame), so
 * the offset rotates and translates with the cube as it moves. Adjust via
 * the keyboard hooks wired up in main.js.
 */

const CUBE_SIDE_LENGTH = 0.05;       // Must match backend config

class OverlayManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;

        // Manual calibration in WORLD space (camera-frame metres).
        // dx, dy, dz are added to the smoothed translation; scale multiplies
        // the model size on top of the physical 5cm cube.
        this.calib = { dx: 0, dy: 0, dz: 0, scale: 1.0 };

        // When true, ignore detected rotation and render the cube axis-aligned.
        // Useful when corner-detection noise makes the auto rotation drift /
        // bend even though the physical cube is upright.
        this.levelLock = false;
    }

    /**
     * Apply an already-smoothed pose (from poseFilter) to the 3D model.
     * poseData: { R: 3x3 row-major, t: [x,y,z] }
     */
    applyPose(poseData, model) {
        const { R, t } = poseData;

        const targetMat = new THREE.Matrix4();
        targetMat.set(
            R[0][0],  R[0][1],  R[0][2],  t[0],
            -R[1][0], -R[1][1], -R[1][2], -t[1],
            -R[2][0], -R[2][1], -R[2][2], -t[2],
            0,        0,        0,        1
        );

        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const _scale = new THREE.Vector3();
        targetMat.decompose(pos, quat, _scale);

        pos.x += this.calib.dx;
        pos.y += this.calib.dy;
        pos.z += this.calib.dz;

        const renderQuat = this.levelLock ? new THREE.Quaternion() : quat;

        const m = new THREE.Matrix4();
        m.compose(pos, renderQuat, new THREE.Vector3(1, 1, 1));

        const sz = CUBE_SIDE_LENGTH * this.calib.scale;
        const scaleMatrix = new THREE.Matrix4();
        scaleMatrix.makeScale(sz, sz, sz);

        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(m, scaleMatrix);

        model.matrixAutoUpdate = false;
        model.matrix.copy(finalMatrix);
        model.matrixWorldNeedsUpdate = true;
    }

    nudge(axis, delta) {
        if (axis === 'x') this.calib.dx += delta;
        else if (axis === 'y') this.calib.dy += delta;
        else if (axis === 'z') this.calib.dz += delta;
        else if (axis === 's') this.calib.scale = Math.max(0.1, Math.min(5.0, this.calib.scale + delta));
    }

    toggleLevelLock() {
        this.levelLock = !this.levelLock;
        return this.levelLock;
    }

    resetCalibration() {
        this.calib = { dx: 0, dy: 0, dz: 0, scale: 1.0 };
    }

    getCalibration() {
        return { ...this.calib };
    }

    reset() {
        // no-op — smoothing state lives in poseFilter.js now
    }
}

export default OverlayManager;
