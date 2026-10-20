// The 3D view's framing: Fit fills the part of the frame a dialog leaves clear, centred there.
import { describe, expect, it } from 'vitest';

import { clearLens, fitView } from '../public/js/viewer-camera.ts';

const P = new Float32Array([-4, 0, -2, 4, 10, 2, 0, 5, 0]), bounds = { min: [-4, 0, -2], max: [4, 10, 2] };

describe('clearLens', () => {
  it('is the whole frame with nothing over it', () => {
    expect(clearLens(null, 800, 40, 400, [9, 9, 9, 9])).toEqual([0, 0, 1, 1]);
  });
  it('gives the clear part centre (frame NDC) and share, clipped to the frame below the inset', () => {
    expect(clearLens({ x: 0, y: 0, w: 400, h: 440 }, 800, 40, 400, [0, 0, 0, 0])).toEqual([-0.5, 0, 0.5, 1]);
    expect(clearLens({ x: 0, y: 40, w: 800, h: 200 }, 800, 40, 400, [0, 0, 0, 0])).toEqual([0, 0.5, 1, 0.5]);
  });
});

describe('fitView', () => {
  it('aims at the rig middle and stands back further for a smaller share', () => {
    const fit = (sx: number, sy: number) => fitView(P, bounds, 0.6, 0.4, sx, sy, 28, 9, 50);
    expect(fit(1, 0.5).Target).toEqual([0, 5, 0]);
    expect(fit(1, 0.5).Distance! / fit(1, 1).Distance!).toBeCloseTo(2, 0);     // the rig is tall: its height limits
    expect(fit(0.1, 0.5).Distance!).toBeGreaterThan(fit(1, 0.5).Distance!);
  });
});
