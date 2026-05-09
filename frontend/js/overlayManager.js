/**
 * Overlay Manager Module
 * Converts OpenCV pose data to Three.js transforms and applies to the model.
 */

const CUBE_SIDE_LENGTH = 0.05; // Must match backend config

class OverlayManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
    }

    /**
     * Apply pose estimation result to the 3D model.
     * @param {Object} poseData - Backend response with rotation_matrix, translation_vector
     * @param {THREE.Object3D} model - The loaded OBJ model
     */
    applyPose(poseData, model) {
        const { rotation_matrix: rot, translation_vector: tvec } = poseData;

        // OpenCV (X-right, Y-down, Z-forward) → Three.js (X-right, Y-up, Z-toward-camera)
        // Conversion: negate Y and Z rows of rotation, negate Y and Z of translation
        const matrix = new THREE.Matrix4();
        matrix.set(
            rot[0][0],  rot[0][1],  rot[0][2],  tvec[0],
            -rot[1][0], -rot[1][1], -rot[1][2], -tvec[1],
            -rot[2][0], -rot[2][1], -rot[2][2], -tvec[2],
            0,          0,          0,           1
        );

        // Model is normalized to a unit bounding box; scale to physical cube size
        const scaleMatrix = new THREE.Matrix4();
        scaleMatrix.makeScale(CUBE_SIDE_LENGTH, CUBE_SIDE_LENGTH, CUBE_SIDE_LENGTH);

        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(matrix, scaleMatrix);

        model.matrixAutoUpdate = false;
        model.matrix.copy(finalMatrix);
    }
}

export default OverlayManager;
