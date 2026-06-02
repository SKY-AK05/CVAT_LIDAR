# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT
#
# Generated migration — DO NOT EDIT manually.
# Creates the two tables for camera calibration storage.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("engine", "0001_squashed_0051_auto_20220220_1824"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CameraCalibration",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("camera_name", models.CharField(
                    max_length=128,
                    help_text="Logical name, e.g. 'front', 'rear', 'left', 'right' or any custom name.",
                )),
                ("calibration_data", models.JSONField(
                    help_text="Calibration JSON (see model docstring).",
                )),
                ("image_width", models.PositiveIntegerField(null=True, blank=True)),
                ("image_height", models.PositiveIntegerField(null=True, blank=True)),
                ("version", models.PositiveIntegerField(
                    default=1,
                    help_text="Incremented each time the calibration is updated.",
                )),
                ("created_date", models.DateTimeField(auto_now_add=True)),
                ("updated_date", models.DateTimeField(auto_now=True)),
                ("task", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="camera_calibrations",
                    related_query_name="camera_calibration",
                    to="engine.task",
                )),
                ("created_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "ordering": ["task_id", "camera_name"],
                "default_permissions": (),
                "unique_together": {("task", "camera_name")},
            },
        ),
        migrations.CreateModel(
            name="CameraCalibrationHistory",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("version", models.PositiveIntegerField()),
                ("calibration_data", models.JSONField()),
                ("changed_date", models.DateTimeField(auto_now_add=True)),
                ("calibration", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="history",
                    to="lidar_fusion.cameracalibration",
                )),
                ("changed_by", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+",
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "ordering": ["calibration_id", "-version"],
                "default_permissions": (),
            },
        ),
    ]
