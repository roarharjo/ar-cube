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
const POSE_TRANS_SMOOTHING = 0.30;   // translation EMA — keep responsive
const POSE_ROT_SMOOTHING = 0.15;     // rotation EMA — heavier dampening (rotation noise from IPPE is the dominant jitter source)

class OverlayManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this._smoothedPos = null;   // THREE.Vector3
        this._smoothedQuat = null;  // THREE.Quaternion

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
     * Apply pose estimation result to the 3D model.
     */
    applyPose(poseData, model) {
        const { rotation_matrix: rot, translation_vector: tvec } = poseData;

        // OpenCV → Three.js
        const targetMat = new THREE.Matrix4();
        targetMat.set(
            rot[0][0],  rot[0][1],  rot[0][2],  tvec[0],
            -rot[1][0], -rot[1][1], -rot[1][2], -tvec[1],
            -rot[2][0], -rot[2][1], -rot[2][2], -tvec[2],
            0,          0,          0,           1
        );

        const targetPos = new THREE.Vector3();
        const targetQuat = new THREE.Quaternion();
        const _scale = new THREE.Vector3();
        targetMat.decompose(targetPos, targetQuat, _scale);

        if (this._smoothedPos === null) {
            this._smoothedPos = targetPos.clone();
            this._smoothedQuat = targetQuat.clone();
        } else {
            this._smoothedPos.lerp(targetPos, POSE_TRANS_SMOOTHING);
            this._smoothedQuat.slerp(targetQuat, POSE_ROT_SMOOTHING);
        }

        // Apply manual calibration offset (in camera/world space)
        const adjustedPos = this._smoothedPos.clone();
        adjustedPos.x += this.calib.dx;
        adjustedPos.y += this.calib.dy;
        adjustedPos.z += this.calib.dz;

        const renderQuat = this.levelLock
            ? new THREE.Quaternion()  // identity = no rotation, upright cube
            : this._smoothedQuat;

        const smoothedMat = new THREE.Matrix4();
        smoothedMat.compose(
            adjustedPos,
            renderQuat,
            new THREE.Vector3(1, 1, 1),
        );

        // Physical scale * calibration scale
        const sz = CUBE_SIDE_LENGTH * this.calib.scale;
        const scaleMatrix = new THREE.Matrix4();
        scaleMatrix.makeScale(sz, sz, sz);

        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(smoothedMat, scaleMatrix);

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
        this._smoothedPos = null;
        this._smoothedQuat = null;
    }
}

export default OverlayManager;
