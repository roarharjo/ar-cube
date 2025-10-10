# AR Cube Overlay Tool

A browser-based tool for testing AR overlay accuracy and pose estimation algorithms with real-world video footage of cubes. Upload a video of a cube and its matching 3D model, pause at any frame, and see the model automatically aligned using computer vision.

## Overview

This tool enables development teams to:
- Upload a video containing a real-world cube
- Upload a matching 3D model (OBJ file) that corresponds to the cube
- Pause the video at any frame
- Automatically detect the cube and estimate its pose using OpenCV
- Overlay the 3D model with precise alignment
- Zoom in/out to inspect alignment accuracy

## Architecture

- **Frontend**: Vanilla JavaScript with Three.js for 3D rendering
- **Backend**: FastAPI with OpenCV for computer vision and pose estimation
- **Key Technologies**: 
  - Three.js for 3D model rendering
  - OpenCV's solvePnP for pose estimation
  - HTML5 video and canvas APIs

## Project Structure

```
ar_cube/
├── frontend/
│   ├── index.html              # Main HTML interface
│   ├── css/
│   │   └── styles.css          # Application styling
│   └── js/
│       ├── main.js             # Application orchestration
│       ├── videoHandler.js     # Video upload and playback
│       ├── modelLoader.js      # OBJ file loading
│       ├── sceneManager.js     # Three.js scene setup
│       ├── apiClient.js        # Backend API communication
│       ├── overlayManager.js   # 3D model alignment
│       └── interactionControls.js  # Zoom controls
├── backend/
│   ├── main.py                 # FastAPI application entry point
│   ├── api/
│   │   └── routes.py           # API endpoints
│   ├── services/
│   │   ├── pose_estimator.py  # Pose estimation logic
│   │   └── feature_detector.py # Cube detection
│   ├── models/
│   │   └── schemas.py          # Pydantic models
│   └── utils/
│       └── image_processor.py  # Image processing utilities
└── tasks/
    ├── prd-ar-cube-overlay.md  # Product Requirements Document
    └── tasks-prd-ar-cube-overlay.md  # Task list

```

## Setup Instructions

### Prerequisites

- Python 3.13+ (or Python 3.8+ with compatible package versions)
- Modern web browser (Chrome, Firefox, Safari, or Edge)

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run the FastAPI server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   The backend API will be available at `http://localhost:8000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Open `index.html` in your web browser, or serve it using a simple HTTP server:
   ```bash
   # Python 3
   python3 -m http.server 8080
   
   # Then open http://localhost:8080 in your browser
   ```

## Usage

1. **Start the backend server** (see Backend Setup above)

2. **Open the frontend** in your web browser

3. **Upload files**:
   - Click "Upload Video" and select your video file containing the cube
   - Click "Upload OBJ Model" and select the matching 3D model file

4. **Play and pause** the video at the desired frame

5. **Align model**: Click the "Align Model" button to trigger pose estimation
   - The backend will detect the cube in the frame
   - The 3D model will be automatically aligned to match the cube's position and orientation

6. **Inspect alignment**: Use mouse wheel to zoom in/out and verify alignment accuracy

## API Documentation

Once the backend is running, view the interactive API documentation at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### Main Endpoint

**POST** `/api/estimate-pose`

Accepts a video frame image and returns pose estimation data.

**Request**: Multipart form data with image file

**Response**:
```json
{
  "success": true,
  "rotation_matrix": [[r11, r12, r13], [r21, r22, r23], [r31, r32, r33]],
  "translation_vector": [tx, ty, tz],
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "error_message": null
}
```

## Development

### Testing

- The tool is designed for internal testing and validation
- Test with the provided 17-second video and matching OBJ model
- Verify alignment accuracy through visual inspection
- Test across all major browsers

### Browser Compatibility

- ✅ Chrome (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Edge (latest)

## Troubleshooting

### Python Dependencies
If you encounter issues with Python 3.13, the requirements.txt uses version ranges that should be compatible. If problems persist, consider using Python 3.11 or 3.12.

### CORS Issues
The backend is configured to allow CORS for development. If you encounter CORS errors, verify the backend CORS middleware configuration in `main.py`.

### Video Format Issues
Ensure your video is in a web-compatible format (MP4, WebM). The HTML5 video element has limited codec support in some browsers.

## License

Internal testing tool - not for production use.

## Contact

For questions or issues, contact the development team.

