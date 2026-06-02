# Copyright (C) CVAT.ai Corporation
# SPDX-License-Identifier: MIT

from rest_framework import serializers

from .models import CameraCalibration, CameraCalibrationHistory


class CameraCalibrationSerializer(serializers.ModelSerializer):
    """
    Full serializer used for create / update / retrieve.
    Includes the ``xtreme1_format`` read-only field so the frontend can
    consume calibration data directly without any extra transformation.
    """

    xtreme1_format = serializers.SerializerMethodField(
        read_only=True,
        help_text="Calibration data normalised to the Xtreme1 projection format.",
    )

    class Meta:
        model = CameraCalibration
        fields = [
            "id",
            "task",
            "camera_name",
            "calibration_data",
            "image_width",
            "image_height",
            "version",
            "created_by",
            "created_date",
            "updated_date",
            "xtreme1_format",
        ]
        read_only_fields = ["id", "version", "created_by", "created_date", "updated_date", "xtreme1_format"]

    def get_xtreme1_format(self, obj: CameraCalibration) -> dict:
        return obj.to_xtreme1_format()

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["created_by"] = request.user
        return super().create(validated_data)

    def update(self, instance: CameraCalibration, validated_data):
        from .models import CameraCalibrationHistory

        # Snapshot current version into history before overwriting
        CameraCalibrationHistory.objects.create(
            calibration=instance,
            version=instance.version,
            calibration_data=instance.calibration_data,
            changed_by=instance.created_by,
        )
        instance.version += 1
        return super().update(instance, validated_data)


class CameraCalibrationListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for list views (no heavy calibration_data blob).
    """

    class Meta:
        model = CameraCalibration
        fields = ["id", "task", "camera_name", "version", "updated_date", "image_width", "image_height"]
        read_only_fields = fields


class CameraCalibrationHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = CameraCalibrationHistory
        fields = ["id", "calibration", "version", "calibration_data", "changed_by", "changed_date"]
        read_only_fields = fields


class PointProjectionRequestSerializer(serializers.Serializer):
    """
    Request body for server-side LiDAR → camera point projection.
    Used as a fallback when the browser cannot perform the projection.
    """

    # Flat list of XYZ triples: [x0,y0,z0, x1,y1,z1, ...]
    points = serializers.ListField(
        child=serializers.FloatField(),
        help_text="Flat array of XYZ coordinates: [x0,y0,z0, x1,y1,z1,...]",
    )
    camera_name = serializers.CharField(
        help_text="Name of the camera calibration to use for projection.",
    )

    def validate_points(self, value):
        if len(value) % 3 != 0:
            raise serializers.ValidationError("points must contain groups of 3 values (XYZ).")
        if len(value) > 300_000 * 3:  # cap at 300 k points per request
            raise serializers.ValidationError("Too many points. Maximum 300 000 per request.")
        return value


class ProjectedPointSerializer(serializers.Serializer):
    """One projected point on the camera image plane."""

    x = serializers.FloatField()
    y = serializers.FloatField()
    depth = serializers.FloatField(help_text="Depth (distance from camera along Z axis).")


class PointProjectionResponseSerializer(serializers.Serializer):
    camera_name = serializers.CharField()
    image_width = serializers.IntegerField()
    image_height = serializers.IntegerField()
    projected_points = ProjectedPointSerializer(many=True)
