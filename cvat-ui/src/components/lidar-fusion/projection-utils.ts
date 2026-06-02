// Copyright (C) CVAT.ai Corporation
// SPDX-License-Identifier: MIT

/**
 * Browser-side LiDAR → camera projection utilities.
 *
 * Ported from Xtreme1's pc-render/utils/index.ts and adapted to work
 * directly with the CVAT CameraCalibration format.
 *
 * All matrix operations use plain Float64Array / manual math for
 * maximum performance without pulling in a heavyweight 3D library.
 */

import { CameraCalibration, CuboidCornerProjection, ProjectedPoint } from './types';

// ---------------------------------------------------------------------------
// Matrix helpers (row-major internally)
// ---------------------------------------------------------------------------

/** Multiply two 4×4 matrices (row-major). */
function mat4Mul(A: Float64Array, B: Float64Array): Float64Array {
    const C = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
            C[r * 4 + c] = s;
        }
    }
    return C;
}

/** Invert a 4×4 matrix (row-major). Returns null if not invertible. */
function mat4Inv(m: Float64Array): Float64Array | null {
    const inv = new Float64Array(16);
    // Using cofactor expansion (standard 4×4 inverse formula)
    inv[0] =
        m[5] * m[10] * m[15] - m[5] * m[11] * m[14] -
        m[9] * m[6] * m[15] + m[9] * m[7] * m[14] +
        m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] =
        -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] +
        m[8] * m[6] * m[15] - m[8] * m[7] * m[14] -
        m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] =
        m[4] * m[9] * m[15] - m[4] * m[11] * m[13] -
        m[8] * m[5] * m[15] + m[8] * m[7] * m[13] +
        m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] =
        -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] +
        m[8] * m[5] * m[14] - m[8] * m[6] * m[13] -
        m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] =
        -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] +
        m[9] * m[2] * m[15] - m[9] * m[3] * m[14] -
        m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] =
        m[0] * m[10] * m[15] - m[0] * m[11] * m[14] -
        m[8] * m[2] * m[15] + m[8] * m[3] * m[14] +
        m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] =
        -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] +
        m[8] * m[1] * m[15] - m[8] * m[3] * m[13] -
        m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] =
        m[0] * m[9] * m[14] - m[0] * m[10] * m[13] -
        m[8] * m[1] * m[14] + m[8] * m[2] * m[13] +
        m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] =
        m[1] * m[6] * m[15] - m[1] * m[7] * m[14] -
        m[5] * m[2] * m[15] + m[5] * m[3] * m[14] +
        m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] =
        -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] +
        m[4] * m[2] * m[15] - m[4] * m[3] * m[14] -
        m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] =
        m[0] * m[5] * m[15] - m[0] * m[7] * m[13] -
        m[4] * m[1] * m[15] + m[4] * m[3] * m[13] +
        m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] =
        -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] +
        m[4] * m[1] * m[14] - m[4] * m[2] * m[13] -
        m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] =
        -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] +
        m[5] * m[2] * m[11] - m[5] * m[3] * m[10] -
        m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] =
        m[0] * m[6] * m[11] - m[0] * m[7] * m[10] -
        m[4] * m[2] * m[11] + m[4] * m[3] * m[10] +
        m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] =
        -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] +
        m[4] * m[1] * m[11] - m[4] * m[3] * m[9] -
        m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] =
        m[0] * m[5] * m[10] - m[0] * m[6] * m[9] -
        m[4] * m[1] * m[10] + m[4] * m[2] * m[9] +
        m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

    const det =
        m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (Math.abs(det) < 1e-10) return null;

    const invDet = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= invDet;
    return inv;
}

/** Apply a 4×4 row-major matrix to a 3D point [x,y,z] (w=1). */
function mat4TransformPoint(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
    const rx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const ry = m[4] * x + m[5] * y + m[6] * z + m[7];
    const rz = m[8] * x + m[9] * y + m[10] * z + m[11];
    const rw = m[12] * x + m[13] * y + m[14] * z + m[15];
    return [rx / rw, ry / rw, rz / rw];
}

// ---------------------------------------------------------------------------
// Projection matrix construction
// ---------------------------------------------------------------------------

/**
 * Build the combined view-projection matrix from a CameraCalibration.
 *
 * The result maps a LiDAR world point [X,Y,Z] to normalised camera
 * coordinates.  Call ``ndcToPixel`` afterwards to get pixel coordinates.
 *
 * Returns a row-major Float64Array(16).
 */
export function buildProjectionMatrix(cal: CameraCalibration): Float64Array {
    const { fx, fy, cx, cy } = cal.cameraInternal;
    const w = cal.width ?? 1920;
    const h = cal.height ?? 1080;

    // Intrinsic matrix (OpenGL-style, NDC output)
    // Ported from Xtreme1 createMatrixFromCameraInternal
    const near = 0.01;
    const far = 10000;
    const P = new Float64Array([
        (2 * fx) / w, 0, 1 - (2 * cx) / w, 0,
        0, (2 * fy) / h, (2 * cy) / h - 1, 0,
        0, 0, (near + far) / (near - far), (2 * far * near) / (near - far),
        0, 0, -1, 0,
    ]);

    // Extrinsic matrix
    const ext = cal.cameraExternal;
    let E: Float64Array;
    if (cal.rowMajor === false) {
        // Column-major → row-major transposition
        E = new Float64Array([
            ext[0],  ext[4],  ext[8],  ext[12],
            ext[1],  ext[5],  ext[9],  ext[13],
            ext[2],  ext[6],  ext[10], ext[14],
            ext[3],  ext[7],  ext[11], ext[15],
        ]);
    } else {
        E = new Float64Array(ext);
    }

    return mat4Mul(P, E);
}

// ---------------------------------------------------------------------------
// Public projection API
// ---------------------------------------------------------------------------

/**
 * Project a single LiDAR world point onto the camera image plane.
 *
 * @returns {ProjectedPoint | null}  null if the point is behind the camera.
 */
export function projectPoint(
    cal: CameraCalibration,
    projMatrix: Float64Array,
    worldX: number,
    worldY: number,
    worldZ: number,
): ProjectedPoint | null {
    const [nx, ny, nz] = mat4TransformPoint(projMatrix, worldX, worldY, worldZ);

    // nz encodes depth in the NDC clip space; behind-camera when w<0
    // For a standard projection matrix the depth check is on Zc before division.
    // We reconstruct Zc by re-applying only the extrinsic part.
    const ext = cal.cameraExternal;
    const Zc = (cal.rowMajor === false)
        ? ext[2] * worldX + ext[6] * worldY + ext[10] * worldZ + ext[14]
        : ext[8] * worldX + ext[9] * worldY + ext[10] * worldZ + ext[11];

    if (Zc <= 0) return null;

    const w = cal.width ?? 1920;
    const h = cal.height ?? 1080;

    const px = ((nx + 1) / 2) * w;
    const py = (-(ny - 1) / 2) * h;

    return { x: px, y: py, depth: Zc };
}

/**
 * Project an array of LiDAR points (Float32Array of XYZ triples) onto the
 * camera image plane.  Optimised for large point clouds.
 *
 * @param pointBuffer  Float32Array layout: [x0,y0,z0, x1,y1,z1, ...]
 * @param clipToImage  If true, points outside [0,w]×[0,h] are excluded.
 */
export function projectPointCloud(
    cal: CameraCalibration,
    pointBuffer: Float32Array | Float64Array,
    clipToImage = true,
): ProjectedPoint[] {
    const mat = buildProjectionMatrix(cal);
    const w = cal.width ?? 1920;
    const h = cal.height ?? 1080;

    // Extrinsic row for Zc calculation
    const ext = cal.cameraExternal;
    const isColMajor = cal.rowMajor === false;
    const e20 = isColMajor ? ext[2]  : ext[8];
    const e21 = isColMajor ? ext[6]  : ext[9];
    const e22 = isColMajor ? ext[10] : ext[10];
    const e23 = isColMajor ? ext[14] : ext[11];

    const results: ProjectedPoint[] = [];
    const n = Math.floor(pointBuffer.length / 3);

    for (let i = 0; i < n; i++) {
        const wx = pointBuffer[i * 3];
        const wy = pointBuffer[i * 3 + 1];
        const wz = pointBuffer[i * 3 + 2];

        // Fast Zc check before full projection
        const Zc = e20 * wx + e21 * wy + e22 * wz + e23;
        if (Zc <= 0) continue;

        const [nx, ny] = mat4TransformPoint(mat, wx, wy, wz);
        const px = ((nx + 1) / 2) * w;
        const py = (-(ny - 1) / 2) * h;

        if (clipToImage && (px < 0 || px >= w || py < 0 || py >= h)) continue;

        results.push({ x: px, y: py, depth: Zc });
    }

    return results;
}

/**
 * Project the 8 corners of a 3D cuboid onto the camera image plane.
 *
 * @param center      [cx, cy, cz] in LiDAR frame
 * @param dimensions  [w, h, d]
 * @param rotationZ   Yaw in radians
 */
export function projectCuboidCorners(
    cal: CameraCalibration,
    center: [number, number, number],
    dimensions: [number, number, number],
    rotationZ: number,
): CuboidCornerProjection[] {
    const [cx, cy, cz] = center;
    const [dw, dh, dd] = [dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2];

    // 8 corners in local (cuboid) space
    const localCorners: Array<[number, number, number]> = [
        [ dw,  dh,  dd], [ dw, -dh,  dd], [ dw, -dh, -dd], [ dw,  dh, -dd],
        [-dw,  dh,  dd], [-dw, -dh,  dd], [-dw, -dh, -dd], [-dw,  dh, -dd],
    ];

    // Rotate around Z then translate to world
    const cosZ = Math.cos(rotationZ);
    const sinZ = Math.sin(rotationZ);
    const mat = buildProjectionMatrix(cal);
    const w = cal.width ?? 1920;
    const h = cal.height ?? 1080;
    const ext = cal.cameraExternal;
    const isColMajor = cal.rowMajor === false;
    const e20 = isColMajor ? ext[2]  : ext[8];
    const e21 = isColMajor ? ext[6]  : ext[9];
    const e22 = isColMajor ? ext[10] : ext[10];
    const e23 = isColMajor ? ext[14] : ext[11];

    return localCorners.map(([lx, ly, lz], idx) => {
        // Apply yaw rotation
        const rx = cosZ * lx - sinZ * ly + cx;
        const ry = sinZ * lx + cosZ * ly + cy;
        const rz = lz + cz;

        const Zc = e20 * rx + e21 * ry + e22 * rz + e23;
        if (Zc <= 0) {
            return { x: null, y: null, depth: Zc, index: idx, behind: true };
        }

        const [nx, ny] = mat4TransformPoint(mat, rx, ry, rz);
        const px = ((nx + 1) / 2) * w;
        const py = (-(ny - 1) / 2) * h;

        return { x: px, y: py, depth: Zc, index: idx, behind: false };
    });
}
