// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * CalibrationManager
 *
 * UI component that lets an annotator:
 * 1. View all calibrations attached to the current task
 * 2. Upload a single calibration JSON for one camera
 * 3. Upload a full dataset ZIP to import all calibrations at once
 * 4. See calibration version history
 */

import React, {
    useCallback, useRef, useState,
} from 'react';

import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';
import Divider from 'antd/lib/divider';
import Form from 'antd/lib/form';
import Input from 'antd/lib/input';
import Modal from 'antd/lib/modal';
import Spin from 'antd/lib/spin';
import Tag from 'antd/lib/tag';
import Typography from 'antd/lib/typography';
import notification from 'antd/lib/notification';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';

import { CameraCalibration } from './types';
import { importFusionDataset, saveCalibration, useCalibrations } from './use-calibrations';

const { Title, Text } = Typography;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    taskId: number;
}

// ---------------------------------------------------------------------------
// CalibrationCard — shows one camera's calibration
// ---------------------------------------------------------------------------

function CalibrationCard({ cal }: { cal: CameraCalibration }): JSX.Element {
    const [showRaw, setShowRaw] = useState(false);
    const ci = cal.cameraInternal;

    return (
        <Card
            title={<><Tag color='blue'>{cal.cameraName}</Tag> v{cal.version}</>}
            size='small'
            style={{ marginBottom: 12 }}
            extra={
                <Button size='small' onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? 'Summary' : 'Raw JSON'}
                </Button>
            }
        >
            {showRaw ? (
                <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
                    {JSON.stringify({ cameraInternal: ci, cameraExternal: cal.cameraExternal }, null, 2)}
                </pre>
            ) : (
                <Descriptions size='small' column={2}>
                    <Descriptions.Item label='fx'>{ci.fx.toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label='fy'>{ci.fy.toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label='cx'>{ci.cx.toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label='cy'>{ci.cy.toFixed(4)}</Descriptions.Item>
                    {cal.width && (
                        <Descriptions.Item label='Image'>
                            {cal.width}×{cal.height}
                        </Descriptions.Item>
                    )}
                </Descriptions>
            )}
        </Card>
    );
}

// ---------------------------------------------------------------------------
// AddCalibrationModal — JSON paste / file upload for one camera
// ---------------------------------------------------------------------------

interface AddCalibrationModalProps {
    taskId: number;
    existingNames: string[];
    onSuccess: () => void;
    onClose: () => void;
}

function AddCalibrationModal(props: AddCalibrationModalProps): JSX.Element {
    const {
        taskId, existingNames, onSuccess, onClose,
    } = props;
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (values: { camera_name: string; calibration_json: string }) => {
        setSaving(true);
        let parsed: object;
        try {
            parsed = JSON.parse(values.calibration_json);
        } catch {
            notification.error({ message: 'Invalid JSON — please check your calibration file.' });
            setSaving(false);
            return;
        }

        const existing = existingNames.find((n) => n === values.camera_name);
        const result = await saveCalibration(
            taskId,
            { camera_name: values.camera_name, calibration_data: parsed },
            existing ? undefined : undefined, // POST for new camera
        );

        setSaving(false);

        if (result.ok) {
            notification.success({ message: `Calibration saved for '${values.camera_name}'.` });
            onSuccess();
            onClose();
        } else {
            notification.error({ message: `Save failed: ${result.error}` });
        }
    };

    return (
        <Modal
            open
            title='Add / Update Camera Calibration'
            onCancel={onClose}
            footer={null}
            width={540}
        >
            <Form form={form} layout='vertical' onFinish={handleSubmit}>
                <Form.Item
                    name='camera_name'
                    label='Camera Name'
                    rules={[{ required: true, message: 'Camera name is required.' }]}
                    help="e.g. 'front', 'rear', 'left', 'right' or any custom name"
                >
                    <Input placeholder='front' />
                </Form.Item>
                <Form.Item
                    name='calibration_json'
                    label='Calibration JSON'
                    rules={[{ required: true, message: 'Calibration JSON is required.' }]}
                    help='Paste calibration data (CVAT or Xtreme1 format)'
                >
                    <Input.TextArea
                        rows={10}
                        placeholder={'{\n  "cameraInternal": { "fx": 933, "fy": 934, "cx": 896, "cy": 507 },\n  "cameraExternal": [...16 floats...],\n  "width": 1920, "height": 1080\n}'}
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                </Form.Item>
                <Button type='primary' htmlType='submit' loading={saving} block>
                    Save Calibration
                </Button>
            </Form>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// CalibrationManager (main export)
// ---------------------------------------------------------------------------

export default function CalibrationManager({ taskId }: Props): JSX.Element {
    const { calibrations, loading, error, refresh } = useCalibrations(taskId);
    const [showAddModal, setShowAddModal] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const calList = Object.values(calibrations);

    const handleZipUpload = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setUploadProgress(0);
            const result = await importFusionDataset(taskId, file, setUploadProgress);
            setUploadProgress(null);

            if (result.ok) {
                const { saved_calibrations, warnings, frame_count } = result.data;
                notification.success({
                    message: 'Dataset imported successfully',
                    description: (
                        <>
                            <div>Frames: {frame_count}</div>
                            <div>Cameras: {saved_calibrations.join(', ')}</div>
                            {warnings?.length > 0 && (
                                <div style={{ color: 'orange' }}>Warnings: {warnings.length}</div>
                            )}
                        </>
                    ),
                    duration: 8,
                });
                refresh();
            } else {
                notification.error({
                    message: 'Import failed',
                    description: result.error,
                });
            }

            // Reset file input
            if (fileInputRef.current) fileInputRef.current.value = '';
        },
        [taskId, refresh],
    );

    return (
        <div style={{ padding: '16px 0' }}>
            <Title level={5} style={{ marginBottom: 8 }}>
                Camera Calibrations
            </Title>

            {/* Action buttons */}
            <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                <Button
                    icon={<PlusOutlined />}
                    size='small'
                    onClick={() => setShowAddModal(true)}
                >
                    Add Calibration
                </Button>

                <Button
                    icon={<UploadOutlined />}
                    size='small'
                    loading={uploadProgress !== null}
                    onClick={() => fileInputRef.current?.click()}
                >
                    {uploadProgress !== null
                        ? `Uploading… ${uploadProgress}%`
                        : 'Import Dataset ZIP'}
                </Button>

                {/* Hidden file input for ZIP upload */}
                <input
                    ref={fileInputRef}
                    type='file'
                    accept='.zip'
                    style={{ display: 'none' }}
                    onChange={handleZipUpload}
                />
            </div>

            {/* Status messages */}
            {loading && <Spin size='small' style={{ marginBottom: 8 }} />}
            {error && (
                <Text type='danger' style={{ display: 'block', marginBottom: 8 }}>
                    {error}
                </Text>
            )}

            {/* Calibration list */}
            {!loading && calList.length === 0 && (
                <Text type='secondary'>
                    No calibrations yet. Add one manually or import a dataset ZIP.
                </Text>
            )}
            {calList.map((cal) => (
                <CalibrationCard key={cal.cameraName} cal={cal} />
            ))}

            <Divider />
            <Text type='secondary' style={{ fontSize: 11 }}>
                Calibrations are versioned. Every update creates a new version in the history log.
            </Text>

            {/* Add/Update modal */}
            {showAddModal && (
                <AddCalibrationModal
                    taskId={taskId}
                    existingNames={calList.map((c) => c.cameraName)}
                    onSuccess={refresh}
                    onClose={() => setShowAddModal(false)}
                />
            )}
        </div>
    );
}
