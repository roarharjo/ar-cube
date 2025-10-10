# Product Requirements Document: AR Cube Overlay Tool

## 1. Introduction/Overview

This document outlines the requirements for building a browser-based AR cube overlay tool. The tool enables users to upload a video file containing a real-world cube and a matching 3D model (OBJ file), pause the video at any frame, and overlay the 3D model onto the cube in that still frame. The system uses FastAPI and OpenCV on the backend for feature detection and pose estimation, and Three.js on the frontend for 3D rendering.

**Problem Statement:** Development teams need a way to test and validate AR overlay accuracy and pose estimation algorithms with real-world video footage of cubes when they have a corresponding 3D model.

**Solution:** A web-based tool that accepts both a video and its matching OBJ model, automates cube detection, and aligns the 3D model to match the physical cube, providing immediate visual feedback on pose estimation accuracy.

## 2. Goals

1. Enable users to upload a video file containing a real-world cube and pause it at any desired frame
2. Enable users to upload a matching OBJ file that corresponds to the cube in the video
3. Automatically detect the cube in the paused frame using computer vision
4. Calculate accurate pose (rotation and translation) of the detected cube
5. Overlay the matching 3D model on the cube with correct alignment based on pose estimation
6. Provide a seamless, interactive experience with zoom functionality
7. Serve as an internal testing tool for the development team to validate AR algorithms

## 3. User Stories

**As a** developer on the testing team,  
**I want to** upload a video of a cube and its matching OBJ model,  
**So that** I can test AR overlay with the correct 3D representation of the physical cube.

**As a** developer on the testing team,  
**I want to** pause the video at any frame,  
**So that** I can test pose estimation at different angles and positions.

**As a** developer on the testing team,  
**I want to** see the matching 3D model automatically aligned to the real cube in the video,  
**So that** I can visually validate the accuracy of the pose estimation algorithm.

**As a** developer on the testing team,  
**I want to** zoom in and out on the overlaid 3D model,  
**So that** I can inspect the alignment accuracy in detail.

**As a** developer on the testing team,  
**I want to** use the tool in any major browser,  
**So that** all team members can access it regardless of their preferred browser.

## 4. Functional Requirements

### Frontend Requirements

**FR-1.0 Video Upload**
- FR-1.1: The system must provide a file upload interface for video files
- FR-1.2: The system must accept video files in common formats (MP4, WebM, AVI)
- FR-1.3: The system must display the uploaded video in a video player component
- FR-1.4: The system must handle the specific 17-second test video provided for the project

**FR-2.0 Video Playback**
- FR-2.1: The system must allow users to play the uploaded video
- FR-2.2: The system must allow users to pause the video at any frame
- FR-2.3: The system must display standard video controls (play, pause, seek)

**FR-3.0 Frame Extraction**
- FR-3.1: When the user pauses the video, the system must extract the current frame
- FR-3.2: The system must convert the extracted frame to a format suitable for backend processing (e.g., JPEG, PNG)
- FR-3.3: The system must send the extracted frame to the backend via HTTP request

**FR-4.0 3D Model Loading**
- FR-4.1: The system must provide a file upload interface for OBJ files
- FR-4.2: The system must accept the specific OBJ file that matches the cube in the video
- FR-4.3: The system must load and parse OBJ files up to 1MB in size
- FR-4.4: The system must render the 3D model using Three.js
- FR-4.5: The system must support geometry-only OBJ files (no texture/material requirements)
- FR-4.6: The system must have manual upload capability to support future development workflows

**FR-5.0 3D Model Alignment**
- FR-5.1: The system must receive pose data (rotation and translation matrices) from the backend
- FR-5.2: The system must apply the pose transformation to the matching 3D model
- FR-5.3: The system must position the 3D model to precisely align with the detected cube in the video frame
- FR-5.4: The system must ensure the uploaded OBJ model matches the physical cube's dimensions and proportions
- FR-5.5: The system must maintain alignment accuracy as the primary success metric

**FR-6.0 Real-Time Overlay**
- FR-6.1: The system must overlay the aligned 3D model on top of the paused video frame
- FR-6.2: The system must render the overlay in real-time without noticeable lag
- FR-6.3: The system must composite the 3D model and video frame in the same viewport

**FR-7.0 User Interaction**
- FR-7.1: The system must allow users to zoom in and out on the overlaid scene
- FR-7.2: The system must maintain the alignment relationship during zoom operations
- FR-7.3: The zoom interaction must be smooth and responsive

**FR-8.0 Browser Compatibility**
- FR-8.1: The system must function correctly in Chrome (latest version)
- FR-8.2: The system must function correctly in Firefox (latest version)
- FR-8.3: The system must function correctly in Safari (latest version)
- FR-8.4: The system must function correctly in Edge (latest version)

### Backend Requirements

**FR-9.0 REST API**
- FR-9.1: The system must provide a FastAPI endpoint to receive video frames
- FR-9.2: The endpoint must accept image data in common formats (JPEG, PNG)
- FR-9.3: The endpoint must return pose data in JSON format
- FR-9.4: The API must handle CORS requests from the frontend

**FR-10.0 Feature Detection**
- FR-10.1: The system must use OpenCV to detect features in the received frame
- FR-10.2: The system must identify the cube's corners or edges in the image
- FR-10.3: The system must handle the specific cube object provided for this project

**FR-11.0 Pose Estimation**
- FR-11.1: The system must use OpenCV's solvePnP algorithm for pose estimation
- FR-11.2: The system must calculate the rotation matrix of the cube relative to the camera
- FR-11.3: The system must calculate the translation vector of the cube relative to the camera
- FR-11.4: The pose estimation accuracy must be sufficient for visually correct 3D alignment

**FR-12.0 Data Serialization**
- FR-12.1: The system must serialize pose data (rotation and translation) into JSON format
- FR-12.2: The JSON response must include rotation matrix (3x3 or quaternion)
- FR-12.3: The JSON response must include translation vector (x, y, z)
- FR-12.4: The system must include camera intrinsic parameters if needed for frontend rendering

**FR-13.0 Error Handling**
- FR-13.1: The system must return appropriate error messages if cube detection fails
- FR-13.2: The system must validate input data and return clear error messages for invalid inputs
- FR-13.3: The frontend must display backend error messages to the user

## 5. Non-Goals (Out of Scope)

1. **Multi-cube detection**: The system will not detect or track multiple cubes in a single frame
2. **Real-time video processing**: The system will not process video in real-time; it only processes paused frames
3. **Manual alignment tools**: No manual adjustment controls for fine-tuning the 3D model position (automatic alignment only)
4. **Export functionality**: No ability to save or export the overlaid frame as an image or video
5. **Texture/material support**: The system will not support textured 3D models, only geometry
6. **Mobile optimization**: No specific optimizations for mobile or tablet devices
7. **User authentication**: No login or user management system (internal tool only)
8. **Multiple video/model management**: No database or storage for managing multiple videos or 3D models
9. **Rotation interaction**: Users cannot manually rotate the 3D model; only zoom is supported
10. **Production deployment**: This is an internal testing tool, not a production-ready application

## 6. Design Considerations

### User Interface
- Clean, minimal interface focused on the core workflow: upload video + OBJ → pause → overlay
- Video player should be prominent and easy to control
- Upload buttons should be clearly labeled and separate for video file and matching OBJ model file
- Display clear status messages during processing (e.g., "Processing frame...", "Aligning model...")
- Show error messages clearly when detection fails
- Indicate when both video and OBJ model have been successfully loaded

### Layout Suggestions
- Single-page application layout
- Video player in the center of the screen
- Upload controls above or beside the video player
- 3D overlay renders directly on top of the video frame
- Zoom controls accessible via mouse scroll or UI buttons

### Visual Feedback
- Loading indicator while backend processes the frame
- Success/error notifications for upload and processing operations
- Visual confirmation when 3D model is successfully aligned

## 7. Technical Considerations

### Frontend
- **Three.js**: Use for 3D rendering and camera management
- **HTML5 `<video>` element**: For native video playback
- **Canvas API**: For frame extraction from video
- **Fetch API**: For HTTP communication with backend
- **Camera setup**: Configure Three.js camera to match the video frame's perspective

### Backend
- **FastAPI**: Lightweight and fast for REST API
- **OpenCV**: Use `cv2.solvePnP` for pose estimation
- **NumPy**: For matrix operations and transformations
- **CORS middleware**: Configure to allow frontend origin
- **Image processing**: Use OpenCV's feature detection algorithms (e.g., corner detection, ArUco markers if applicable)

### Data Format
The backend should return pose data in the following JSON structure:
```json
{
  "success": true,
  "rotation_matrix": [[r11, r12, r13], [r21, r22, r23], [r31, r32, r33]],
  "translation_vector": [tx, ty, tz],
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "error_message": null
}
```

### Known Dependencies
- Both the video and matching OBJ model must be uploaded before pose estimation can begin
- The frontend must wait for pose data from the backend before attempting alignment
- The 3D model must be loaded before processing can begin
- The uploaded OBJ model must geometrically match the physical cube in the video
- Camera intrinsic parameters must match between the video capture device and the Three.js camera

## 8. Success Metrics

**Primary Metric:**
- **Alignment Accuracy**: The 3D model must visually align with the real cube in the video frame with minimal perceivable error. Success is measured by visual inspection by the development team.

**Secondary Metrics:**
- **Processing Time**: Backend should return pose data within a reasonable time (target: < 3 seconds per frame)
- **Detection Success Rate**: The system should successfully detect the cube in frames where it is clearly visible (target: > 90% success rate)
- **Browser Compatibility**: Tool functions correctly in all four major browsers without errors

**Validation Method:**
- Manual testing by the development team with the provided 17-second test video and matching OBJ model
- Visual inspection of alignment at multiple pause points in the video
- Verification that the uploaded OBJ model correctly overlays the physical cube
- Testing zoom functionality to inspect alignment details

## 9. Open Questions

1. **Cube Specifications**: What are the exact dimensions and visual characteristics of the physical cube in the test video? (needed for calibration)
2. **Camera Calibration**: Do we have camera intrinsic parameters for the camera that recorded the test video? If not, should we estimate them?
3. **Feature Detection Method**: Should we use ArUco markers, chessboard patterns, or natural feature detection for the cube? What markers/patterns exist on the physical cube?
4. **Coordinate System**: What coordinate system should be used for the 3D model alignment? (e.g., cube center as origin, or specific corner?)
5. **Error Threshold**: What is the acceptable margin of error for alignment? (e.g., maximum pixel offset)
6. **Deployment Environment**: Where will this tool be hosted for internal team access? (localhost, internal server, cloud platform?)
7. **Model Origin**: Does the provided matching OBJ model need any preprocessing or is it already aligned to match the physical cube's coordinate system?
8. **OBJ-Video Correspondence**: Are the dimensions in the OBJ file in the same units/scale as needed for the pose estimation calculations?

---

## Appendix: Technical Stack Summary

| Component | Technology |
|-----------|------------|
| Frontend Framework | Vanilla JavaScript (or React/Vue if preferred) |
| 3D Rendering | Three.js |
| Video Playback | HTML5 `<video>` |
| HTTP Client | Fetch API |
| Backend Framework | FastAPI (Python) |
| Computer Vision | OpenCV (cv2) |
| Numerical Computing | NumPy |
| API Format | REST with JSON |
| Development Browsers | Chrome, Firefox, Safari, Edge (latest versions) |

---

**Document Version**: 1.0  
**Last Updated**: October 10, 2025  
**Target Audience**: Junior Developer  
**Estimated Complexity**: Medium
