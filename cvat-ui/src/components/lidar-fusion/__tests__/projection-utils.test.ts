// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the browser-side projection utilities.
 * Run with Jest (already configured in the CVAT frontend workspace).
 */

import {
    buildProjectionMatrix,
    projectPoint,
    projectPointCloud,
    projectCuboidCorners,
} from '../projection-utils';
import { CameraCalibration } from '../types';

// ---------------------------------------------------------------------------
// Test fixture: identity camera at origin looking down +Z
// ---------------------------------------------------------------------------

function makeIdentityCal(overrides: Partial<CameraCalibration> = {}): CameraCalibration {
    return {
        id: 1,
        taskId: 1,
        cameraName: 'front',
        version: 1,
        cameraInternal: { fx: 500, fy: 500, cx: 320, cy: 240 },
        // Identity 4×4 row-major
        cameraExternal: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ],
        rowMajor: true,
        width: 640,
        height: 480,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// buildProjectionMatrix
// ---------------------------------------------------------------------------

describe('buildProjectionMatrix', () => {
    it('returns a Float64Array of length 16', () => {
        const mat = buildProjectionMatrix(makeIdentityCal());
        expect(mat).toBeInstanceOf(Float64Array);
        expect(mat.length).toBe(16);
    });

    it('is deterministic for the same calibration', () => {
        const cal = makeIdentityCal();
        const m1 = buildProjectionMatrix(cal);
        const m2 = buildProjectionMatrix(cal);
        for (let i = 0; i < 16; i++) {
            expect(m1[i]).toBeCloseTo(m2[i], 10);
        }
    });
});

// ---------------------------------------------------------------------------
// projectPoint
// ---------------------------------------------------------------------------

describe('projectPoint', () => {
    const cal = makeIdentityCal();
    const mat = buildProjectionMatrix(cal);

    it('projects a point on the camera axis to the principal point', () => {
        const result = projectPoint(cal, mat, 0, 0, 5);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(320, 1);
        expect(result!.y).toBeCloseTo(240, 1);
        expect(result!.depth).toBeCloseTo(5, 5);
    });

    it('returns null for points behind the camera', () => {
        const result = projectPoint(cal, mat, 0, 0, -1);
        expect(result).toBeNull();
    });

    it('returns null for Zc == 0', () => {
        const result = projectPoint(cal, mat, 0, 0, 0);
        expect(result).toBeNull();
    });

    it('shifts correctly for off-axis point', () => {
        // Point at (1, 0, 5): expected u = 320 + 500*(1/5) = 420
        const result = projectPoint(cal, mat, 1, 0, 5);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(420, 0);
        expect(result!.y).toBeCloseTo(240, 0);
    });
});

// ---------------------------------------------------------------------------
// projectPointCloud
// ---------------------------------------------------------------------------

describe('projectPointCloud', () => {
    const cal = makeIdentityCal();

    it('projects a Float32Array of points', () => {
        const buffer = new Float32Array([
            0, 0, 5,   // visible, centre
            0, 0, -1,  // behind camera
        ]);
        const result = projectPointCloud(cal, buffer);
        expect(result.length).toBe(1);
        expect(result[0].x).toBeCloseTo(320, 1);
    });

    it('clips points outside image bounds by default', () => {
        // Point that projects way off-screen
        const buffer = new Float32Array([5000, 5000, 1]);
        const result = projectPointCloud(cal, buffer, true);
        expect(result.length).toBe(0);
    });

    it('does not clip when clipToImage=false', () => {
        const buffer = new Float32Array([5000, 5000, 1]);
        const result = projectPointCloud(cal, buffer, false);
        expect(result.length).toBe(1);
    });

    it('handles empty buffer', () => {
        const result = projectPointCloud(cal, new Float32Array(0));
        expect(result).toEqual([]);
    });

    it('handles large buffer performantly', () => {
        const n = 100_000;
        const buffer = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            buffer[i * 3]     = 0;
            buffer[i * 3 + 1] = 0;
            buffer[i * 3 + 2] = 5;
        }
        const start = performance.now();
        const result = projectPointCloud(cal, buffer);
        const elapsed = performance.now() - start;
        // Should complete in under 500 ms on any modern machine
        expect(elapsed).toBeLessThan(500);
        expect(result.length).toBe(n);
    });
});

// ---------------------------------------------------------------------------
// projectCuboidCorners
// ---------------------------------------------------------------------------

describe('projectCuboidCorners', () => {
    const cal = makeIdentityCal();

    it('returns 8 corners for a box fully in front', () => {
        const result = projectCuboidCorners(cal, [0, 0, 10], [1, 1, 1], 0);
        expect(result.length).toBe(8);
        const visible = result.filter((c) => !c.behind);
        expect(visible.length).toBe(8);
    });

    it('marks all corners as behind for a box behind the camera', () => {
        const result = projectCuboidCorners(cal, [0, 0, -5], [1, 1, 1], 0);
        const behind = result.filter((c) => c.behind);
        expect(behind.length).toBe(8);
    });

    it('assigns corner index 0..7', () => {
        const result = projectCuboidCorners(cal, [0, 0, 10], [1, 1, 1], 0);
        const indices = result.map((c) => c.index).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('returns pixel coords for visible corners', () => {
        const result = projectCuboidCorners(cal, [0, 0, 10], [1, 1, 1], 0);
        for (const corner of result) {
            if (!corner.behind) {
                expect(typeof corner.x).toBe('number');
                expect(typeof corner.y).toBe('number');
            }
        }
    });

    it('rotation changes projected positions', () => {
        const r0 = projectCuboidCorners(cal, [0, 0, 10], [4, 1, 1], 0);
        const r90 = projectCuboidCorners(cal, [0, 0, 10], [4, 1, 1], Math.PI / 2);
        // At 0° the x-spread should be larger than at 90°
        const xSpread0 = Math.max(...r0.filter((c) => !c.behind).map((c) => c.x!)) -
                         Math.min(...r0.filter((c) => !c.behind).map((c) => c.x!));
        const xSpread90 = Math.max(...r90.filter((c) => !c.behind).map((c) => c.x!)) -
                          Math.min(...r90.filter((c) => !c.behind).map((c) => c.x!));
        expect(xSpread0).toBeGreaterThan(xSpread90);
    });
});
