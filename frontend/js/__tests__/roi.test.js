import { describe, it, expect } from 'vitest';
import { bboxFromCorners, expandBbox, clampBbox, toFullFrameCorners } from '../roi.js';

describe('bboxFromCorners', () => {
  it('produces the tight bounding box of 4 corners', () => {
    const corners = [[10, 20], [40, 25], [42, 60], [8, 58]];
    expect(bboxFromCorners(corners)).toEqual({ x: 8, y: 20, w: 34, h: 40 });
  });
});

describe('expandBbox', () => {
  it('grows by factor relative to center', () => {
    const b = { x: 50, y: 50, w: 40, h: 20 };
    // factor=1.5 → new w = 60, h = 30, center stays at (70, 60)
    const e = expandBbox(b, 1.5);
    expect(e.w).toBe(60);
    expect(e.h).toBe(30);
    expect(e.x + e.w / 2).toBeCloseTo(70, 6);
    expect(e.y + e.h / 2).toBeCloseTo(60, 6);
  });
});

describe('clampBbox', () => {
  it('does nothing when inside frame', () => {
    expect(clampBbox({ x: 10, y: 10, w: 20, h: 20 }, 100, 100))
      .toEqual({ x: 10, y: 10, w: 20, h: 20 });
  });

  it('clamps when overflowing right/bottom', () => {
    expect(clampBbox({ x: 90, y: 90, w: 30, h: 30 }, 100, 100))
      .toEqual({ x: 70, y: 70, w: 30, h: 30 });
  });

  it('clamps when negative origin', () => {
    expect(clampBbox({ x: -5, y: -5, w: 30, h: 30 }, 100, 100))
      .toEqual({ x: 0, y: 0, w: 30, h: 30 });
  });

  it('shrinks bbox if larger than frame', () => {
    expect(clampBbox({ x: -10, y: -10, w: 200, h: 200 }, 100, 100))
      .toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('toFullFrameCorners', () => {
  it('adds bbox origin to ROI-local corners', () => {
    const bbox = { x: 50, y: 100, w: 80, h: 80 };
    const local = [[0, 0], [10, 5], [10, 15], [0, 15]];
    expect(toFullFrameCorners(local, bbox)).toEqual([
      [50, 100], [60, 105], [60, 115], [50, 115],
    ]);
  });
});
