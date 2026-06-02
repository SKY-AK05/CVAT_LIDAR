# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

from django.apps import AppConfig


class LidarFusionConfig(AppConfig):
    name = "cvat.apps.lidar_fusion"
    label = "lidar_fusion"
    verbose_name = "LiDAR-Camera Fusion"

    def ready(self):
        # Import signal handlers when the app is ready
        pass
