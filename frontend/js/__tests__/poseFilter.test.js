import { describe, it, expect } from 'vitest';
import { quatFromMatrix, normalizeQuat, angularDistance, selectIppeSolution, ALPHA_HYSTERESIS, quatAverage } from '../poseFilter.js';

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// 90° rotation around Z
const ROT_Z_90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
// 180° rotation around Z
const ROT_Z_180 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];

describe('quatFromMatrix', () => {
  it('returns identity quaternion for identity matrix', () => {
    const q = quatFromMatrix(IDENTITY);
    expect(q.w).toBeCloseTo(1, 6);
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(0, 6);
  });

  it('round-trips a 90° Z rotation', () => {
    const q = normalizeQuat(quatFromMatrix(ROT_Z_90));
    // 90° around Z → w = cos(45°), z = sin(45°)
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.abs(q.z)).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('angularDistance', () => {
  it('is 0 for identical rotations', () => {
    expect(angularDistance(IDENTITY, IDENTITY)).toBeCloseTo(0, 6);
  });

  it('is π/2 for a 90° rotation', () => {
    expect(angularDistance(IDENTITY, ROT_Z_90)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('is π for a 180° rotation', () => {
    expect(angularDistance(IDENTITY, ROT_Z_180)).toBeCloseTo(Math.PI, 5);
  });

  it('is symmetric', () => {
    expect(angularDistance(ROT_Z_90, IDENTITY)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('selectIppeSolution', () => {
  const R_A = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];                       // identity
  const R_B = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];                      // 90° Z
  const T = [0, 0, 0.30];

  it('picks lowest reprojection error when no previous pose', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 1.2 },
      { R: R_B, t: T, errPx: 0.5 },
    ];
    const chosen = selectIppeSolution(solutions, null);
    expect(chosen).toBe(solutions[1]);
  });

  it('prefers solution closer to previous rotation when errors are similar', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 1.0 },
      { R: R_B, t: T, errPx: 1.1 }, // marginally worse but rotated 90°
    ];
    const prev = { R: R_A };
    const chosen = selectIppeSolution(solutions, prev);
    // R_A is 0 rad from prev; R_B is π/2 rad → cost adds ~π/2 ≈ 1.57 px at α=1
    expect(chosen).toBe(solutions[0]);
  });

  it('still flips when reprojection error is decisively better', () => {
    const solutions = [
      { R: R_A, t: T, errPx: 5.0 }, // much worse
      { R: R_B, t: T, errPx: 0.3 },
    ];
    const prev = { R: R_A };
    const chosen = selectIppeSolution(solutions, prev);
    expect(chosen).toBe(solutions[1]);
  });

  it('exposes the tunable alpha as a constant', () => {
    expect(typeof ALPHA_HYSTERESIS).toBe('number');
    expect(ALPHA_HYSTERESIS).toBeGreaterThan(0);
  });
});

describe('quatAverage (Markley)', () => {
  it('returns the only quat when given a single sample', () => {
    const q = { w: 1, x: 0, y: 0, z: 0 };
    const avg = quatAverage([q]);
    expect(avg.w).toBeCloseTo(1, 6);
  });

  it('returns identity when averaging a quat and its negation', () => {
    // q and -q represent the same rotation; mean should equal that rotation.
    const q = { w: 0.7071, x: 0, y: 0, z: 0.7071 };
    const negQ = { w: -q.w, x: -q.x, y: -q.y, z: -q.z };
    const avg = quatAverage([q, negQ]);
    // Should equal q (up to sign convention)
    const dot = Math.abs(avg.w * q.w + avg.x * q.x + avg.y * q.y + avg.z * q.z);
    expect(dot).toBeCloseTo(1, 4);
  });

  it('averages a small cluster around identity to near-identity', () => {
    // 30 tiny perturbations of identity; mean should be ≈ identity.
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push(normalizeQuat({
        w: 1,
        x: (Math.random() - 0.5) * 0.01,
        y: (Math.random() - 0.5) * 0.01,
        z: (Math.random() - 0.5) * 0.01,
      }));
    }
    const avg = quatAverage(samples);
    expect(avg.w).toBeGreaterThan(0.999);
  });
});

import { StillDetector, STILL_VELOCITY_PX, STILL_FRAMES_REQUIRED, POSE_BUFFER_SIZE } from '../poseFilter.js';

describe('StillDetector', () => {
  const T = [0, 0, 0.3];
  const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const pose = { R, t: T };

  it('starts in motion state', () => {
    const d = new StillDetector();
    const out = d.update(pose, { x: 100, y: 100 });
    expect(out.isStill).toBe(false);
    expect(out.pose).toEqual(pose);
  });

  it('transitions to still after STILL_FRAMES_REQUIRED stable frames', () => {
    const d = new StillDetector();
    d.update(pose, { x: 100, y: 100 });
    for (let i = 0; i < STILL_FRAMES_REQUIRED; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    const out = d.update(pose, { x: 100.5, y: 100.5 });
    expect(out.isStill).toBe(true);
  });

  it('resets to motion when velocity exceeds threshold', () => {
    const d = new StillDetector();
    for (let i = 0; i < STILL_FRAMES_REQUIRED + 2; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    const out = d.update(pose, { x: 200, y: 200 }); // big jump
    expect(out.isStill).toBe(false);
  });

  it('caps buffer at POSE_BUFFER_SIZE', () => {
    const d = new StillDetector();
    for (let i = 0; i < POSE_BUFFER_SIZE + 10; i++) {
      d.update(pose, { x: 100, y: 100 });
    }
    expect(d.bufferLength()).toBeLessThanOrEqual(POSE_BUFFER_SIZE);
  });

  it('exposes tunable constants', () => {
    expect(STILL_VELOCITY_PX).toBeGreaterThan(0);
    expect(STILL_FRAMES_REQUIRED).toBeGreaterThan(0);
    expect(POSE_BUFFER_SIZE).toBeGreaterThan(0);
  });
});

import { PoseSmoother, POSE_TRANS_SMOOTHING, POSE_ROT_SMOOTHING } from '../poseFilter.js';

describe('PoseSmoother', () => {
  const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  it('outputs the first pose unchanged', () => {
    const s = new PoseSmoother();
    const out = s.update({ R, t: [1, 2, 3] });
    expect(out.t).toEqual([1, 2, 3]);
  });

  it('lerps translation toward target', () => {
    const s = new PoseSmoother();
    s.update({ R, t: [0, 0, 0] });
    const out = s.update({ R, t: [10, 0, 0] });
    // After one EMA step: prev + (target - prev) * α
    expect(out.t[0]).toBeCloseTo(POSE_TRANS_SMOOTHING * 10, 5);
  });

  it('reset() clears smoothing state', () => {
    const s = new PoseSmoother();
    s.update({ R, t: [5, 5, 5] });
    s.reset();
    const out = s.update({ R, t: [10, 10, 10] });
    expect(out.t).toEqual([10, 10, 10]);
  });

  it('exposes tunable constants', () => {
    expect(POSE_TRANS_SMOOTHING).toBeGreaterThan(0);
    expect(POSE_TRANS_SMOOTHING).toBeLessThanOrEqual(1);
    expect(POSE_ROT_SMOOTHING).toBeGreaterThan(0);
    expect(POSE_ROT_SMOOTHING).toBeLessThanOrEqual(1);
  });
});
