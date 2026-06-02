# CVAT_LIDAR — LiDAR-Camera Fusion Extension for CVAT

This repository contains the **LiDAR-Camera Fusion** extension built on top of
[CVAT Community Edition](https://github.com/cvat-ai/cvat).

## What's included

### Backend — `cvat/apps/lidar_fusion/`
- Camera calibration storage with versioning (supports Xtreme1 + CVAT formats)
- REST API for calibration CRUD, point projection, cuboid projection, dataset import
- Server-side NumPy LiDAR → camera math
- ZIP dataset importer (Xtreme1-compatible folder structure)
- DB migration: 2 new tables, zero changes to existing CVAT tables
- Full unit + integration test suite

### Frontend — `cvat-ui/src/components/lidar-fusion/`
- Browser-side 4×4 matrix projection (100k+ points per frame)
- Multi-camera synchronized grid layout (Front / Left / 3D / Right / Rear)
- Real-time 3D cuboid projection onto all camera views
- Calibration upload/manage UI
- Overlay controls (opacity, point size, camera filter, class filter)
- Sensor Fusion tab added to 3D annotation workspace

### Modified CVAT files (3 files only)
- `cvat/settings/base.py` — added `lidar_fusion` to INSTALLED_APPS
- `cvat/urls.py` — mounted `/api/lidar-fusion/` routes
- `cvat-ui/src/components/annotation-page/standard3D-workspace/standard3D-workspace.tsx` — added Sensor Fusion tab

---

## How to install into CVAT

See full instructions: [docs/lidar-fusion/DEPLOYMENT.md](docs/lidar-fusion/DEPLOYMENT.md)

### Quick steps

```bash
# 1. Copy these files into your CVAT repo at the same paths
# 2. Install Python deps
pip install numpy opencv-python-headless scipy

# 3. Run migration (inside Docker)
docker compose exec cvat_server python manage.py migrate lidar_fusion

# 4. Build frontend
cd cvat-ui && yarn build
```

---

## Calibration format supported

```json
{
  "cameraInternal": { "fx": 933.4, "fy": 934.6, "cx": 896.4, "cy": 507.3 },
  "cameraExternal": [ ...16 floats, column-major 4x4 matrix... ],
  "rowMajor": false,
  "width": 1920,
  "height": 1080
}
```

---

## API Endpoints

```
GET/POST   /api/lidar-fusion/tasks/{id}/calibrations/
GET/PATCH  /api/lidar-fusion/tasks/{id}/calibrations/{id}/
GET        /api/lidar-fusion/tasks/{id}/calibrations/all-xtreme1/
POST       /api/lidar-fusion/tasks/{id}/project-points/
POST       /api/lidar-fusion/tasks/{id}/project-cuboid/
POST       /api/lidar-fusion/tasks/{id}/import-dataset/
```

---

Base CVAT: v2.67.0 (develop branch)
