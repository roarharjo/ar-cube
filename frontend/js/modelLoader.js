/**
 * Model Loader Module
 * Handles OBJ file upload, validation, parsing, and normalization.
 */

class ModelLoader {
    constructor() {
        this.objUpload = document.getElementById('objUpload');
        this.objStatus = document.getElementById('objStatus');
        this.loader = new THREE.OBJLoader();
        this.model = null;
        this.modelLoaded = false;

        this.maxFileSize = 1 * 1024 * 1024; // 1MB

        this._init();
    }

    _init() {
        this.objUpload.addEventListener('change', (e) => this._handleObjUpload(e));
    }

    _handleObjUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const validation = this._validateObjFile(file);
        if (!validation.valid) {
            this._showError(validation.error);
            this.objUpload.value = '';
            return;
        }

        this._loadObj(file);
    }

    _validateObjFile(file) {
        if (!file.name.toLowerCase().endsWith('.obj')) {
            return { valid: false, error: 'Invalid file type. Please upload an .obj file.' };
        }
        if (file.size > this.maxFileSize) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            return { valid: false, error: `OBJ file too large (${sizeMB}MB). Maximum is 1MB.` };
        }
        return { valid: true };
    }

    _loadObj(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const object = this.loader.parse(e.target.result);
                this.model = this._normalizeModel(object);
                this.modelLoaded = true;
                this._updateStatus(true);
                this._showStatus('OBJ model loaded successfully');

                window.dispatchEvent(new CustomEvent('modelLoaded', {
                    detail: { model: this.model }
                }));
            } catch (err) {
                this._showError('Failed to parse OBJ file: ' + err.message);
                this.modelLoaded = false;
                this._updateStatus(false);
            }
        };
        reader.readAsText(file);
    }

    /**
     * Normalize model: center geometry at origin, fit to unit bounding box.
     * Final scaling to physical cube size happens in overlayManager.
     */
    _normalizeModel(object) {
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        object.position.sub(center);
        if (maxDim > 0) {
            const scale = 1.0 / maxDim;
            object.scale.set(scale, scale, scale);
        }
        object.updateMatrixWorld(true);

        object.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshPhongMaterial({
                    color: 0x00ff88,
                    wireframe: false,
                    transparent: true,
                    opacity: 0.7,
                });
            }
        });

        return object;
    }

    getModel() {
        return this.model;
    }

    isReady() {
        return this.modelLoaded;
    }

    _updateStatus(loaded) {
        if (loaded) {
            this.objStatus.textContent = '✓ Loaded';
            this.objStatus.classList.add('loaded');
        } else {
            this.objStatus.textContent = 'Not loaded';
            this.objStatus.classList.remove('loaded');
        }
    }

    _showStatus(message) {
        const el = document.getElementById('statusMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('errorMessage').classList.remove('show');
    }

    _showError(message) {
        const el = document.getElementById('errorMessage');
        el.textContent = message;
        el.classList.add('show');
        document.getElementById('statusMessage').classList.remove('show');
    }
}

export default ModelLoader;
