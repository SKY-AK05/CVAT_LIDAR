# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""
LiDAR-Camera Fusion API views.

Endpoints
---------
GET    /api/lidar-fusion/tasks/{task_id}/calibrations/
POST   /api/lidar-fusion/tasks/{task_id}/calibrations/
GET    /api/lidar-fusion/tasks/{task_id}/calibrations/{id}/
PUT    /api/lidar-fusion/tasks/{task_id}/calibrations/{id}/
PATCH  /api/lidar-fusion/tasks/{task_id}/calibrations/{id}/
DELETE /api/lidar-fusion/tasks/{task_id}/calibrations/{id}/
GET    /api/lidar-fusion/tasks/{task_id}/calibrations/{id}/history/
POST   /api/lidar-fusion/tasks/{task_id}/project-points/
POST   /api/lidar-fusion/tasks/{task_id}/project-cuboid/
POST   /api/lidar-fusion/tasks/{task_id}/import-dataset/
"""

from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from django.shortcuts import get_object_or_404
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from cvat.apps.engine.models import Task

from .importer import FusionImportError, parse_fusion_dataset, validate_calibration_json
from .models import CameraCalibration, CameraCalibrationHistory
from .projection import project_cuboid_corners, project_points
from .serializers import (
    CameraCalibrationHistorySerializer,
    CameraCalibrationListSerializer,
    CameraCalibrationSerializer,
    PointProjectionRequestSerializer,
)


# ---------------------------------------------------------------------------
# Calibration CRUD
# ---------------------------------------------------------------------------

class CameraCalibrationViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    CRUD for per-task camera calibrations.

    All operations are scoped to the task specified in the URL.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = CameraCalibrationSerializer

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_task(self) -> Task:
        return get_object_or_404(Task, pk=self.kwargs["task_id"])

    def get_queryset(self):
        task = self._get_task()
        return CameraCalibration.objects.filter(task=task)

    def get_serializer_class(self):
        if self.action == "list":
            return CameraCalibrationListSerializer
        return CameraCalibrationSerializer

    # ------------------------------------------------------------------
    # Standard overrides
    # ------------------------------------------------------------------

    def perform_create(self, serializer):
        task = self._get_task()
        serializer.save(task=task, created_by=self.request.user)

    # ------------------------------------------------------------------
    # Extra actions
    # ------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, task_id=None, pk=None):
        """Return all previous versions of a calibration."""
        calibration = self.get_object()
        qs = CameraCalibrationHistory.objects.filter(calibration=calibration)
        serializer = CameraCalibrationHistorySerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="all-xtreme1")
    def all_xtreme1(self, request, task_id=None):
        """
        Return all calibrations for this task in the Xtreme1 format,
        keyed by camera_name.  This is the primary endpoint consumed by
        the frontend projection engine.
        """
        calibrations = self.get_queryset()
        result = {}
        for cal in calibrations:
            result[cal.camera_name] = {
                "id": cal.id,
                "version": cal.version,
                **cal.to_xtreme1_format(),
            }
        return Response(result)


# ---------------------------------------------------------------------------
# Point projection (server-side fallback)
# ---------------------------------------------------------------------------

class PointProjectionView(APIView):
    """
    Server-side LiDAR → camera point projection.

    POST body:
    {
        "points": [x0,y0,z0, x1,y1,z1, ...],
        "camera_name": "front"
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_object_or_404(Task, pk=task_id)

        request_ser = PointProjectionRequestSerializer(data=request.data)
        request_ser.is_valid(raise_exception=True)

        camera_name = request_ser.validated_data["camera_name"]
        points_flat = request_ser.validated_data["points"]

        calibration = get_object_or_404(
            CameraCalibration, task=task, camera_name=camera_name
        )

        # Reshape to (N, 3)
        points_arr = np.array(points_flat, dtype=np.float64).reshape(-1, 3)

        projected = project_points(calibration, points_arr)

        return Response(
            {
                "camera_name": camera_name,
                "image_width": calibration.image_width,
                "image_height": calibration.image_height,
                "projected_points": projected,
            }
        )


# ---------------------------------------------------------------------------
# Cuboid projection
# ---------------------------------------------------------------------------

class CuboidProjectionView(APIView):
    """
    Project 3D cuboid corners onto all calibrated cameras for this task.

    POST body:
    {
        "center": [cx, cy, cz],
        "dimensions": [width, height, depth],
        "rotation_z": 0.0
    }

    Response:
    {
        "front": [ {x, y, depth, index, behind}, ... ],
        "rear":  [ ... ],
        ...
    }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_object_or_404(Task, pk=task_id)

        center = request.data.get("center")
        dimensions = request.data.get("dimensions")
        rotation_z = float(request.data.get("rotation_z", 0.0))

        if not center or len(center) != 3:
            return Response(
                {"detail": "'center' must be a list of 3 floats."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not dimensions or len(dimensions) != 3:
            return Response(
                {"detail": "'dimensions' must be a list of 3 floats."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        calibrations = CameraCalibration.objects.filter(task=task)
        if not calibrations.exists():
            return Response(
                {"detail": "No calibrations found for this task."},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = {}
        for cal in calibrations:
            corners = project_cuboid_corners(cal, center, dimensions, rotation_z)
            result[cal.camera_name] = corners or []

        return Response(result)


# ---------------------------------------------------------------------------
# Dataset import
# ---------------------------------------------------------------------------

class FusionDatasetImportView(APIView):
    """
    Upload a ZIP containing a LiDAR-Camera Fusion dataset.

    The importer validates the folder structure, parses calibration files,
    and persists CameraCalibration objects for the task.

    Expects multipart/form-data with field ``file`` (ZIP archive).
    """

    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [IsAuthenticated]

    def post(self, request, task_id: int):
        task = get_object_or_404(Task, pk=task_id)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response(
                {"detail": "No file provided.  Send a ZIP archive in the 'file' field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not uploaded.name.lower().endswith(".zip"):
            return Response(
                {"detail": "Only ZIP archives are supported."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)

                # Extract ZIP
                with zipfile.ZipFile(io.BytesIO(uploaded.read())) as zf:
                    zf.extractall(tmp_path)

                # Locate the root of the dataset (top-level folder inside the ZIP)
                entries = list(tmp_path.iterdir())
                if len(entries) == 1 and entries[0].is_dir():
                    dataset_root = entries[0]
                else:
                    dataset_root = tmp_path

                parsed = parse_fusion_dataset(dataset_root)

        except FusionImportError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except zipfile.BadZipFile:
            return Response({"detail": "Invalid or corrupt ZIP file."}, status=status.HTTP_400_BAD_REQUEST)

        # Persist calibrations
        saved_calibrations = []
        calibration_errors = []

        for cam_name, cal_data in parsed["calibrations"].items():
            issues = validate_calibration_json(cal_data)
            if issues:
                calibration_errors.append({"camera": cam_name, "errors": issues})
                continue

            cal_obj, _ = CameraCalibration.objects.update_or_create(
                task=task,
                camera_name=cam_name,
                defaults={
                    "calibration_data": cal_data,
                    "created_by": request.user,
                },
            )
            saved_calibrations.append(cam_name)

        return Response(
            {
                "task_id": task_id,
                "frame_count": len(parsed["frames"]),
                "camera_count": len(parsed["calibrations"]),
                "saved_calibrations": saved_calibrations,
                "calibration_errors": calibration_errors,
                "warnings": parsed["errors"],
            },
            status=status.HTTP_201_CREATED,
        )
