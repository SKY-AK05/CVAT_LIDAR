// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * Type definitions for the LiDAR-Camera Fusion module.
 *
 * These types mirror the Xtreme1 IImgViewConfig / ICameraInternal interfaces
 * so the projection utilities are compatible with that design, while being
 * adapted to the CVAT data model.
 */

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface CameraIntrinsic {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
}

/**
 * A camera calibration as stored in the backend and consumed by the
 * projection engine.  Matches the Xtreme1 format.
 */
export interface CameraCalibration {
    /** Django model PK */
    id: number;
    taskId: number;
    cameraName: string;
    version: number;

    // Xtreme1 format fields (always populated by the API)
    cameraInternal: CameraIntrinsic;
    /** Flat column-major 4×4 matrix */
    cameraExternal: number[];
    rowMajor: boolean;
    width?: number;
    height?: number;
}

// ---------------------------------------------------------------------------
// Camera view config (per-frame, per-camera)
// ---------------------------------------------------------------------------

export interface CameraViewConfig {
    cameraName: string;
    calibration: CameraCalibration;
    /** URL to the related camera image for the current frame */
    imageUrl: string | null;
    /** Pre-loaded HTMLImageElement (or null while loading) */
    imageElement: HTMLImageElement | null;
    imageWidth: number;
    imageHeight: number;
}

// ---------------------------------------------------------------------------
// Overlay controls
// ---------------------------------------------------------------------------

export interface FusionOverlayControls {
    showProjection: boolean;
    showCuboidOverlay: boolean;
    pointOpacity: number;      // 0–1
    pointSize: number;         // 0.5–5
    selectedCameras: string[]; // subset of camera names to display
    /** If non-empty, only these object classes are projected */
    objectFilter: string[];
}

export const DEFAULT_OVERLAY_CONTROLS: FusionOverlayControls = {
    showProjection: true,
    showCuboidOverlay: true,
    pointOpacity: 0.8,
    pointSize: 2,
    selectedCameras: [],
    objectFilter: [],
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type CameraPosition = 'front' | 'rear' | 'left' | 'right' | 'custom';

export interface CameraLayoutSlot {
    cameraName: string;
    position: CameraPosition;
    /** Grid area descriptor, e.g. "top-center" */
    gridArea?: string;
}

// ---------------------------------------------------------------------------
// Projection result
// ---------------------------------------------------------------------------

export interface ProjectedPoint {
    x: number;
    y: number;
    depth: number;
}

export interface CuboidCornerProjection {
    x: number | null;
    y: number | null;
    depth: number;
    index: number;
    behind: boolean;
}

// ---------------------------------------------------------------------------
// Multi-camera synchronization event
// ---------------------------------------------------------------------------

export interface FusionFrameChangeEvent {
    frameNumber: number;
}
