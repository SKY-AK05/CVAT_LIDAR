# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""
LiDAR-Camera Fusion dataset importer.

Supported folder structure
--------------------------
<scene>/
├── lidar_point_cloud_0/          # PCD files (one per frame)
│   ├── 0000.pcd
│   └── 0001.pcd
├── camera_image/                 # (optional) images grouped per camera
│   ├── camera_image_0/
│   │   ├── 0000.jpg
│   │   └── 0001.jpg
│   └── camera_image_1/
│       └── ...
└── camera_config/                # (optional) calibration JSONs
    ├── camera_image_0.json       # one file per camera, or a single config.json
    └── camera_image_1.json

Frame-name matching:
  - PCD stem   == image stem  (e.g. "0000")
  - Calibration file stem == camera folder name (e.g. "camera_image_0")
    OR a single file named  "camera_config.json" / "config.json" applies
    to all cameras.

The importer returns a structured dict; actual Django model creation is
delegated to the view layer so that permissions and transactions are
handled there.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


# Regex patterns (mirrors Xtreme1 Constants)
_LIDAR_FOLDER_RE = re.compile(r"lidar_point_cloud_\d+", re.IGNORECASE)
_CAMERA_IMAGE_FOLDER_RE = re.compile(r"camera_image_\d+", re.IGNORECASE)
_CAMERA_CONFIG_DIR = "camera_config"
_SUPPORTED_PCD = {".pcd"}
_SUPPORTED_IMAGES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class FusionImportError(Exception):
    """Raised when the uploaded dataset has an unexpected structure."""


def parse_fusion_dataset(root: Path) -> dict[str, Any]:
    """
    Walk *root* and return a structured dict describing the dataset.

    Returns
    -------
    {
        "frames": [
            {
                "name": "0000",
                "pcd_path": Path(...),
                "images": {
                    "camera_image_0": Path(...),
                    "camera_image_1": Path(...),
                },
            },
            ...
        ],
        "calibrations": {
            "camera_image_0": { <calibration dict> },
            ...
        },
        "errors": [ ... ]          # non-fatal warnings
    }
    """
    errors: list[str] = []

    # ------------------------------------------------------------------
    # 1. Locate LiDAR point-cloud folders
    # ------------------------------------------------------------------
    lidar_folders = sorted(
        [d for d in root.iterdir() if d.is_dir() and _LIDAR_FOLDER_RE.fullmatch(d.name)],
        key=lambda p: p.name,
    )
    if not lidar_folders:
        raise FusionImportError(
            f"No 'lidar_point_cloud_N' folder found under {root}. "
            "Expected at least one folder matching the pattern lidar_point_cloud_0, lidar_point_cloud_1, …"
        )

    # Use the first lidar folder as the frame reference
    primary_lidar = lidar_folders[0]
    pcd_files: dict[str, Path] = {}
    for f in sorted(primary_lidar.iterdir()):
        if f.suffix.lower() in _SUPPORTED_PCD:
            pcd_files[f.stem] = f

    if not pcd_files:
        raise FusionImportError(f"No .pcd files found in {primary_lidar}.")

    # ------------------------------------------------------------------
    # 2. Locate camera-image folders
    # ------------------------------------------------------------------
    camera_image_dir = root / "camera_image"
    camera_folders: dict[str, dict[str, Path]] = {}

    if camera_image_dir.is_dir():
        for cam_folder in sorted(camera_image_dir.iterdir()):
            if not cam_folder.is_dir():
                continue
            if not _CAMERA_IMAGE_FOLDER_RE.fullmatch(cam_folder.name):
                errors.append(
                    f"Skipping unexpected camera folder: {cam_folder.name}. "
                    "Expected 'camera_image_N' pattern."
                )
                continue
            cam_images: dict[str, Path] = {}
            for img in sorted(cam_folder.iterdir()):
                if img.suffix.lower() in _SUPPORTED_IMAGES:
                    cam_images[img.stem] = img
            camera_folders[cam_folder.name] = cam_images

    # ------------------------------------------------------------------
    # 3. Validate frame-name alignment
    # ------------------------------------------------------------------
    frame_names = sorted(pcd_files.keys())
    for cam_name, cam_images in camera_folders.items():
        extra = set(cam_images.keys()) - set(frame_names)
        missing = set(frame_names) - set(cam_images.keys())
        if extra:
            errors.append(
                f"Camera '{cam_name}' has extra frames not in point cloud: {sorted(extra)}"
            )
        if missing:
            errors.append(
                f"Camera '{cam_name}' is missing frames present in point cloud: {sorted(missing)}"
            )

    # ------------------------------------------------------------------
    # 4. Read calibration files
    # ------------------------------------------------------------------
    calibrations: dict[str, dict] = {}
    config_dir = root / _CAMERA_CONFIG_DIR
    if config_dir.is_dir():
        # Try per-camera files first (e.g. camera_image_0.json)
        for cam_name in camera_folders:
            cal_file = config_dir / f"{cam_name}.json"
            if cal_file.exists():
                calibrations[cam_name] = _read_json(cal_file, errors)

        # Fall back to a single config.json / camera_config.json for all cameras
        if not calibrations:
            for fallback_name in ("camera_config.json", "config.json"):
                fallback = config_dir / fallback_name
                if fallback.exists():
                    single_cal = _read_json(fallback, errors)
                    if isinstance(single_cal, list):
                        # Array of calibrations indexed by order of camera_folders
                        for idx, cam_name in enumerate(sorted(camera_folders)):
                            if idx < len(single_cal):
                                calibrations[cam_name] = single_cal[idx]
                    else:
                        for cam_name in camera_folders:
                            calibrations[cam_name] = single_cal
                    break

    # ------------------------------------------------------------------
    # 5. Build per-frame records
    # ------------------------------------------------------------------
    frames = []
    for name in frame_names:
        frame: dict[str, Any] = {
            "name": name,
            "pcd_path": pcd_files[name],
            "images": {},
        }
        for cam_name, cam_images in camera_folders.items():
            if name in cam_images:
                frame["images"][cam_name] = cam_images[name]
        frames.append(frame)

    return {
        "frames": frames,
        "calibrations": calibrations,
        "errors": errors,
    }


def validate_calibration_json(data: dict) -> list[str]:
    """
    Validate a single calibration dict without Django model instantiation.
    Returns a list of error strings (empty = valid).
    """
    issues = []

    if "cameraInternal" in data:
        ci = data.get("cameraInternal", {})
        for key in ("fx", "fy", "cx", "cy"):
            if key not in ci:
                issues.append(f"cameraInternal missing key '{key}'.")
        ext = data.get("cameraExternal")
        if ext is not None and len(ext) != 16:
            issues.append("cameraExternal must be a flat list of 16 numbers.")
    elif "intrinsic" in data:
        intr = data["intrinsic"]
        if not isinstance(intr, list) or len(intr) != 3:
            issues.append("'intrinsic' must be a 3-row nested list.")
        else:
            for row in intr:
                if not isinstance(row, list) or len(row) != 3:
                    issues.append("Each row of 'intrinsic' must have 3 numbers.")
    else:
        issues.append(
            "Calibration must contain either 'intrinsic' (CVAT format) "
            "or 'cameraInternal' (Xtreme1 format)."
        )

    return issues


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_json(path: Path, errors: list) -> dict | list:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Could not read calibration file {path.name}: {exc}")
        return {}
