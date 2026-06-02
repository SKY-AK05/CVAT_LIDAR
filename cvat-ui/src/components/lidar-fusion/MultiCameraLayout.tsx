// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * MultiCameraLayout
 *
 * Arranges multiple CameraPanel instances in the standard sensor-fusion
 * grid layout:
 *
 *   ┌────────────────────────┐
 *   │       Front            │
 *   ├───────┬────────┬───────┤
 *   │ Left  │  3D PC │ Right │
 *   ├───────┴────────┴───────┤
 *   │       Rear             │
 *   └────────────────────────┘
 *
 * Cameras that do not match a named position fall into an "extra" row.
 * The layout is configurable via the ``layoutSlots`` prop.
 *
 * Multi-camera synchronisation: when ``pointCloud`` or ``cuboids``
 * changes, all panels are updated simultaneously via imperative refs.
 */

import React, {
    useCallback, useEffect, useRef,
} from 'react';

import { CameraCalibration, FusionOverlayControls } from './types';
import CameraPanel, { CameraPanelHandle } from './CameraPanel';
import { Cuboid3D } from './ProjectionRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CameraViewEntry {
    cameraName: string;
    calibration: CameraCalibration;
    /** URL to the context image for the current frame (may be null) */
    imageUrl: string | null;
}

interface Props {
    cameras: CameraViewEntry[];
    controls: FusionOverlayControls;
    /** Float32Array of point cloud for the current frame */
    pointCloud: Float32Array | null;
    /** 3D cuboids to project (updated on every annotation change) */
    cuboids: Cuboid3D[];
    /** Optional slot override: map from cameraName → grid slot name */
    layoutSlots?: Record<string, string>;
    /** The 3D canvas element (provided by CVAT) — placed in the centre */
    canvas3dElement?: HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Default layout slot assignment
// ---------------------------------------------------------------------------

const NAMED_POSITIONS: Record<string, number> = {
    front:   0,
    top:     0,    // alias
    rear:    2,
    bottom:  2,    // alias
    back:    2,    // alias
    left:    1,
    right:   3,
};

function assignSlot(cameraName: string, override?: Record<string, string>): string {
    const lower = cameraName.toLowerCase();
    if (override?.[cameraName]) return override[cameraName];
    for (const key of Object.keys(NAMED_POSITIONS)) {
        if (lower.includes(key)) return key;
    }
    return 'extra';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MultiCameraLayout(props: Props): JSX.Element {
    const {
        cameras, controls, pointCloud, cuboids, layoutSlots, canvas3dElement,
    } = props;

    // One ref per camera, keyed by camera name
    const panelRefs = useRef<Record<string, CameraPanelHandle | null>>({});

    // Synchronise point cloud to all panels on change
    useEffect(() => {
        for (const handle of Object.values(panelRefs.current)) {
            handle?.setPointCloud(pointCloud);
        }
    }, [pointCloud]);

    // Synchronise cuboids to all panels on change (real-time)
    useEffect(() => {
        for (const handle of Object.values(panelRefs.current)) {
            handle?.setCuboids(cuboids);
        }
    }, [cuboids]);

    // ---------------------------------------------------------------------------
    // Slot grouping
    // ---------------------------------------------------------------------------

    const front  = cameras.filter((c) => assignSlot(c.cameraName, layoutSlots) === 'front');
    const left   = cameras.filter((c) => assignSlot(c.cameraName, layoutSlots) === 'left');
    const right  = cameras.filter((c) => assignSlot(c.cameraName, layoutSlots) === 'right');
    const rear   = cameras.filter((c) => assignSlot(c.cameraName, layoutSlots) === 'rear');
    const extra  = cameras.filter((c) => assignSlot(c.cameraName, layoutSlots) === 'extra');

    const panelW = 320;
    const panelH = 200;

    const makeRef = useCallback((name: string) => (el: CameraPanelHandle | null) => {
        panelRefs.current[name] = el;
    }, []);

    const renderCamera = (entry: CameraViewEntry): JSX.Element => (
        <CameraPanel
            key={entry.cameraName}
            ref={makeRef(entry.cameraName)}
            cameraName={entry.cameraName}
            calibration={entry.calibration}
            imageUrl={entry.imageUrl}
            controls={controls}
            width={panelW}
            height={panelH}
        />
    );

    return (
        <div
            className='cvat-lidar-fusion-multi-camera-layout'
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
            {/* Row 1: Front cameras */}
            {front.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                    {front.map(renderCamera)}
                </div>
            )}

            {/* Row 2: Left | 3D point cloud | Right */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                {/* Left cameras */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {left.map(renderCamera)}
                </div>

                {/* Centre: 3D canvas or placeholder */}
                <div style={{
                    flex: 1,
                    minWidth: panelW,
                    minHeight: panelH,
                    background: '#0a0a14',
                    border: '2px solid #444',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#666',
                    fontSize: 12,
                }}
                    ref={(el) => {
                        if (el && canvas3dElement && !el.contains(canvas3dElement)) {
                            el.appendChild(canvas3dElement);
                        }
                    }}
                >
                    {!canvas3dElement && (
                        <span style={{ color: '#555', pointerEvents: 'none' }}>
                            3D Point Cloud
                        </span>
                    )}
                </div>

                {/* Right cameras */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {right.map(renderCamera)}
                </div>
            </div>

            {/* Row 3: Rear cameras */}
            {rear.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                    {rear.map(renderCamera)}
                </div>
            )}

            {/* Row 4: Extra / unassigned cameras */}
            {extra.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {extra.map(renderCamera)}
                </div>
            )}
        </div>
    );
}
