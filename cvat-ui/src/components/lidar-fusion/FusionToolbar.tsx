// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * FusionToolbar
 *
 * Overlay controls panel shown above the multi-camera fusion view:
 *   - Toggle point projection
 *   - Toggle cuboid overlay
 *   - Point opacity slider
 *   - Point size slider
 *   - Camera selection checkboxes
 *   - Object class filter
 */

import React from 'react';
import Checkbox from 'antd/lib/checkbox';
import Slider from 'antd/lib/slider';
import Space from 'antd/lib/space';
import Switch from 'antd/lib/switch';
import Tooltip from 'antd/lib/tooltip';
import Typography from 'antd/lib/typography';
import Divider from 'antd/lib/divider';

import { DEFAULT_OVERLAY_CONTROLS, FusionOverlayControls } from './types';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    controls: FusionOverlayControls;
    availableCameras: string[];
    availableClasses: string[];
    onChange: (next: FusionOverlayControls) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FusionToolbar({
    controls, availableCameras, availableClasses, onChange,
}: Props): JSX.Element {
    const update = (patch: Partial<FusionOverlayControls>): void => {
        onChange({ ...controls, ...patch });
    };

    return (
        <div
            className='cvat-lidar-fusion-toolbar'
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '6px 12px',
                background: 'rgba(0,0,0,0.75)',
                borderRadius: 6,
                flexWrap: 'wrap',
                userSelect: 'none',
            }}
        >
            {/* Point projection toggle */}
            <Tooltip title='Show/hide projected LiDAR points on camera images'>
                <Space size={4}>
                    <Text style={{ color: '#ccc', fontSize: 12 }}>Points</Text>
                    <Switch
                        size='small'
                        checked={controls.showProjection}
                        onChange={(v) => update({ showProjection: v })}
                    />
                </Space>
            </Tooltip>

            {/* Cuboid overlay toggle */}
            <Tooltip title='Show/hide projected 3D cuboid wireframes on camera images'>
                <Space size={4}>
                    <Text style={{ color: '#ccc', fontSize: 12 }}>Cuboids</Text>
                    <Switch
                        size='small'
                        checked={controls.showCuboidOverlay}
                        onChange={(v) => update({ showCuboidOverlay: v })}
                    />
                </Space>
            </Tooltip>

            <Divider type='vertical' style={{ borderColor: '#555', height: 24 }} />

            {/* Opacity slider */}
            <Space size={4} direction='vertical' style={{ width: 100 }}>
                <Text style={{ color: '#ccc', fontSize: 11 }}>
                    Opacity {Math.round(controls.pointOpacity * 100)}%
                </Text>
                <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(controls.pointOpacity * 100)}
                    onChange={(v) => update({ pointOpacity: v / 100 })}
                    style={{ width: 90, margin: 0 }}
                    tooltip={{ formatter: (v) => `${v}%` }}
                />
            </Space>

            {/* Point size slider */}
            <Space size={4} direction='vertical' style={{ width: 100 }}>
                <Text style={{ color: '#ccc', fontSize: 11 }}>
                    Point Size {controls.pointSize.toFixed(1)}
                </Text>
                <Slider
                    min={0.5}
                    max={6}
                    step={0.5}
                    value={controls.pointSize}
                    onChange={(v) => update({ pointSize: v })}
                    style={{ width: 90, margin: 0 }}
                    tooltip={{ formatter: (v) => `${v}px` }}
                />
            </Space>

            <Divider type='vertical' style={{ borderColor: '#555', height: 24 }} />

            {/* Camera selection */}
            {availableCameras.length > 0 && (
                <Space size={4} direction='vertical'>
                    <Text style={{ color: '#ccc', fontSize: 11 }}>Cameras</Text>
                    <Checkbox.Group
                        options={availableCameras.map((name) => ({ label: name, value: name }))}
                        value={controls.selectedCameras.length > 0 ? controls.selectedCameras : availableCameras}
                        onChange={(values) =>
                            update({ selectedCameras: values.length === availableCameras.length ? [] : values as string[] })
                        }
                        style={{ display: 'flex', gap: 6 }}
                    />
                </Space>
            )}

            {/* Object class filter */}
            {availableClasses.length > 0 && (
                <>
                    <Divider type='vertical' style={{ borderColor: '#555', height: 24 }} />
                    <Space size={4} direction='vertical'>
                        <Text style={{ color: '#ccc', fontSize: 11 }}>Filter Classes</Text>
                        <Checkbox.Group
                            options={availableClasses.map((name) => ({ label: name, value: name }))}
                            value={controls.objectFilter.length > 0 ? controls.objectFilter : availableClasses}
                            onChange={(values) =>
                                update({ objectFilter: values.length === availableClasses.length ? [] : values as string[] })
                            }
                            style={{ display: 'flex', gap: 6 }}
                        />
                    </Space>
                </>
            )}

            {/* Reset button */}
            <Tooltip title='Reset all overlay controls to defaults'>
                <Text
                    style={{ color: '#888', fontSize: 11, cursor: 'pointer' }}
                    onClick={() => onChange({ ...DEFAULT_OVERLAY_CONTROLS })}
                >
                    Reset
                </Text>
            </Tooltip>
        </div>
    );
}
