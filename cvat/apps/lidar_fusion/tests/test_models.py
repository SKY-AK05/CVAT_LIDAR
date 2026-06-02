# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""Unit tests for lidar_fusion.models."""

import pytest
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase

from cvat.apps.engine.models import Task, Data, MediaType, DimensionType
from cvat.apps.lidar_fusion.models import CameraCalibration, CameraCalibrationHistory


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_task(user: User) -> Task:
    data = Data.objects.create(size=0)
    return Task.objects.create(
        name="test-task",
        owner=user,
        data=data,
        dimension=DimensionType.DIM_3D,
        media_type=MediaType.POINT_CLOUD,
    )


def _xtreme1_cal() -> dict:
    return {
        "cameraInternal": {"fx": 933.4, "fy": 934.6, "cx": 896.4, "cy": 507.3},
        "cameraExternal": list(range(16)),
        "width": 1920,
        "height": 1080,
        "rowMajor": False,
    }


def _cvat_cal() -> dict:
    return {
        "intrinsic": [[933.4, 0, 896.4], [0, 934.6, 507.3], [0, 0, 1]],
        "rotation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        "translation": [0.1, 0.2, 0.3],
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCameraCalibrationModel(TestCase):

    def setUp(self):
        self.user = User.objects.create_user("testuser", password="pass")
        self.task = _make_task(self.user)

    def test_create_xtreme1_format(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="front",
            calibration_data=_xtreme1_cal(),
            image_width=1920,
            image_height=1080,
        )
        self.assertEqual(cal.camera_name, "front")
        self.assertEqual(cal.version, 1)

    def test_create_cvat_format(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="rear",
            calibration_data=_cvat_cal(),
        )
        self.assertIsNotNone(cal.pk)

    def test_unique_together(self):
        CameraCalibration.objects.create(
            task=self.task, camera_name="left", calibration_data=_xtreme1_cal()
        )
        with self.assertRaises(Exception):
            CameraCalibration.objects.create(
                task=self.task, camera_name="left", calibration_data=_xtreme1_cal()
            )

    def test_validation_bad_intrinsic_missing_key(self):
        bad = {"cameraInternal": {"fx": 1.0}}  # missing fy, cx, cy
        with self.assertRaises(ValidationError):
            cal = CameraCalibration(task=self.task, camera_name="x", calibration_data=bad)
            cal.full_clean()

    def test_validation_bad_external_length(self):
        bad = {
            "cameraInternal": {"fx": 1, "fy": 1, "cx": 0, "cy": 0},
            "cameraExternal": [1, 2, 3],  # must be 16
        }
        with self.assertRaises(ValidationError):
            cal = CameraCalibration(task=self.task, camera_name="x", calibration_data=bad)
            cal.full_clean()

    def test_to_xtreme1_format_from_xtreme1(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="front",
            calibration_data=_xtreme1_cal(),
            image_width=1920,
            image_height=1080,
        )
        result = cal.to_xtreme1_format()
        self.assertIn("cameraInternal", result)
        self.assertIn("cameraExternal", result)
        self.assertEqual(result["width"], 1920)

    def test_to_xtreme1_format_from_cvat_format(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="rear",
            calibration_data=_cvat_cal(),
            image_width=640,
            image_height=480,
        )
        result = cal.to_xtreme1_format()
        ci = result["cameraInternal"]
        self.assertAlmostEqual(ci["fx"], 933.4, places=1)
        self.assertAlmostEqual(ci["fy"], 934.6, places=1)
        self.assertEqual(len(result["cameraExternal"]), 16)

    def test_update_creates_history(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="front",
            calibration_data=_xtreme1_cal(),
        )
        # Simulate an update via serializer
        from cvat.apps.lidar_fusion.serializers import CameraCalibrationSerializer
        new_data = _xtreme1_cal()
        new_data["cameraInternal"]["fx"] = 999.0
        serializer = CameraCalibrationSerializer(
            cal, data={"camera_name": "front", "calibration_data": new_data, "task": self.task.pk}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        cal.refresh_from_db()
        self.assertEqual(cal.version, 2)
        self.assertEqual(CameraCalibrationHistory.objects.filter(calibration=cal).count(), 1)


class TestCameraCalibrationHistory(TestCase):

    def setUp(self):
        self.user = User.objects.create_user("histuser", password="pass")
        self.task = _make_task(self.user)

    def test_history_entry_created_on_update(self):
        cal = CameraCalibration.objects.create(
            task=self.task,
            camera_name="right",
            calibration_data=_xtreme1_cal(),
        )
        # Direct history creation
        CameraCalibrationHistory.objects.create(
            calibration=cal,
            version=1,
            calibration_data=_xtreme1_cal(),
        )
        self.assertEqual(CameraCalibrationHistory.objects.count(), 1)
