# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

"""
LiDAR-Camera Fusion models.

This module adds camera calibration support to existing CVAT tasks
without modifying any existing CVAT models.

Design principles:
- All new models use ForeignKeys to the existing Task model.
- Nothing in this module alters or removes existing CVAT tables.
- Calibration data is versioned so changes can be tracked.
"""

from __future__ import annotations

import json

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import models


# ---------------------------------------------------------------------------
# Camera calibration
# ---------------------------------------------------------------------------

class CameraCalibration(models.Model):
    """
    Stores intrinsic + extrinsic calibration for one camera associated with
    a CVAT task.  Multiple cameras per task are supported.

    Calibration JSON format (stored in ``calibration_data``):
    {
        "intrinsic": [[fx,0,cx],[0,fy,cy],[0,0,1]],
        "rotation":  [[r00,r01,r02],[r10,r11,r12],[r20,r21,r22]],
        "translation": [tx, ty, tz]
    }
    Alternatively, the Xtreme1 flat-matrix format is also accepted and
    normalised on save:
    {
        "cameraInternal": {"fx":…,"fy":…,"cx":…,"cy":…},
        "cameraExternal": [16 floats, column-major 4×4],
        "width": 1920, "height": 1080
    }
    """

    task = models.ForeignKey(
        "engine.Task",
        on_delete=models.CASCADE,
        related_name="camera_calibrations",
        related_query_name="camera_calibration",
    )
    camera_name = models.CharField(
        max_length=128,
        help_text="Logical name, e.g. 'front', 'rear', 'left', 'right' or any custom name.",
    )
    # Serialised calibration dict — validated on save
    calibration_data = models.JSONField(help_text="Calibration JSON (see model docstring).")

    # Optional image dimensions — aids the projection maths in the browser
    image_width = models.PositiveIntegerField(null=True, blank=True)
    image_height = models.PositiveIntegerField(null=True, blank=True)

    # Versioning
    version = models.PositiveIntegerField(
        default=1,
        help_text="Incremented each time the calibration is updated.",
    )
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_date = models.DateTimeField(auto_now_add=True)
    updated_date = models.DateTimeField(auto_now=True)

    class Meta:
        # One calibration name per task (can be updated via version)
        unique_together = (("task", "camera_name"),)
        ordering = ["task_id", "camera_name"]
        default_permissions = ()

    def __str__(self):
        return f"Calibration(task={self.task_id}, camera={self.camera_name}, v{self.version})"

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def clean(self):
        """Validate calibration_data structure."""
        data = self.calibration_data
        if not isinstance(data, dict):
            raise ValidationError("calibration_data must be a JSON object.")

        # Accept Xtreme1-style flat format
        if "cameraInternal" in data or "cameraExternal" in data:
            self._validate_xtreme1_format(data)
        else:
            self._validate_cvat_format(data)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_xtreme1_format(data: dict):
        if "cameraInternal" in data:
            ci = data["cameraInternal"]
            for key in ("fx", "fy", "cx", "cy"):
                if key not in ci:
                    raise ValidationError(f"cameraInternal is missing key '{key}'.")
        if "cameraExternal" in data:
            ce = data["cameraExternal"]
            if not isinstance(ce, list) or len(ce) != 16:
                raise ValidationError("cameraExternal must be a flat list of 16 numbers.")

    @staticmethod
    def _validate_cvat_format(data: dict):
        if "intrinsic" not in data:
            raise ValidationError("calibration_data must contain 'intrinsic'.")
        intr = data["intrinsic"]
        if not isinstance(intr, list) or len(intr) != 3:
            raise ValidationError("'intrinsic' must be a 3×3 nested list.")
        for row in intr:
            if not isinstance(row, list) or len(row) != 3:
                raise ValidationError("Each row of 'intrinsic' must contain 3 numbers.")

        if "rotation" in data:
            rot = data["rotation"]
            if not isinstance(rot, list) or len(rot) != 3:
                raise ValidationError("'rotation' must be a 3×3 nested list.")
        if "translation" in data:
            t = data["translation"]
            if not isinstance(t, list) or len(t) != 3:
                raise ValidationError("'translation' must be a list of 3 numbers.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------

    def to_xtreme1_format(self) -> dict:
        """
        Return the calibration data normalised to the Xtreme1 format that
        the frontend projection code expects.
        """
        data = self.calibration_data

        # Already in Xtreme1 format
        if "cameraInternal" in data:
            result = dict(data)
            if self.image_width:
                result["width"] = self.image_width
            if self.image_height:
                result["height"] = self.image_height
            return result

        # Convert from CVAT intrinsic/rotation/translation format
        intr = data["intrinsic"]
        fx = intr[0][0]
        fy = intr[1][1]
        cx = intr[0][2]
        cy = intr[1][2]

        rot = data.get("rotation", [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        t = data.get("translation", [0, 0, 0])

        # Build column-major 4×4 extrinsic matrix
        r = rot
        tx, ty, tz = t
        ext = [
            r[0][0], r[1][0], r[2][0], 0,
            r[0][1], r[1][1], r[2][1], 0,
            r[0][2], r[1][2], r[2][2], 0,
            tx,      ty,      tz,      1,
        ]

        return {
            "cameraInternal": {"fx": fx, "fy": fy, "cx": cx, "cy": cy},
            "cameraExternal": ext,
            "rowMajor": False,
            "width": self.image_width,
            "height": self.image_height,
        }


# ---------------------------------------------------------------------------
# Calibration revision history
# ---------------------------------------------------------------------------

class CameraCalibrationHistory(models.Model):
    """
    Immutable revision log for calibration changes.
    Every time a CameraCalibration is updated a new row is appended here.
    """

    calibration = models.ForeignKey(
        CameraCalibration,
        on_delete=models.CASCADE,
        related_name="history",
    )
    version = models.PositiveIntegerField()
    calibration_data = models.JSONField()
    changed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    changed_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["calibration_id", "-version"]
        default_permissions = ()

    def __str__(self):
        return f"CalibrationHistory(cal={self.calibration_id}, v{self.version})"
