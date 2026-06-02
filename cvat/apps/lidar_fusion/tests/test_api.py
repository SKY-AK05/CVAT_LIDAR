# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""Integration tests for lidar_fusion REST API endpoints."""

import io
import json
import zipfile

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from cvat.apps.engine.models import Task, Data, MediaType, DimensionType
from cvat.apps.lidar_fusion.models import CameraCalibration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(user: User) -> Task:
    data = Data.objects.create(size=0)
    return Task.objects.create(
        name="api-test-task",
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


def _make_valid_zip() -> bytes:
    """Create a minimal valid fusion dataset ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # PCD stub
        zf.writestr(
            "dataset/lidar_point_cloud_0/0000.pcd",
            "VERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nDATA ascii\n0 0 0\n",
        )
        # Camera image stub
        zf.writestr("dataset/camera_image/camera_image_0/0000.jpg", b"\xff\xd8\xff\xe0".decode("latin-1"))
        # Calibration
        cal = json.dumps(_xtreme1_cal())
        zf.writestr("dataset/camera_config/camera_image_0.json", cal)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CalibrationViewSet tests
# ---------------------------------------------------------------------------

class TestCalibrationAPI(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user("apiuser", password="pass")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.task = _make_task(self.user)

    def _list_url(self):
        return f"/api/lidar-fusion/tasks/{self.task.pk}/calibrations/"

    def _detail_url(self, pk):
        return f"/api/lidar-fusion/tasks/{self.task.pk}/calibrations/{pk}/"

    def _xtreme1_url(self):
        return f"/api/lidar-fusion/tasks/{self.task.pk}/calibrations/all-xtreme1/"

    def test_list_empty(self):
        response = self.client.get(self._list_url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_create_calibration(self):
        payload = {
            "task": self.task.pk,
            "camera_name": "front",
            "calibration_data": _xtreme1_cal(),
        }
        response = self.client.post(self._list_url(), payload, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["camera_name"], "front")
        self.assertEqual(response.json()["version"], 1)

    def test_retrieve_calibration(self):
        cal = CameraCalibration.objects.create(
            task=self.task, camera_name="rear", calibration_data=_xtreme1_cal()
        )
        response = self.client.get(self._detail_url(cal.pk))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("xtreme1_format", data)
        self.assertIn("cameraInternal", data["xtreme1_format"])

    def test_update_increments_version(self):
        cal = CameraCalibration.objects.create(
            task=self.task, camera_name="left", calibration_data=_xtreme1_cal()
        )
        new_cal = _xtreme1_cal()
        new_cal["cameraInternal"]["fx"] = 999.0
        response = self.client.patch(
            self._detail_url(cal.pk),
            {"calibration_data": new_cal},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        cal.refresh_from_db()
        self.assertEqual(cal.version, 2)

    def test_delete_calibration(self):
        cal = CameraCalibration.objects.create(
            task=self.task, camera_name="right", calibration_data=_xtreme1_cal()
        )
        response = self.client.delete(self._detail_url(cal.pk))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CameraCalibration.objects.filter(pk=cal.pk).exists())

    def test_all_xtreme1_endpoint(self):
        CameraCalibration.objects.create(
            task=self.task, camera_name="front", calibration_data=_xtreme1_cal()
        )
        CameraCalibration.objects.create(
            task=self.task, camera_name="rear", calibration_data=_xtreme1_cal()
        )
        response = self.client.get(self._xtreme1_url())
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("front", data)
        self.assertIn("rear", data)
        self.assertIn("cameraInternal", data["front"])

    def test_history_endpoint(self):
        cal = CameraCalibration.objects.create(
            task=self.task, camera_name="front", calibration_data=_xtreme1_cal()
        )
        url = f"/api/lidar-fusion/tasks/{self.task.pk}/calibrations/{cal.pk}/history/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)

    def test_unauthenticated_rejected(self):
        anon_client = APIClient()
        response = anon_client.get(self._list_url())
        self.assertEqual(response.status_code, 401)


# ---------------------------------------------------------------------------
# PointProjectionView tests
# ---------------------------------------------------------------------------

class TestPointProjectionAPI(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user("projuser", password="pass")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.task = _make_task(self.user)
        CameraCalibration.objects.create(
            task=self.task,
            camera_name="front",
            calibration_data={
                "cameraInternal": {"fx": 500.0, "fy": 500.0, "cx": 320.0, "cy": 240.0},
                "cameraExternal": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                "rowMajor": True,
            },
            image_width=640,
            image_height=480,
        )

    def _url(self):
        return f"/api/lidar-fusion/tasks/{self.task.pk}/project-points/"

    def test_valid_projection(self):
        payload = {
            "points": [0.0, 0.0, 5.0],  # one point directly ahead
            "camera_name": "front",
        }
        response = self.client.post(self._url(), payload, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        data = response.json()
        self.assertEqual(data["camera_name"], "front")
        self.assertGreaterEqual(len(data["projected_points"]), 1)

    def test_invalid_point_count(self):
        payload = {"points": [1.0, 2.0], "camera_name": "front"}  # not divisible by 3
        response = self.client.post(self._url(), payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_unknown_camera(self):
        payload = {"points": [0.0, 0.0, 5.0], "camera_name": "nonexistent"}
        response = self.client.post(self._url(), payload, format="json")
        self.assertEqual(response.status_code, 404)


# ---------------------------------------------------------------------------
# FusionDatasetImportView tests
# ---------------------------------------------------------------------------

class TestDatasetImportAPI(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user("importuser", password="pass")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.task = _make_task(self.user)

    def _url(self):
        return f"/api/lidar-fusion/tasks/{self.task.pk}/import-dataset/"

    def test_valid_import(self):
        zip_bytes = _make_valid_zip()
        response = self.client.post(
            self._url(),
            {"file": io.BytesIO(zip_bytes)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.json())
        data = response.json()
        self.assertIn("camera_image_0", data["saved_calibrations"])
        self.assertEqual(data["frame_count"], 1)

    def test_no_file_returns_400(self):
        response = self.client.post(self._url(), {}, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_non_zip_returns_400(self):
        response = self.client.post(
            self._url(),
            {"file": io.BytesIO(b"not a zip")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
