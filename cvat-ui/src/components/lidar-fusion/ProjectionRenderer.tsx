// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * ProjectionRenderer
 *
 * A Canvas2D overlay that:
 * 1. Draws the camera image
 * 2. Renders projected LiDAR point cloud dots on top
 * 3. Renders projected 3D cuboid wireframes
 *
 * Performance notes:
 * - Uses requestAnimationFrame for rendering
 * - The point cloud is cached as a Float32Array and only re-projected
 *   when the calibration or frame changes
 * - Cuboid overlays are re-rendered on every animation frame (they are few)
 * - Uses GPU-friendly Canvas2D batched path operations
 */

import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    forwardRef,
} from 'react';

import { CameraCalibration, CuboidCornerProjection, FusionOverlayControls, ProjectedPoint } from './types';
import {
    buildProjectionMatrix,
    projectCuboidCorners,
    projectPointCloud,
} from './projection-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cuboid3D {
    clientID: number;
    center: [number, number, number];
    dimensions: [number, number, number];
    rotationZ: number;
    color: string;
    label: string;
}

export interface ProjectionRendererHandle {
    /** Force an immediate re-render */
    invalidate(): void;
    /** Update the point cloud buffer (heavy — only on frame change) */
    setPointCloud(buffer: Float32Array | null): void;
    /** Update the list of 3D cuboids to project */
    setCuboids(cuboids: Cuboid3D[]): void;
}

interface Props {
    calibration: CameraCalibration;
    imageUrl: string | null;
    controls: FusionOverlayControls;
    width?: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Depth-to-colour LUT  (green-yellow-red, depth 0–100 m)
// ---------------------------------------------------------------------------

const DEPTH_MAX = 100;

function depthToColor(depth: number): string {
    const t = Math.min(depth / DEPTH_MAX, 1);
    const r = Math.round(255 * t);
    const g = Math.round(255 * (1 - t));
    return `rgb(${r},${g},0)`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ProjectionRenderer = forwardRef<ProjectionRendererHandle, Props>(
    function ProjectionRenderer(props, ref): JSX.Element {
        const {
            calibration, imageUrl, controls, width = 640, height = 360, className, style,
        } = props;

        const canvasRef = useRef<HTMLCanvasElement>(null);
        const pointCloudRef = useRef<Float32Array | null>(null);
        const cuboidsRef = useRef<Cuboid3D[]>([]);
        const imageRef = useRef<HTMLImageElement | null>(null);
        const frameRef = useRef<number>(0);
        const projMatrixRef = useRef(buildProjectionMatrix(calibration));
        const dirtyRef = useRef(true);

        // Rebuild projection matrix when calibration changes
        useEffect(() => {
            projMatrixRef.current = buildProjectionMatrix(calibration);
            dirtyRef.current = true;
        }, [calibration]);

        // Load image when imageUrl changes
        useEffect(() => {
            if (!imageUrl) {
                imageRef.current = null;
                dirtyRef.current = true;
                return;
            }
            const img = new Image();
            img.onload = () => {
                imageRef.current = img;
                dirtyRef.current = true;
            };
            img.src = imageUrl;
        }, [imageUrl]);

        // Re-render when controls change
        useEffect(() => {
            dirtyRef.current = true;
        }, [controls]);

        // Expose imperative API to parent
        useImperativeHandle(ref, () => ({
            invalidate() {
                dirtyRef.current = true;
            },
            setPointCloud(buffer: Float32Array | null) {
                pointCloudRef.current = buffer;
                dirtyRef.current = true;
            },
            setCuboids(cuboids: Cuboid3D[]) {
                cuboidsRef.current = cuboids;
                dirtyRef.current = true;
            },
        }));

        // ---------------------------------------------------------------------------
        // Render loop
        // ---------------------------------------------------------------------------

        const render = useCallback(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            if (!dirtyRef.current) return;
            dirtyRef.current = false;

            ctx.clearRect(0, 0, width, height);

            // 1. Draw background camera image
            const img = imageRef.current;
            if (img) {
                ctx.globalAlpha = 1;
                ctx.drawImage(img, 0, 0, width, height);
            } else {
                ctx.fillStyle = '#1a1a2e';
                ctx.fillRect(0, 0, width, height);
                ctx.fillStyle = '#555';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No image', width / 2, height / 2);
            }

            // Scale factor: project at original calibration resolution, then
            // downscale to the canvas display size
            const scaleX = width / (calibration.width ?? width);
            const scaleY = height / (calibration.height ?? height);

            // 2. Draw projected LiDAR points
            if (controls.showProjection && pointCloudRef.current) {
                const pts = projectPointCloud(calibration, pointCloudRef.current);
                const ptSize = Math.max(0.5, controls.pointSize);

                ctx.save();
                ctx.globalAlpha = controls.pointOpacity;

                // Batch by depth colour bucket (reduces fillStyle thrashing)
                const buckets = new Map<string, ProjectedPoint[]>();
                for (const pt of pts) {
                    const col = depthToColor(pt.depth);
                    if (!buckets.has(col)) buckets.set(col, []);
                    buckets.get(col)!.push(pt);
                }

                for (const [color, points] of buckets) {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    for (const pt of points) {
                        const px = pt.x * scaleX;
                        const py = pt.y * scaleY;
                        ctx.moveTo(px + ptSize, py);
                        ctx.arc(px, py, ptSize, 0, Math.PI * 2);
                    }
                    ctx.fill();
                }

                ctx.restore();
            }

            // 3. Draw cuboid projections
            if (controls.showCuboidOverlay && cuboidsRef.current.length > 0) {
                for (const cuboid of cuboidsRef.current) {
                    const corners = projectCuboidCorners(
                        calibration,
                        cuboid.center,
                        cuboid.dimensions,
                        cuboid.rotationZ,
                    );
                    drawCuboidWireframe(ctx, corners, cuboid.color, scaleX, scaleY);
                }
            }
        }, [calibration, controls, width, height]);

        // Animation loop (only redraws when dirty)
        useEffect(() => {
            let running = true;
            const loop = (): void => {
                if (!running) return;
                render();
                frameRef.current = requestAnimationFrame(loop);
            };
            loop();
            return () => {
                running = false;
                cancelAnimationFrame(frameRef.current);
            };
        }, [render]);

        return (
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className={className}
                style={{
                    display: 'block',
                    background: '#1a1a2e',
                    ...style,
                }}
                aria-label={`Camera view: ${calibration.cameraName}`}
            />
        );
    },
);

export default ProjectionRenderer;

// ---------------------------------------------------------------------------
// Cuboid wireframe drawing
// ---------------------------------------------------------------------------

/**
 * Draw the projected 8-corner cuboid wireframe on a 2D canvas.
 *
 * Corner order (matches projection-utils.ts):
 *   Front face: 0,1,2,3   Back face: 4,5,6,7
 */
function drawCuboidWireframe(
    ctx: CanvasRenderingContext2D,
    corners: CuboidCornerProjection[],
    color: string,
    scaleX: number,
    scaleY: number,
): void {
    const validCorners = corners.filter((c) => !c.behind && c.x !== null && c.y !== null);
    if (validCorners.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;

    // Edges: front face, back face, and connecting edges
    const edges = [
        // Front face
        [0, 1], [1, 2], [2, 3], [3, 0],
        // Back face
        [4, 5], [5, 6], [6, 7], [7, 4],
        // Connecting
        [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    ctx.beginPath();
    for (const [ai, bi] of edges) {
        const a = corners[ai];
        const b = corners[bi];
        if (a.behind || b.behind || a.x === null || b.x === null) continue;
        ctx.moveTo(a.x! * scaleX, a.y! * scaleY);
        ctx.lineTo(b.x! * scaleX, b.y! * scaleY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}
