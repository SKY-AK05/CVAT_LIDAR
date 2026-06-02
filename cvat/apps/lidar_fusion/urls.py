# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CameraCalibrationViewSet,
    CuboidProjectionView,
    FusionDatasetImportView,
    PointProjectionView,
)

router = DefaultRouter()

# /api/lidar-fusion/tasks/{task_id}/calibrations/
router.register(
    r"lidar-fusion/tasks/(?P<task_id>[0-9]+)/calibrations",
    CameraCalibrationViewSet,
    basename="camera-calibration",
)

urlpatterns = [
    path("", include(router.urls)),

    # Server-side point projection (fallback for large point clouds)
    path(
        "lidar-fusion/tasks/<int:task_id>/project-points/",
        PointProjectionView.as_view(),
        name="lidar-fusion-project-points",
    ),

    # 3D cuboid → all cameras projection
    path(
        "lidar-fusion/tasks/<int:task_id>/project-cuboid/",
        CuboidProjectionView.as_view(),
        name="lidar-fusion-project-cuboid",
    ),

    # Dataset import (ZIP upload)
    path(
        "lidar-fusion/tasks/<int:task_id>/import-dataset/",
        FusionDatasetImportView.as_view(),
        name="lidar-fusion-import-dataset",
    ),
]
