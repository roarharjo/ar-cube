# AR-Cube Docker Dev Setup Design

**Date:** 2026-05-09
**Scope:** Containerize backend + frontend for local development convenience
**Goal:** `docker compose up` starts both services with hot-reload and source-mounted

---

## Architecture

Two services orchestrated by `docker-compose.yml` at the project root:

| Service | Base image | Purpose | Port |
|---------|-----------|---------|------|
| `backend` | `python:3.11-slim` | FastAPI + OpenCV pose estimation API | 8000 |
| `frontend` | `nginx:alpine` | Static file server for HTML/CSS/JS | 3000 |

Both services mount their respective source directories as volumes, so code changes are reflected without rebuild. Backend runs uvicorn with `--reload` to auto-restart on Python changes.

## Files to Add

- `backend/Dockerfile` — Python deps + uvicorn entry
- `backend/.dockerignore` — exclude `venv/`, `__pycache__`, `.pytest_cache`
- `frontend/Dockerfile` — nginx-alpine
- `frontend/.dockerignore` — minimal (no large excludes needed)
- `docker-compose.yml` — service orchestration

## Files to Modify

- `backend/requirements.txt` — switch `opencv-python` → `opencv-python-headless`. The headless variant drops GUI dependencies (Qt, GTK) that aren't used in a server container, saving ~300 MB of image size. The Python API is identical.

## Service Details

### `backend` service

```yaml
backend:
  build: ./backend
  ports:
    - "8000:8000"
  volumes:
    - ./backend:/app
  command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The Dockerfile installs system deps (libgl1 for OpenCV, build essentials), then `pip install -r requirements.txt`. No source is copied into the image — the volume mount provides everything at runtime.

### `frontend` service

```yaml
frontend:
  build: ./frontend
  ports:
    - "3000:80"
  volumes:
    - ./frontend:/usr/share/nginx/html:ro
```

The frontend Dockerfile is essentially `FROM nginx:alpine` plus an nginx config that listens on port 80 and serves files from the standard html directory. Volume is read-only to make the dev workflow clearer.

## Non-Obvious Decisions

1. **`opencv-python-headless`** instead of `opencv-python`. Saves ~300 MB. No functional change for our use case.

2. **No backend source COPY in Dockerfile.** Source is volume-mounted at runtime. The image only contains Python + system deps + Python deps. Faster rebuilds when only code changes (which is most of the time during dev).

3. **Webcam access is unaffected.** `getUserMedia` is initiated by the browser, not the container. Browsers permit `getUserMedia` on `http://localhost:*`, so no HTTPS or special container config is needed.

4. **`--reload` flag for uvicorn.** Backend Python changes auto-restart the server. The volume mount makes this work without rebuild.

5. **Tests:** can run via `docker compose exec backend python -m pytest tests/` once running, or continue running on the host venv.

## What Stays Outside Containers

- Existing host venv (still works for IDE integration, CLI test runs)
- Browser (which is where the webcam access happens)
- Git workflow

## Out of Scope

- Production-ready images (multi-stage builds, smaller base, no source mount)
- HTTPS / TLS
- GPU support
- Health checks (overkill for local dev)
- CI/CD integration

If we need any of these later, they're additive — they don't require rethinking this setup.

## Verification

After `docker compose up --build`:

1. `curl http://localhost:8000/docs` returns the Swagger UI HTML
2. `http://localhost:3000` in the browser shows the AR-Cube UI
3. Click "Start Camera" — webcam permission flow works
4. Edit a Python file in `backend/` — uvicorn reloads automatically
5. Edit a JS file in `frontend/js/` — refresh the browser to see the change
