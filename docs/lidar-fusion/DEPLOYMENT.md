# LiDAR-Camera Fusion — Deployment Guide

This document covers everything you need to deploy, configure, and verify
the LiDAR-Camera Fusion extension for CVAT Community Edition.

---

## 1. What was changed

| Path | Change type | Description |
|---|---|---|
| `cvat/apps/lidar_fusion/` | **New** | Full Django app — models, views, serializers, projection, importer |
| `cvat/apps/lidar_fusion/migrations/0001_initial.py` | **New** | DB migration for two new tables |
| `cvat/settings/base.py` | **Modified** | Added `cvat.apps.lidar_fusion` to `INSTALLED_APPS` |
| `cvat/urls.py` | **Modified** | Mounted `api/lidar-fusion/…` routes |
| `cvat-ui/src/components/lidar-fusion/` | **New** | React/TypeScript fusion UI (8 files) |
| `cvat-ui/src/components/annotation-page/standard3D-workspace/standard3D-workspace.tsx` | **Modified** | Added Sensor Fusion tab (only visible when calibrations exist) |

No existing CVAT tables, views, or functionality were removed or broken.

---

## 2. Backend setup

### 2.1 Python dependencies

Add to `cvat/requirements/base.txt` if not already present:

```
numpy>=1.24
opencv-python-headless>=4.8
scipy>=1.11
```

Or install directly in your virtual environment:

```bash
pip install "numpy>=1.24" "opencv-python-headless>=4.8" "scipy>=1.11"
```

### 2.2 Run the database migration

```bash
# Inside your CVAT backend container or virtualenv
python manage.py migrate lidar_fusion
```

Verify the two tables were created:

```sql
-- In psql
\dt lidar_fusion_*
-- Expected output:
--   lidar_fusion_cameracalibration
--   lidar_fusion_cameracalibrationhistory
```

### 2.3 Restart services

```bash
# Docker Compose
docker compose restart cvat_server cvat_worker_import

# Or bare-metal
systemctl restart cvat-server
```

---

## 3. Frontend setup

The frontend components are pure TypeScript/React and do not require any
additional packages beyond what CVAT already ships (`antd`, `three`, etc.).

```bash
cd cvat-ui
yarn install   # install any missing peer deps
yarn build     # production build
```

For development with hot-reload:

```bash
yarn run start:cvat-ui
```

The Sensor Fusion tab appears automatically in the 3D annotation workspace
when the current task has at least one related camera image (i.e. a task
with `dimension=3d` that has related files).

---

## 4. API reference

All endpoints require authentication (`Token` or `Session`).

### Calibration CRUD

| Method | URL | Description |
|---|---|---|
| `GET` | `/api/lidar-fusion/tasks/{id}/calibrations/` | List all calibrations |
| `POST` | `/api/lidar-fusion/tasks/{id}/calibrations/` | Create calibration |
| `GET` | `/api/lidar-fusion/tasks/{id}/calibrations/{id}/` | Retrieve one |
| `PATCH` | `/api/lidar-fusion/tasks/{id}/calibrations/{id}/` | Update (creates history entry) |
| `DELETE` | `/api/lidar-fusion/tasks/{id}/calibrations/{id}/` | Delete |
| `GET` | `/api/lidar-fusion/tasks/{id}/calibrations/{id}/history/` | Version history |
| `GET` | `/api/lidar-fusion/tasks/{id}/calibrations/all-xtreme1/` | All cals in Xtreme1 format |

### Projection (server-side fallback)

```
POST /api/lidar-fusion/tasks/{id}/project-points/
Content-Type: application/json

{
  "points": [x0,y0,z0, x1,y1,z1, ...],   // flat XYZ array, max 300 k points
  "camera_name": "front"
}
```

### Cuboid projection

```
POST /api/lidar-fusion/tasks/{id}/project-cuboid/
Content-Type: application/json

{
  "center":     [cx, cy, cz],
  "dimensions": [width, height, depth],
  "rotation_z": 0.0
}
```

### Dataset import

```
POST /api/lidar-fusion/tasks/{id}/import-dataset/
Content-Type: multipart/form-data

file=<ZIP archive>
```

Expected ZIP structure:

```
<root>/
├── lidar_point_cloud_0/
│   ├── 0000.pcd
│   └── 0001.pcd
├── camera_image/
│   ├── camera_image_0/
│   │   ├── 0000.jpg
│   │   └── 0001.jpg
│   └── camera_image_1/
│       └── ...
└── camera_config/
    ├── camera_image_0.json
    └── camera_image_1.json
```

---

## 5. Calibration file format

Two formats are accepted:

**Xtreme1 / Supervisely format (recommended):**

```json
{
  "cameraInternal": {
    "fx": 933.4667,
    "fy": 934.6754,
    "cx": 896.4692,
    "cy": 507.3557
  },
  "cameraExternal": [
    -0.72, -0.04, -0.69, 0,
     0.69,  0.03, -0.72, 0,
     0.05, -0.99,  0.00, 0,
     0.009, 1.658, -1.02, 1
  ],
  "rowMajor": false,
  "width": 1920,
  "height": 1080
}
```

**CVAT intrinsic/rotation/translation format:**

```json
{
  "intrinsic":    [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "rotation":     [[r00, r01, r02], [r10, r11, r12], [r20, r21, r22]],
  "translation":  [tx, ty, tz]
}
```

---

## 6. Running tests

### Backend

```bash
# From the project root
python manage.py test cvat.apps.lidar_fusion --verbosity=2

# Or with pytest
pytest cvat/apps/lidar_fusion/tests/ -v
```

### Frontend

```bash
cd cvat-ui
yarn jest src/components/lidar-fusion/__tests__/ --verbose
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `No module named 'numpy'` | Dependency not installed | `pip install numpy` |
| Migration fails with "relation engine_task does not exist" | Run CVAT base migrations first | `python manage.py migrate engine` |
| Sensor Fusion tab not visible | Task has no related files | Upload images as context/related files in task creation |
| Projection looks wrong | `rowMajor` flag incorrect | Set `"rowMajor": false` for column-major matrices (default in Xtreme1) |
| 401 on API calls | Missing auth header | Include `Authorization: Token <your_token>` |

---

## 8. Future phases (architecture prepared, not implemented)

The following capabilities are architecturally prepared but not yet wired:

- **Edit cuboids from camera view** — `ProjectionRenderer` has an `onCuboidDrag` hook stub
- **Automatic 3D cuboid update from camera edit** — will dispatch `canvas.edited` events
- **Semi-automatic annotation** — lambda function integration point exists in `FusionWorkspace`
- **Multi-user collaborative editing** — the backend calibration API is already concurrent-safe

To implement any of these, search for `// Future Phase` comments in the code.
