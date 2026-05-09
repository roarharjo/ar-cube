/**
 * API Client Module
 * Communicates with the backend pose estimation API.
 */

const API_BASE_URL = 'http://localhost:8000';

class ApiClient {
    /**
     * Send a video frame to the backend for pose estimation.
     * @param {Blob} frameBlob - JPEG image blob
     * @param {number} videoWidth
     * @param {number} videoHeight
     * @returns {Promise<Object>} Parsed JSON response
     */
    async sendFrame(frameBlob, videoWidth, videoHeight) {
        const formData = new FormData();
        formData.append('image', frameBlob, 'frame.jpg');

        const url = `${API_BASE_URL}/api/estimate-pose?video_width=${videoWidth}&video_height=${videoHeight}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                body: formData,
            });
        } catch (err) {
            throw new Error('Cannot connect to backend. Is the server running on localhost:8000?');
        }

        if (!response.ok) {
            let detail = `Server error (${response.status})`;
            try {
                const errData = await response.json();
                detail = errData.detail || detail;
            } catch {
                // ignore JSON parse failure on error responses
            }
            throw new Error(detail);
        }

        return response.json();
    }
}

export default ApiClient;
