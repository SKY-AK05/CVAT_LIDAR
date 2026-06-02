# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""
Server-side LiDAR → camera projection utilities.

Mathematics
-----------
Given:
  P  — 3D LiDAR point  [X, Y, Z]
  R  — 3×3 rotation matrix  (extrinsic, LiDAR→camera frame)
  t  — translation vector  [tx, ty, tz]
  K  — 3×3 intrinsic matrix  [[fx,0,cx],[0,fy,cy],[0,0,1]]

Camera-frame coordinates:
  Pc = R @ P + t   =>  [Xc, Yc, Zc]

Projected pixel coordinates (only valid when Zc > 0):
  u = fx * (Xc / Zc) + cx
  v = fy * (Yc / Zc) + cy

This module is the server-side fallback for large point clouds or when
the browser cannot perform the projection in WebGL.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from .models import CameraCalibration


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def project_points(
    calibration: "CameraCalibration",
    points_xyz: np.ndarray,
    *,
    clip_behind_camera: bool = True,
) -> list[dict]:
    """
    Project an (N, 3) array of LiDAR points onto the camera image plane.

    Parameters
    ----------
    calibration : CameraCalibration
        Camera calibration model instance.
    points_xyz : np.ndarray, shape (N, 3)
        LiDAR points in world/LiDAR coordinate frame.
    clip_behind_camera : bool
        If True, points with Zc <= 0 are excluded from the result.

    Returns
    -------
    list of dicts with keys ``x``, ``y``, ``depth``.
    """
    if points_xyz.ndim != 2 or points_xyz.shape[1] != 3:
        raise ValueError("points_xyz must have shape (N, 3).")

    K, R, t = _extract_matrices(calibration)

    # Transform points into the camera frame: Pc = R @ P + t
    # Shape: (3, N)
    pc = R @ points_xyz.T + t[:, np.newaxis]  # (3, N)

    depth = pc[2]  # Zc

    if clip_behind_camera:
        valid_mask = depth > 0.0
    else:
        valid_mask = np.ones(pc.shape[1], dtype=bool)

    pc_valid = pc[:, valid_mask]
    depth_valid = depth[valid_mask]

    if pc_valid.shape[1] == 0:
        return []

    # Perspective divide
    u = K[0, 0] * (pc_valid[0] / pc_valid[2]) + K[0, 2]
    v = K[1, 1] * (pc_valid[1] / pc_valid[2]) + K[1, 2]

    # Optional: filter to image bounds
    w = calibration.image_width
    h = calibration.image_height
    if w and h:
        in_bounds = (u >= 0) & (u < w) & (v >= 0) & (v < h)
        u = u[in_bounds]
        v = v[in_bounds]
        depth_valid = depth_valid[valid_mask][in_bounds] if clip_behind_camera else depth_valid[in_bounds]

    return [
        {"x": float(u[i]), "y": float(v[i]), "depth": float(depth_valid[i])}
        for i in range(len(u))
    ]


def project_cuboid_corners(
    calibration: "CameraCalibration",
    center: list[float],
    dimensions: list[float],
    rotation_z: float,
) -> list[dict] | None:
    """
    Project the 8 corners of a 3D cuboid onto the camera image plane.

    Parameters
    ----------
    calibration : CameraCalibration
    center : [cx, cy, cz]  — cuboid centre in LiDAR frame
    dimensions : [w, h, d]  — width, height, depth
    rotation_z : float  — yaw angle in radians around Z-axis

    Returns
    -------
    List of 8 dicts with keys ``x``, ``y``, ``depth``, ``index`` (corner 0-7),
    or None if all corners are behind the camera.
    """
    corners = _compute_cuboid_corners(center, dimensions, rotation_z)
    K, R, t = _extract_matrices(calibration)

    results = []
    for i, corner in enumerate(corners):
        pc = R @ corner + t  # (3,)
        depth = float(pc[2])
        if depth <= 0.0:
            results.append({"x": None, "y": None, "depth": depth, "index": i, "behind": True})
            continue

        u = float(K[0, 0] * (pc[0] / pc[2]) + K[0, 2])
        v = float(K[1, 1] * (pc[1] / pc[2]) + K[1, 2])
        results.append({"x": u, "y": v, "depth": depth, "index": i, "behind": False})

    return results if any(not r.get("behind") for r in results) else None


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _extract_matrices(calibration: "CameraCalibration"):
    """
    Return (K, R, t) numpy arrays from a CameraCalibration instance.

    K : (3, 3) intrinsic matrix
    R : (3, 3) rotation matrix  (world/LiDAR → camera)
    t : (3,)   translation vector
    """
    data = calibration.calibration_data

    if "cameraInternal" in data:
        # Xtreme1-style format
        ci = data["cameraInternal"]
        fx, fy, cx, cy = ci["fx"], ci["fy"], ci["cx"], ci["cy"]
        K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)

        ext = data.get("cameraExternal")
        if ext and len(ext) == 16:
            row_major = data.get("rowMajor", True)
            M = np.array(ext, dtype=np.float64).reshape(4, 4)
            if not row_major:
                M = M.T
            R = M[:3, :3]
            t = M[:3, 3]
        else:
            R = np.eye(3, dtype=np.float64)
            t = np.zeros(3, dtype=np.float64)

    else:
        # CVAT intrinsic/rotation/translation format
        intr = data.get("intrinsic", [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        K = np.array(intr, dtype=np.float64)

        rot = data.get("rotation", [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        R = np.array(rot, dtype=np.float64)

        t_raw = data.get("translation", [0, 0, 0])
        t = np.array(t_raw, dtype=np.float64)

    return K, R, t


def _compute_cuboid_corners(
    center: list[float],
    dimensions: list[float],
    rotation_z: float,
) -> np.ndarray:
    """
    Compute 8 corners of a 3D bounding box (cuboid) in the LiDAR frame.

    The corners are ordered as:
      Front face:  0(+x,+y,+z), 1(+x,-y,+z), 2(+x,-y,-z), 3(+x,+y,-z)
      Back face:   4(-x,+y,+z), 5(-x,-y,+z), 6(-x,-y,-z), 7(-x,+y,-z)

    Returns shape (8, 3).
    """
    w, h, d = dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2
    cx, cy, cz = center

    local_corners = np.array([
        [ w,  h,  d],
        [ w, -h,  d],
        [ w, -h, -d],
        [ w,  h, -d],
        [-w,  h,  d],
        [-w, -h,  d],
        [-w, -h, -d],
        [-w,  h, -d],
    ], dtype=np.float64)

    # Yaw rotation around Z
    cos_z = math.cos(rotation_z)
    sin_z = math.sin(rotation_z)
    Rz = np.array([
        [cos_z, -sin_z, 0],
        [sin_z,  cos_z, 0],
        [0,      0,     1],
    ], dtype=np.float64)

    rotated = (Rz @ local_corners.T).T  # (8, 3)
    rotated += np.array([cx, cy, cz], dtype=np.float64)

    return rotated
