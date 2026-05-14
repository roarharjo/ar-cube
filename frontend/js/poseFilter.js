/**
 * Pure-function pose pipeline helpers.
 *
 * Quaternions are stored as { w, x, y, z } plain objects so the module is
 * usable in workers and unit tests without pulling in Three.js.
 */

export function quatFromMatrix(R) {
  // Shepperd's method: numerically stable conversion from rotation matrix.
  const m00 = R[0][0], m01 = R[0][1], m02 = R[0][2];
  const m10 = R[1][0], m11 = R[1][1], m12 = R[1][2];
  const m20 = R[2][0], m21 = R[2][1], m22 = R[2][2];

  const trace = m00 + m11 + m22;
  let w, x, y, z;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return normalizeQuat({ w, x, y, z });
}

export function normalizeQuat(q) {
  const n = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (n === 0) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/**
 * Geodesic angular distance between two rotations (radians, range [0, π]).
 * Accepts either rotation matrices (3×3 arrays) or quaternions.
 */
export function angularDistance(A, B) {
  const qa = isQuat(A) ? normalizeQuat(A) : quatFromMatrix(A);
  const qb = isQuat(B) ? normalizeQuat(B) : quatFromMatrix(B);
  let dot = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
  // Quaternions q and -q represent the same rotation; take absolute dot.
  dot = Math.min(1, Math.max(-1, Math.abs(dot)));
  return 2 * Math.acos(dot);
}

function isQuat(x) {
  return x && typeof x === 'object' && 'w' in x;
}

export const ALPHA_HYSTERESIS = 1.0; // px-reproj equivalent per radian

/**
 * Choose between IPPE's two planar-ambiguity solutions.
 *
 * solutions: Array<{ R: 3x3, t: [x,y,z], errPx: number }>
 * prev: { R: 3x3 } | null   — previous filtered rotation, or null on first frame
 *
 * Without a previous pose, picks lowest reprojection error.
 * Otherwise, adds α × angular_distance(R, prev.R) to each error and picks min.
 */
export function selectIppeSolution(solutions, prev) {
  if (!solutions || solutions.length === 0) return null;
  if (solutions.length === 1) return solutions[0];

  if (!prev || !prev.R) {
    return solutions.reduce((best, s) => (s.errPx < best.errPx ? s : best));
  }

  let bestScore = Infinity;
  let best = solutions[0];
  for (const s of solutions) {
    const ang = angularDistance(prev.R, s.R);
    const score = s.errPx + ALPHA_HYSTERESIS * ang;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/**
 * Markley quaternion average: the eigenvector corresponding to the largest
 * eigenvalue of M = Σ qᵢqᵢᵀ. Robust for clustered rotations.
 */
export function quatAverage(quats) {
  if (!quats || quats.length === 0) return { w: 1, x: 0, y: 0, z: 0 };
  if (quats.length === 1) return normalizeQuat(quats[0]);

  // Build 4×4 symmetric M = Σ qᵢ ⊗ qᵢ
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const q of quats) {
    const v = [q.w, q.x, q.y, q.z];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) M[i][j] += v[i] * v[j];
    }
  }

  // Power iteration: dominant eigenvector of M.
  let v = [1, 0, 0, 0];
  for (let iter = 0; iter < 64; iter++) {
    const next = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) next[i] += M[i][j] * v[j];
    }
    const norm = Math.sqrt(next[0] ** 2 + next[1] ** 2 + next[2] ** 2 + next[3] ** 2);
    if (norm === 0) break;
    for (let i = 0; i < 4; i++) next[i] /= norm;
    // Check convergence
    let diff = 0;
    for (let i = 0; i < 4; i++) diff += Math.abs(next[i] - v[i]);
    v = next;
    if (diff < 1e-9) break;
  }

  return normalizeQuat({ w: v[0], x: v[1], y: v[2], z: v[3] });
}

export const STILL_VELOCITY_PX = 2.0;
export const STILL_FRAMES_REQUIRED = 10;
export const POSE_BUFFER_SIZE = 30;

/**
 * Detects when the centroid velocity stays below STILL_VELOCITY_PX for
 * STILL_FRAMES_REQUIRED consecutive frames. Once still, accumulates poses
 * in a ring buffer and outputs the Markley-averaged pose.
 */
export class StillDetector {
  constructor() {
    this._prevCentroid = null;
    this._lowVelocityFrames = 0;
    this._buffer = []; // { R, t, q }  — q cached for averaging
  }

  bufferLength() {
    return this._buffer.length;
  }

  update(pose, centroid) {
    const velocity = this._prevCentroid
      ? Math.hypot(centroid.x - this._prevCentroid.x, centroid.y - this._prevCentroid.y)
      : Infinity;
    this._prevCentroid = { ...centroid };

    if (velocity < STILL_VELOCITY_PX) {
      this._lowVelocityFrames++;
    } else {
      this._lowVelocityFrames = 0;
      this._buffer.length = 0;
    }

    const isStill = this._lowVelocityFrames >= STILL_FRAMES_REQUIRED;

    if (isStill) {
      const q = quatFromMatrix(pose.R);
      this._buffer.push({ R: pose.R, t: pose.t, q });
      if (this._buffer.length > POSE_BUFFER_SIZE) this._buffer.shift();

      const avgQ = quatAverage(this._buffer.map(b => b.q));
      const avgT = [0, 0, 0];
      for (const b of this._buffer) {
        avgT[0] += b.t[0]; avgT[1] += b.t[1]; avgT[2] += b.t[2];
      }
      avgT[0] /= this._buffer.length;
      avgT[1] /= this._buffer.length;
      avgT[2] /= this._buffer.length;

      return {
        isStill: true,
        pose: { R: matrixFromQuat(avgQ), t: avgT, q: avgQ },
      };
    }

    return { isStill: false, pose };
  }
}

export function matrixFromQuat(q) {
  const { w, x, y, z } = normalizeQuat(q);
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    [1 - 2 * (yy + zz),   2 * (xy - wz),       2 * (xz + wy)],
    [2 * (xy + wz),       1 - 2 * (xx + zz),   2 * (yz - wx)],
    [2 * (xz - wy),       2 * (yz + wx),       1 - 2 * (xx + yy)],
  ];
}

export const POSE_TRANS_SMOOTHING = 0.50;
export const POSE_ROT_SMOOTHING = 0.40;

function slerpQuat(a, b, t) {
  // Take shortest path
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bb = b;
  if (dot < 0) {
    bb = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Linear interpolation for close orientations
    return normalizeQuat({
      w: a.w + (bb.w - a.w) * t,
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
    });
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const wA = Math.sin((1 - t) * theta) / sinTheta;
  const wB = Math.sin(t * theta) / sinTheta;
  return normalizeQuat({
    w: a.w * wA + bb.w * wB,
    x: a.x * wA + bb.x * wB,
    y: a.y * wA + bb.y * wB,
    z: a.z * wA + bb.z * wB,
  });
}

export class PoseSmoother {
  constructor() { this.reset(); }

  reset() {
    this._t = null;
    this._q = null;
  }

  update(pose) {
    const targetQ = pose.q || quatFromMatrix(pose.R);
    if (this._t === null) {
      this._t = [...pose.t];
      this._q = { ...targetQ };
      return { R: matrixFromQuat(this._q), t: [...this._t], q: this._q };
    }
    this._t = [
      this._t[0] + (pose.t[0] - this._t[0]) * POSE_TRANS_SMOOTHING,
      this._t[1] + (pose.t[1] - this._t[1]) * POSE_TRANS_SMOOTHING,
      this._t[2] + (pose.t[2] - this._t[2]) * POSE_TRANS_SMOOTHING,
    ];
    this._q = slerpQuat(this._q, targetQ, POSE_ROT_SMOOTHING);
    return { R: matrixFromQuat(this._q), t: [...this._t], q: this._q };
  }
}
