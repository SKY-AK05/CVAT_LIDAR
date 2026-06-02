// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * FusionWorkspace
 *
 * Top-level orchestrating component for the LiDAR-Camera Fusion view.
 *
 * Responsibilities:
 *  1. Load calibrations for the current task
 *  2. Build per-frame camera image URLs from existing CVAT context images
 *  3. Parse the current point cloud buffer (from the 3D canvas)
 *  4. Convert active ObjectState annotations to Cuboid3D for projection
 *  5. Synchronise all cameras when the frame changes
 *  6. Provide FusionToolbar controls
 *  7. Render MultiCameraLayout
 *
 * This component is designed to be mounted alongside (not instead of)
 * the existing CVAT 3D annotation workspace — it adds camera views
 * without replacing any existing UI.
 *
 * Architecture note for Future Phase:
 *   - The architecture is already prepared for editing cuboids from
 *     camera views: ProjectionRenderer exposes an ``onCuboidDrag`` hook
 *     (not wired yet), and FusionWorkspace dispatches canvas.edited events
 *     when that becomes available.
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useSelector } from 'react-redux';

import Alert from 'antd/lib/alert';
import Spin from 'antd/lib/spin';
import Typography from 'antd/lib/typography';

import { ObjectState, ObjectType } from 'cvat-core-wrapper';
import { CombinedState } from 'reducers';

import CalibrationManager from './CalibrationManager';
import FusionToolbar from './FusionToolbar';
import MultiCameraLayout from './MultiCameraLayout';
import { Cuboid3D } from './ProjectionRenderer';
import { DEFAULT_OVERLAY_CONTROLS, FusionOverlayControls } from './types';
import { useCalibrations } from './use-calibrations';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    taskId: number;
    jobId: number;
    /** Whether to show the CalibrationManager panel */
    showCalibrationPanel?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build context-image URLs from CVAT's existing related-files mechanism.
 * The URL pattern mirrors what context-image.tsx uses:
 *   GET /api/jobs/{jobId}/data?type=context_image&number={frame}&quality=original
 *
 * Returns a Map<cameraName, imageUrl>.
 * The mapping from sorted file index to camera name is done by matching
 * the calibration keys to sorted context image names.
 */
function buildImageUrls(
    jobId: number,
    frame: number,
    cameraNames: string[],
    relatedFiles: number,
): Record<string, string> {
    const result: Record<string, string> = {};
    const base = `/api/jobs/${jobId}/data?type=context_image&number=${frame}&quality=original`;

    // We re-use the same sorted-index logic as CVAT's context-image.tsx.
    // Each related file index maps to a camera by its sorted position.
    for (let i = 0; i < Math.min(cameraNames.length, relatedFiles); i++) {
        result[cameraNames[i]] = `${base}&index=${i}`;
    }
    return result;
}

/**
 * Convert an ObjectState annotation (cuboid) to the Cuboid3D format
 * expected by ProjectionRenderer.
 */
function stateToCuboid3D(state: ObjectState): Cuboid3D | null {
    if (!state.points || state.points.length < 9) return null;
    const [x, y, z, rx, ry, rz, w, h, d] = state.points as number[];
    return {
        clientID: state.clientID as number,
        center: [x, y, z],
        dimensions: [w, h, d],
        rotationZ: rz,
        color: state.color || '#00ff00',
        label: state.label?.name || '',
    };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FusionWorkspace({
    taskId,
    jobId,
    showCalibrationPanel = false,
}: Props): JSX.Element {
    const { calibrations, loading: calLoading, error: calError, refresh: refreshCals } = useCalibrations(taskId);

    const [controls, setControls] = useState<FusionOverlayControls>(DEFAULT_OVERLAY_CONTROLS);
    const [pointCloud, setPointCloud] = useState<Float32Array | null>(null);
    const [showCalPanel, setShowCalPanel] = useState(showCalibrationPanel);

    // ---------------------------------------------------------------------------
    // Pull data from Redux store
    // ---------------------------------------------------------------------------

    const {
        frame,
        relatedFiles,
        annotations,
        activatedStateID,
    } = useSelector((state: CombinedState) => ({
        frame: state.annotation.player.frame.number,
        relatedFiles: state.annotation.player.frame.relatedFiles as number,
        annotations: state.annotation.annotations.states as ObjectState[],
        activatedStateID: state.annotation.annotations.activatedStateID,
    }));

    // ---------------------------------------------------------------------------
    // Camera names — sorted to align with context image indices
    // ---------------------------------------------------------------------------

    const cameraNames = useMemo(
        () => Object.keys(calibrations).sort(),
        [calibrations],
    );

    // ---------------------------------------------------------------------------
    // Image URL map — rebuild on frame change
    // ---------------------------------------------------------------------------

    const imageUrls = useMemo(
        () => buildImageUrls(jobId, frame, cameraNames, relatedFiles),
        [jobId, frame, cameraNames, relatedFiles],
    );

    // ---------------------------------------------------------------------------
    // Cuboid list — rebuilt on annotation change
    // ---------------------------------------------------------------------------

    const uniqueClasses = useMemo(() => {
        const classes = new Set(annotations.map((s) => s.label?.name).filter(Boolean) as string[]);
        return Array.from(classes).sort();
    }, [annotations]);

    const cuboids = useMemo((): Cuboid3D[] => {
        const filtered = annotations.filter((state) => {
            if (state.objectType === ObjectType.TAG) return false;
            if (state.hidden) return false;
            if (controls.objectFilter.length > 0 && !controls.objectFilter.includes(state.label?.name || '')) {
                return false;
            }
            return true;
        });
        return filtered.map(stateToCuboid3D).filter(Boolean) as Cuboid3D[];
    }, [annotations, controls.objectFilter]);

    // ---------------------------------------------------------------------------
    // Extract point cloud from the 3D canvas on frame change
    // ---------------------------------------------------------------------------

    useEffect(() => {
        // CVAT loads the PCD via the frame data blob.
        // We listen for the canvas.setup event and read the point positions
        // from the THREE.js scene if available (non-invasive approach).
        // The canvas3d element exposes getDrawnObjects and the scene,
        // so we can walk the scene's Points child to extract the position buffer.

        const perspectiveCanvas = document.querySelector<HTMLCanvasElement>(
            '.cvat-canvas-container canvas',
        );

        if (!perspectiveCanvas) {
            setPointCloud(null);
            return;
        }

        const onSetup = (): void => {
            try {
                // @ts-ignore — non-standard property added by canvas3dView.ts
                const scene = (perspectiveCanvas as any).scene;
                if (!scene) return;

                // Find the first Points object in the scene
                let posBuffer: Float32Array | null = null;
                scene.traverse((obj: any) => {
                    if (posBuffer) return;
                    if (obj.isPoints) {
                        const attr = obj.geometry?.attributes?.position;
                        if (attr?.array) {
                            posBuffer = new Float32Array(attr.array);
                        }
                    }
                });
                setPointCloud(posBuffer);
            } catch {
                setPointCloud(null);
            }
        };

        perspectiveCanvas.addEventListener('canvas.setup', onSetup);
        return () => {
            perspectiveCanvas.removeEventListener('canvas.setup', onSetup);
        };
    }, [frame]);

    // ---------------------------------------------------------------------------
    // Build camera entries for MultiCameraLayout
    // ---------------------------------------------------------------------------

    const cameraEntries = useMemo(
        () => cameraNames
            .filter((name) =>
                controls.selectedCameras.length === 0 ||
                controls.selectedCameras.includes(name),
            )
            .map((name) => ({
                cameraName: name,
                calibration: calibrations[name],
                imageUrl: imageUrls[name] ?? null,
            })),
        [cameraNames, calibrations, imageUrls, controls.selectedCameras],
    );

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    if (calLoading) {
        return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin tip='Loading calibrations…' />
            </div>
        );
    }

    if (calError) {
        return (
            <Alert
                type='error'
                message='Failed to load calibrations'
                description={calError}
                style={{ margin: 8 }}
            />
        );
    }

    return (
        <div
            className='cvat-lidar-fusion-workspace'
            style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}
        >
            {/* Toolbar */}
            <FusionToolbar
                controls={controls}
                availableCameras={cameraNames}
                availableClasses={uniqueClasses}
                onChange={setControls}
            />

            {/* Calibration panel (collapsible) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text
                    style={{ fontSize: 11, cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => setShowCalPanel((v) => !v)}
                >
                    {showCalPanel ? '▾ Hide calibrations' : '▸ Manage calibrations'}
                </Text>
                {cameraNames.length > 0 && (
                    <Text style={{ fontSize: 11, color: '#666' }}>
                        ({cameraNames.length} camera{cameraNames.length !== 1 ? 's' : ''})
                    </Text>
                )}
            </div>

            {showCalPanel && (
                <div style={{ background: '#1a1a2e', borderRadius: 6, padding: '8px 12px' }}>
                    <CalibrationManager taskId={taskId} />
                </div>
            )}

            {/* No calibrations warning */}
            {cameraNames.length === 0 && (
                <Alert
                    type='info'
                    message='No camera calibrations found for this task.'
                    description='Upload a calibration JSON or import a dataset ZIP to enable sensor fusion.'
                    showIcon
                />
            )}

            {/* Multi-camera grid */}
            {cameraEntries.length > 0 && (
                <MultiCameraLayout
                    cameras={cameraEntries}
                    controls={controls}
                    pointCloud={pointCloud}
                    cuboids={cuboids}
                />
            )}
        </div>
    );
}
