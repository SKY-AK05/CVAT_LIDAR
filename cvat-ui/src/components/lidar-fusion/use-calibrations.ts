// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * React hook: load and cache all calibrations for the current task.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraCalibration } from './types';

export interface UseCalibrationResult {
    /** Map of cameraName → CameraCalibration */
    calibrations: Record<string, CameraCalibration>;
    loading: boolean;
    error: string | null;
    /** Re-fetch calibrations (e.g. after an upload) */
    refresh: () => void;
}

/**
 * Fetches all calibrations for *taskId* from the backend in the Xtreme1
 * format.  Results are cached across re-renders.
 */
export function useCalibrations(taskId: number | null): UseCalibrationResult {
    const [calibrations, setCalibrations] = useState<Record<string, CameraCalibration>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshCountRef = useRef(0);

    const fetch_ = useCallback(async () => {
        if (taskId === null) return;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(
                `/api/lidar-fusion/tasks/${taskId}/calibrations/all-xtreme1/`,
                { credentials: 'same-origin' },
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data: Record<string, any> = await response.json();

            // Normalise API response to CameraCalibration interface
            const normalised: Record<string, CameraCalibration> = {};
            for (const [name, raw] of Object.entries(data)) {
                normalised[name] = {
                    id: raw.id,
                    taskId: taskId,
                    cameraName: name,
                    version: raw.version,
                    cameraInternal: raw.cameraInternal,
                    cameraExternal: raw.cameraExternal,
                    rowMajor: raw.rowMajor ?? true,
                    width: raw.width,
                    height: raw.height,
                };
            }
            setCalibrations(normalised);
        } catch (err: any) {
            setError(err.message || 'Failed to load calibrations');
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        fetch_();
    }, [fetch_, refreshCountRef.current]);

    const refresh = useCallback(() => {
        refreshCountRef.current += 1;
        fetch_();
    }, [fetch_]);

    return { calibrations, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export interface CalibrationPayload {
    camera_name: string;
    calibration_data: object;
    image_width?: number;
    image_height?: number;
}

/**
 * Create or update a calibration for a task.
 *
 * @param taskId    CVAT task ID
 * @param payload   Calibration data
 * @param calId     If provided, performs a PATCH (update); otherwise POST (create)
 */
export async function saveCalibration(
    taskId: number,
    payload: CalibrationPayload,
    calId?: number,
): Promise<{ ok: boolean; error?: string; data?: any }> {
    const url = calId
        ? `/api/lidar-fusion/tasks/${taskId}/calibrations/${calId}/`
        : `/api/lidar-fusion/tasks/${taskId}/calibrations/`;

    const method = calId ? 'PATCH' : 'POST';

    // Read CSRF token from cookie
    const csrfToken = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrftoken='))
        ?.split('=')[1] ?? '';

    try {
        const response = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify({ task: taskId, ...payload }),
        });

        const data = await response.json();

        if (!response.ok) {
            return { ok: false, error: JSON.stringify(data) };
        }
        return { ok: true, data };
    } catch (err: any) {
        return { ok: false, error: err.message };
    }
}

/**
 * Upload a ZIP dataset archive to import calibrations automatically.
 */
export async function importFusionDataset(
    taskId: number,
    zipFile: File,
    onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; error?: string; data?: any }> {
    const csrfToken = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrftoken='))
        ?.split('=')[1] ?? '';

    const formData = new FormData();
    formData.append('file', zipFile);

    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/lidar-fusion/tasks/${taskId}/import-dataset/`);
        xhr.setRequestHeader('X-CSRFToken', csrfToken);
        xhr.withCredentials = true;

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
        }

        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({ ok: true, data });
                } else {
                    resolve({ ok: false, error: JSON.stringify(data) });
                }
            } catch {
                resolve({ ok: false, error: xhr.responseText });
            }
        };

        xhr.onerror = () => resolve({ ok: false, error: 'Network error' });
        xhr.send(formData);
    });
}
