# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""Unit tests for lidar_fusion.projection."""

import math

import numpy as np
import pytest

from cvat.apps.lidar_fusion.projection import (
    _extract_matrices,
    _compute_cuboid_corners,
    project_points,
    project_cuboid_corners,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MockCalibration:
    """Minimal stand-in for CameraCalibration model instances."""

    def __init__(self, data, image_width=1920, image_height=1080):
        self.calibration_data = data
        self.image_width = image_width
        self.image_height = image_height


def _identity_cal():
    """Camera at origin, looking down +Z, identity rotation."""
    return _MockCalibration({
        "cameraInternal": {"fx": 500.0, "fy": 500.0, "cx": 320.0, "cy": 240.0},
        "cameraExternal": [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ],
        "rowMajor": True,
        "width": 640,
        "height": 480,
    }, image_width=640, image_height=480)


# ---------------------------------------------------------------------------
# _extract_matrices
# ---------------------------------------------------------------------------

class TestExtractMatrices:

    def test_xtreme1_format_identity(self):
        cal = _identity_cal()
        K, R, t = _extract_matrices(cal)

        assert K.shape == (3, 3)
        assert R.shape == (3, 3)
        assert t.shape == (3,)

        # Identity rotation
        np.testing.assert_allclose(R, np.eye(3), atol=1e-9)
        # Zero translation
        np.testing.assert_allclose(t, np.zeros(3), atol=1e-9)

    def test_xtreme1_intrinsics(self):
        cal = _identity_cal()
        K, _, _ = _extract_matrices(cal)
        assert K[0, 0] == pytest.approx(500.0)
        assert K[1, 1] == pytest.approx(500.0)
        assert K[0, 2] == pytest.approx(320.0)
        assert K[1, 2] == pytest.approx(240.0)

    def test_cvat_format(self):
        cal = _MockCalibration({
            "intrinsic": [[800, 0, 320], [0, 800, 240], [0, 0, 1]],
            "rotation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            "translation": [1.0, 2.0, 3.0],
        }, image_width=640, image_height=480)
        K, R, t = _extract_matrices(cal)
        assert K[0, 0] == pytest.approx(800.0)
        np.testing.assert_allclose(t, [1.0, 2.0, 3.0])

    def test_column_major_external(self):
        """Column-major 4×4 matrix must be transposed correctly."""
        # Rotation 90° around Z in column-major:
        #  col-major:  [0,-1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1]
        #  row-major:  [[0,1,0,0],[-1,0,0,0],[0,0,1,0],[0,0,0,1]]
        col_major = [0, -1, 0, 0,  1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]
        cal = _MockCalibration({
            "cameraInternal": {"fx": 1, "fy": 1, "cx": 0, "cy": 0},
            "cameraExternal": col_major,
            "rowMajor": False,
        })
        _, R, _ = _extract_matrices(cal)
        # After transposing column-major: R[0,1] should be 1 (not -1)
        assert R[0, 0] == pytest.approx(0.0, abs=1e-9)
        assert R[0, 1] == pytest.approx(1.0, abs=1e-9)


# ---------------------------------------------------------------------------
# _compute_cuboid_corners
# ---------------------------------------------------------------------------

class TestComputeCuboidCorners:

    def test_axis_aligned_cube(self):
        corners = _compute_cuboid_corners([0, 0, 0], [2, 2, 2], 0.0)
        assert corners.shape == (8, 3)
        # All corners should be at ±1 in each axis
        for corner in corners:
            assert abs(corner[0]) == pytest.approx(1.0)
            assert abs(corner[1]) == pytest.approx(1.0)
            assert abs(corner[2]) == pytest.approx(1.0)

    def test_offset_center(self):
        corners = _compute_cuboid_corners([10, 20, 30], [2, 2, 2], 0.0)
        x_vals = corners[:, 0]
        assert min(x_vals) == pytest.approx(9.0)
        assert max(x_vals) == pytest.approx(11.0)

    def test_rotation_z_90(self):
        """After 90° yaw, x/y corners should be swapped."""
        corners_0 = _compute_cuboid_corners([0, 0, 0], [4, 2, 2], 0.0)
        corners_90 = _compute_cuboid_corners([0, 0, 0], [4, 2, 2], math.pi / 2)
        # At 0°, max x = 2.0; at 90° it should be ~1.0 (half of y extent)
        assert max(corners_90[:, 0]) == pytest.approx(1.0, abs=1e-6)


# ---------------------------------------------------------------------------
# project_points
# ---------------------------------------------------------------------------

class TestProjectPoints:

    def test_point_in_front_of_camera(self):
        cal = _identity_cal()
        # A point directly in front of camera at (0,0,5)
        pts = np.array([[0.0, 0.0, 5.0]])
        result = project_points(cal, pts, clip_behind_camera=True)
        assert len(result) == 1
        # Should project to principal point (320, 240)
        assert result[0]["x"] == pytest.approx(320.0)
        assert result[0]["y"] == pytest.approx(240.0)
        assert result[0]["depth"] == pytest.approx(5.0)

    def test_point_behind_camera_clipped(self):
        cal = _identity_cal()
        pts = np.array([[0.0, 0.0, -1.0]])  # behind camera
        result = project_points(cal, pts, clip_behind_camera=True)
        assert len(result) == 0

    def test_point_behind_camera_not_clipped(self):
        cal = _identity_cal()
        pts = np.array([[0.0, 0.0, -1.0]])
        result = project_points(cal, pts, clip_behind_camera=False)
        assert len(result) == 1

    def test_out_of_bounds_filtered(self):
        """Points that project outside image bounds should be excluded."""
        cal = _identity_cal()
        # Point at extreme angle — will land far outside 640×480
        pts = np.array([[1000.0, 1000.0, 1.0]])
        result = project_points(cal, pts, clip_behind_camera=True)
        assert len(result) == 0

    def test_multiple_points(self):
        cal = _identity_cal()
        pts = np.array([
            [0.0,  0.0, 5.0],
            [0.0,  0.0, 10.0],
            [0.0,  0.0, -1.0],
        ])
        result = project_points(cal, pts)
        # Third point is behind camera → excluded
        assert len(result) == 2

    def test_depth_scales_correctly(self):
        cal = _identity_cal()
        pts = np.array([[0.0, 0.0, 2.0], [0.0, 0.0, 4.0]])
        result = project_points(cal, pts)
        depths = sorted(r["depth"] for r in result)
        assert depths[0] == pytest.approx(2.0)
        assert depths[1] == pytest.approx(4.0)

    def test_invalid_shape_raises(self):
        cal = _identity_cal()
        with pytest.raises(ValueError):
            project_points(cal, np.array([1.0, 2.0, 3.0]))  # wrong shape


# ---------------------------------------------------------------------------
# project_cuboid_corners
# ---------------------------------------------------------------------------

class TestProjectCuboidCorners:

    def test_all_corners_visible(self):
        cal = _identity_cal()
        # Small box directly in front of camera
        result = project_cuboid_corners(cal, [0, 0, 10], [1, 1, 1], 0.0)
        assert len(result) == 8
        # All corners should be in front (not behind)
        visible = [r for r in result if not r.get("behind")]
        assert len(visible) == 8

    def test_box_behind_camera(self):
        cal = _identity_cal()
        result = project_cuboid_corners(cal, [0, 0, -5], [1, 1, 1], 0.0)
        behind = [r for r in result if r.get("behind")]
        assert len(behind) == 8

    def test_partial_visibility(self):
        cal = _identity_cal()
        # Box straddling the camera plane (Z=0)
        result = project_cuboid_corners(cal, [0, 0, 0], [1, 1, 1], 0.0)
        visible = [r for r in result if not r.get("behind")]
        behind = [r for r in result if r.get("behind")]
        # Some should be visible (z=+0.5) and some behind (z=-0.5)
        assert len(visible) > 0
        assert len(behind) > 0
        assert len(visible) + len(behind) == 8

    def test_returns_none_when_all_behind(self):
        """project_cuboid_corners returns None when nothing is visible."""
        cal = _identity_cal()
        result = project_cuboid_corners(cal, [0, 0, -10], [1, 1, 1], 0.0)
        assert result is None
