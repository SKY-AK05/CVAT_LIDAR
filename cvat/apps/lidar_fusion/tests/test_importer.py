# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""Unit tests for lidar_fusion.importer."""

import json
import tempfile
from pathlib import Path

import pytest

from cvat.apps.lidar_fusion.importer import (
    FusionImportError,
    parse_fusion_dataset,
    validate_calibration_json,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_pcd(path: Path, name: str):
    """Create a minimal valid .pcd stub file."""
    p = path / name
    p.write_text("VERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nDATA ascii\n0 0 0\n")
    return p


def _make_image(path: Path, name: str):
    """Create a stub image file (just needs to exist)."""
    p = path / name
    p.write_bytes(b"\xff\xd8\xff\xe0")  # minimal JPEG header
    return p


def _make_cal_json(path: Path, name: str, data: dict = None):
    p = path / name
    if data is None:
        data = {
            "cameraInternal": {"fx": 933.0, "fy": 934.0, "cx": 896.0, "cy": 507.0},
            "cameraExternal": list(range(16)),
            "width": 1920,
            "height": 1080,
            "rowMajor": False,
        }
    p.write_text(json.dumps(data))
    return p


# ---------------------------------------------------------------------------
# parse_fusion_dataset
# ---------------------------------------------------------------------------

class TestParseFusionDataset:

    def test_minimal_valid_dataset(self, tmp_path):
        """Dataset with one LiDAR folder and two frames."""
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")
        _make_pcd(lidar_dir, "0001.pcd")

        result = parse_fusion_dataset(tmp_path)
        assert len(result["frames"]) == 2
        assert result["frames"][0]["name"] == "0000"
        assert result["frames"][1]["name"] == "0001"
        assert result["errors"] == []

    def test_raises_when_no_lidar_folder(self, tmp_path):
        with pytest.raises(FusionImportError, match="lidar_point_cloud"):
            parse_fusion_dataset(tmp_path)

    def test_raises_when_no_pcd_files(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        with pytest.raises(FusionImportError, match=".pcd"):
            parse_fusion_dataset(tmp_path)

    def test_camera_images_aligned(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")

        cam_dir = tmp_path / "camera_image" / "camera_image_0"
        cam_dir.mkdir(parents=True)
        _make_image(cam_dir, "0000.jpg")

        result = parse_fusion_dataset(tmp_path)
        assert "camera_image_0" in result["frames"][0]["images"]

    def test_mismatched_camera_frame_produces_warning(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")

        cam_dir = tmp_path / "camera_image" / "camera_image_0"
        cam_dir.mkdir(parents=True)
        _make_image(cam_dir, "9999.jpg")  # does not match 0000

        result = parse_fusion_dataset(tmp_path)
        assert len(result["errors"]) > 0

    def test_per_camera_calibration_file(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")

        cam_dir = tmp_path / "camera_image" / "camera_image_0"
        cam_dir.mkdir(parents=True)
        _make_image(cam_dir, "0000.jpg")

        cal_dir = tmp_path / "camera_config"
        cal_dir.mkdir()
        _make_cal_json(cal_dir, "camera_image_0.json")

        result = parse_fusion_dataset(tmp_path)
        assert "camera_image_0" in result["calibrations"]

    def test_fallback_config_json(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")

        cam_dir = tmp_path / "camera_image" / "camera_image_0"
        cam_dir.mkdir(parents=True)
        _make_image(cam_dir, "0000.jpg")

        cal_dir = tmp_path / "camera_config"
        cal_dir.mkdir()
        _make_cal_json(cal_dir, "camera_config.json")

        result = parse_fusion_dataset(tmp_path)
        assert "camera_image_0" in result["calibrations"]

    def test_multiple_cameras(self, tmp_path):
        lidar_dir = tmp_path / "lidar_point_cloud_0"
        lidar_dir.mkdir()
        _make_pcd(lidar_dir, "0000.pcd")

        for cam_name in ["camera_image_0", "camera_image_1", "camera_image_2"]:
            cam_dir = tmp_path / "camera_image" / cam_name
            cam_dir.mkdir(parents=True)
            _make_image(cam_dir, "0000.jpg")

        result = parse_fusion_dataset(tmp_path)
        assert len(result["frames"][0]["images"]) == 3


# ---------------------------------------------------------------------------
# validate_calibration_json
# ---------------------------------------------------------------------------

class TestValidateCalibrationJson:

    def test_valid_xtreme1(self):
        data = {
            "cameraInternal": {"fx": 1, "fy": 1, "cx": 0, "cy": 0},
            "cameraExternal": list(range(16)),
        }
        assert validate_calibration_json(data) == []

    def test_valid_cvat_format(self):
        data = {
            "intrinsic": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        }
        assert validate_calibration_json(data) == []

    def test_missing_fy(self):
        data = {"cameraInternal": {"fx": 1, "cx": 0, "cy": 0}}
        errors = validate_calibration_json(data)
        assert any("fy" in e for e in errors)

    def test_bad_external_length(self):
        data = {
            "cameraInternal": {"fx": 1, "fy": 1, "cx": 0, "cy": 0},
            "cameraExternal": [1, 2, 3],
        }
        errors = validate_calibration_json(data)
        assert len(errors) > 0

    def test_no_intrinsic_at_all(self):
        data = {"someRandomKey": 123}
        errors = validate_calibration_json(data)
        assert len(errors) > 0
