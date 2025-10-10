# Task List: AR Cube Overlay Tool

Generated from: `prd-ar-cube-overlay.md`

## Relevant Files

### Frontend Files
- `frontend/index.html` - ✅ Main HTML structure with video player, OBJ model upload controls, Three.js canvas, and loading spinner
- `frontend/css/styles.css` - ✅ Modern UI styling with gradient background, responsive layout, animations, and status indicators
- `frontend/js/main.js` - Main application initialization and workflow orchestration
- `frontend/js/videoHandler.js` - ✅ Video upload, validation, playback control, frame extraction to Blob, and status indicators
- `frontend/js/modelLoader.js` - Matching OBJ file loading and parsing using Three.js OBJLoader
- `frontend/js/sceneManager.js` - Three.js scene, camera, renderer, and lighting setup
- `frontend/js/apiClient.js` - API communication with backend (send frames, receive pose data)
- `frontend/js/overlayManager.js` - Matching 3D model alignment, pose transformation, and overlay rendering
- `frontend/js/interactionControls.js` - Zoom controls and user interaction handlers

### Backend Files
- `backend/main.py` - FastAPI application entry point with CORS configuration
- `backend/api/routes.py` - API endpoint definitions for pose estimation
- `backend/services/pose_estimator.py` - Pose estimation logic using OpenCV's solvePnP
- `backend/services/feature_detector.py` - Cube feature detection using OpenCV
- `backend/models/schemas.py` - Pydantic models for API request/response validation
- `backend/utils/image_processor.py` - Image processing utilities (decoding, format conversion)
- `backend/config.py` - Configuration settings and constants
- `backend/requirements.txt` - ✅ Python dependencies (FastAPI, OpenCV, NumPy, uvicorn, python-multipart, Pillow)

### Configuration Files
- `.gitignore` - ✅ Git ignore patterns for Python cache, venv, IDE files, OS files, etc.
- `README.md` - ✅ Project documentation with overview, setup instructions, usage guide, and API documentation
- `backend/.env.example` - Example environment variables

### Notes
- This project uses vanilla JavaScript for the frontend (no build step required)
- Backend uses Python 3.8+ with FastAPI
- Three.js will be loaded via CDN in the HTML file
- The OBJ file being uploaded is a matching 3D model that corresponds to the physical cube in the video
- Both the video and matching OBJ model must be uploaded for the tool to function
- No testing framework is specified in the PRD, so test files are not included
- Focus is on functionality and accuracy rather than extensive testing

## Tasks

- [x] 1.0 Project Setup and Infrastructure
  - [x] 1.1 Create project directory structure (`frontend/`, `backend/`, `tasks/`)
  - [x] 1.2 Initialize backend Python virtual environment
  - [x] 1.3 Create `backend/requirements.txt` with FastAPI, OpenCV (opencv-python), NumPy, uvicorn, python-multipart, and Pillow
  - [x] 1.4 Install backend Python dependencies
  - [x] 1.5 Create `.gitignore` file to exclude `venv/`, `__pycache__/`, `.env`, etc.
  - [x] 1.6 Create basic `README.md` with project overview and setup instructions
  - [x] 1.7 Create frontend directory structure (`css/`, `js/` folders)
  
- [x] 2.0 Frontend Video Upload and Playback System
  - [x] 2.1 Create `frontend/index.html` with basic HTML5 structure
  - [x] 2.2 Add video upload input element with accept attribute for video formats (MP4, WebM, AVI)
  - [x] 2.3 Add separate OBJ file upload input element for the matching cube model
  - [x] 2.4 Add HTML5 `<video>` element with controls attribute for playback
  - [x] 2.5 Add canvas element for Three.js rendering overlay
  - [x] 2.6 Include Three.js library via CDN in HTML
  - [x] 2.7 Create `frontend/css/styles.css` with layout styling (centered video, separate upload buttons for video and OBJ)
  - [x] 2.8 Create `frontend/js/videoHandler.js` to handle video file upload
  - [x] 2.9 Implement video file validation (check file type and size)
  - [x] 2.10 Display uploaded video in the video player element
  - [x] 2.11 Add event listener for video pause event
  - [x] 2.12 Implement frame extraction: draw current video frame to a hidden canvas
  - [x] 2.13 Convert canvas content to Blob (JPEG format) for backend transmission
  - [x] 2.14 Add visual feedback (loading spinner, status messages) during frame processing
  - [x] 2.15 Display status indicators showing when video and OBJ model are successfully loaded

- [ ] 3.0 Backend API and Pose Estimation Engine
  - [ ] 3.1 Create `backend/main.py` and initialize FastAPI application
  - [ ] 3.2 Configure CORS middleware to allow frontend origin (allow all origins for development)
  - [ ] 3.3 Create `backend/models/schemas.py` with Pydantic models for PoseResponse
  - [ ] 3.4 Define PoseResponse schema with fields: success, rotation_matrix, translation_vector, camera_matrix, error_message
  - [ ] 3.5 Create `backend/api/routes.py` with POST endpoint `/api/estimate-pose`
  - [ ] 3.6 Implement endpoint to accept multipart/form-data image upload
  - [ ] 3.7 Create `backend/utils/image_processor.py` for image decoding and validation
  - [ ] 3.8 Convert uploaded image to OpenCV format (numpy array)
  - [ ] 3.9 Create `backend/services/feature_detector.py` for cube corner/edge detection
  - [ ] 3.10 Implement feature detection using OpenCV methods (e.g., cv2.goodFeaturesToTrack or ArUco marker detection)
  - [ ] 3.11 Create `backend/services/pose_estimator.py` for pose estimation logic
  - [ ] 3.12 Define 3D object points for the cube (cube corner coordinates in 3D space)
  - [ ] 3.13 Define or estimate camera intrinsic matrix (focal length, principal point)
  - [ ] 3.14 Implement cv2.solvePnP to calculate rotation and translation vectors
  - [ ] 3.15 Convert rotation vector to rotation matrix using cv2.Rodrigues
  - [ ] 3.16 Serialize pose data to JSON format matching the schema
  - [ ] 3.17 Implement error handling for failed detection (return success: false with error message)
  - [ ] 3.18 Add input validation and appropriate HTTP status codes
  - [ ] 3.19 Test endpoint manually using curl or Postman with sample image

- [ ] 4.0 Frontend 3D Model Loading and Rendering
  - [ ] 4.1 Add OBJ file upload input element in `frontend/index.html` for the matching cube model
  - [ ] 4.2 Create `frontend/js/modelLoader.js` to handle matching OBJ file upload
  - [ ] 4.3 Implement file size validation (max 1MB as per PRD)
  - [ ] 4.4 Use Three.js OBJLoader to parse and load the matching OBJ file
  - [ ] 4.5 Create `frontend/js/sceneManager.js` for Three.js setup
  - [ ] 4.6 Initialize Three.js scene with appropriate background (transparent or video frame)
  - [ ] 4.7 Set up Three.js PerspectiveCamera with appropriate FOV and aspect ratio
  - [ ] 4.8 Initialize WebGL renderer and attach to canvas element
  - [ ] 4.9 Add ambient and directional lighting to the scene
  - [ ] 4.10 Add loaded matching 3D model to the scene
  - [ ] 4.11 Implement basic render loop with requestAnimationFrame
  - [ ] 4.12 Configure camera parameters to match video perspective (may need calibration data from backend)

- [ ] 5.0 3D Model Alignment and Interactive Overlay
  - [ ] 5.1 Create `frontend/js/apiClient.js` for backend communication
  - [ ] 5.2 Implement function to send extracted frame to `/api/estimate-pose` endpoint
  - [ ] 5.3 Handle API response and parse pose data JSON
  - [ ] 5.4 Create `frontend/js/overlayManager.js` for alignment logic
  - [ ] 5.5 Receive rotation matrix and translation vector from pose data
  - [ ] 5.6 Convert OpenCV coordinate system to Three.js coordinate system (handle axis differences)
  - [ ] 5.7 Apply rotation matrix to matching 3D model using Three.js Matrix4
  - [ ] 5.8 Apply translation vector to position the matching 3D model correctly over the physical cube
  - [ ] 5.9 Adjust camera intrinsic parameters based on backend camera_matrix
  - [ ] 5.10 Composite video frame and matching 3D model in the same viewport
  - [ ] 5.11 Create `frontend/js/interactionControls.js` for zoom functionality
  - [ ] 5.12 Implement mouse wheel zoom that adjusts camera position or FOV
  - [ ] 5.13 Ensure alignment is maintained during zoom operations
  - [ ] 5.14 Add UI controls for triggering pose estimation (e.g., "Align Model" button) - only enabled when both video and OBJ are loaded
  - [ ] 5.15 Display loading indicator while waiting for backend response
  - [ ] 5.16 Display error messages from backend if cube detection fails
  - [ ] 5.17 Add success notification when matching model is successfully aligned
  - [ ] 5.18 Create `frontend/js/main.js` to orchestrate all modules and initialize the application
  - [ ] 5.19 Test full workflow: upload video → upload matching OBJ → pause → align → zoom
  - [ ] 5.20 Verify that the matching OBJ model correctly overlays the physical cube in the video
  - [ ] 5.21 Test in Chrome, Firefox, Safari, and Edge browsers
  - [ ] 5.22 Debug and fix any alignment accuracy issues
  - [ ] 5.23 Optimize rendering performance for smooth interaction

---

**Status**: Complete task list generated with sub-tasks and relevant files identified.
