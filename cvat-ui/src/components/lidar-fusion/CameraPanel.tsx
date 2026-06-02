// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * CameraPanel
 *
 * Single camera view inside the multi-camera layout.
 * Wraps a ProjectionRenderer canvas and adds:
 *  - Camera name label
 *  - Loading indicator
 *  - Error state
 *  - Fullscreen toggle
 */

import React, {
    forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';

import Spin from 'antd/lib/spin';
import Tag from 'antd/lib/tag';
import Tooltip from 'antd/lib/tooltip';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';

import { CameraCalibration, FusionOverlayControls } from './types';
import ProjectionRenderer, {
    Cuboid3D, ProjectionRendererHandle,
} from './ProjectionRenderer';

// ---------------------------------------------------------------------------
// Props / handle
// ---------------------------------------------------------------------------

interface Props {
    cameraName: string;
    calibration: CameraCalibration;
    imageUrl: string | null;
    controls: FusionOverlayControls;
    width: number;
    height: number;
}

export interface CameraPanelHandle {
    setPointCloud(buffer: Float32Array | null): void;
    setCuboids(cuboids: Cuboid3D[]): void;
    invalidate(): void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CameraPanel = forwardRef<CameraPanelHandle, Props>(
    function CameraPanel(props, ref): JSX.Element {
        const { cameraName, calibration, imageUrl, controls, width, height } = props;

        const rendererRef = useRef<ProjectionRendererHandle>(null);
        const [isFullscreen, setIsFullscreen] = useState(false);
        const [imageError, setImageError] = useState(false);
        const [imageLoading, setImageLoading] = useState(!!imageUrl);

        // Reset loading state when imageUrl changes
        useEffect(() => {
            if (imageUrl) {
                setImageLoading(true);
                setImageError(false);
                const img = new Image();
                img.onload = () => setImageLoading(false);
                img.onerror = () => {
                    setImageLoading(false);
                    setImageError(true);
                };
                img.src = imageUrl;
            } else {
                setImageLoading(false);
            }
        }, [imageUrl]);

        // Expose handle to parent for synchronised updates
        useImperativeHandle(ref, () => ({
            setPointCloud(buffer) {
                rendererRef.current?.setPointCloud(buffer);
            },
            setCuboids(cuboids) {
                rendererRef.current?.setCuboids(cuboids);
            },
            invalidate() {
                rendererRef.current?.invalidate();
            },
        }));

        const displayWidth = isFullscreen ? window.innerWidth * 0.9 : width;
        const displayHeight = isFullscreen ? window.innerHeight * 0.85 : height;

        return (
            <div
                className='cvat-lidar-fusion-camera-panel'
                style={{
                    position: 'relative',
                    border: '2px solid #333',
                    borderRadius: 4,
                    overflow: 'hidden',
                    width: displayWidth,
                    height: displayHeight,
                    background: '#111',
                    ...(isFullscreen ? {
                        position: 'fixed',
                        top: '5%',
                        left: '5%',
                        zIndex: 1000,
                        boxShadow: '0 0 30px rgba(0,0,0,0.8)',
                    } : {}),
                }}
            >
                {/* Projection renderer canvas */}
                <ProjectionRenderer
                    ref={rendererRef}
                    calibration={calibration}
                    imageUrl={imageError ? null : imageUrl}
                    controls={controls}
                    width={displayWidth}
                    height={displayHeight}
                    style={{ width: '100%', height: '100%' }}
                />

                {/* Loading spinner */}
                {imageLoading && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.4)',
                    }}>
                        <Spin size='small' />
                    </div>
                )}

                {/* Camera label */}
                <div style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    pointerEvents: 'none',
                }}>
                    <Tag
                        color={imageError ? 'error' : 'geekblue'}
                        style={{ fontSize: 11, padding: '0 4px', margin: 0 }}
                    >
                        {cameraName}
                        {imageError && ' ⚠'}
                    </Tag>
                </div>

                {/* Fullscreen toggle */}
                <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    <button
                        type='button'
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onClick={() => setIsFullscreen((v) => !v)}
                        style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            background: 'rgba(0,0,0,0.5)',
                            border: 'none',
                            borderRadius: 3,
                            color: '#ccc',
                            cursor: 'pointer',
                            padding: '2px 5px',
                            lineHeight: 1,
                        }}
                    >
                        {isFullscreen ? (
                            <FullscreenExitOutlined style={{ fontSize: 14 }} />
                        ) : (
                            <FullscreenOutlined style={{ fontSize: 14 }} />
                        )}
                    </button>
                </Tooltip>

                {/* Fullscreen backdrop */}
                {isFullscreen && (
                    <div
                        role='button'
                        tabIndex={0}
                        aria-label='Close fullscreen'
                        onClick={() => setIsFullscreen(false)}
                        onKeyDown={(e) => e.key === 'Escape' && setIsFullscreen(false)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0,0,0,0.6)',
                            zIndex: 999,
                        }}
                    />
                )}
            </div>
        );
    },
);

export default CameraPanel;
