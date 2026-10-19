import { describe, expect, it } from 'vitest';
import { needsDownscale, rotatedDimensions, targetDimensions } from './downscale';

describe('targetDimensions', () => {
  it('shrinks the long edge to the cap, keeping aspect ratio', () => {
    expect(targetDimensions(4800, 3600, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(targetDimensions(3000, 6000, 2400)).toEqual({ width: 1200, height: 2400 });
  });
  it('never upscales', () => {
    expect(targetDimensions(800, 600, 2400)).toEqual({ width: 800, height: 600 });
  });
  it('never returns a zero edge', () => {
    expect(targetDimensions(100000, 10, 2400).height).toBe(1);
  });
});

describe('rotatedDimensions', () => {
  it('swaps axes on odd quarter turns only', () => {
    expect(rotatedDimensions(400, 300, 1)).toEqual({ width: 300, height: 400 });
    expect(rotatedDimensions(400, 300, 2)).toEqual({ width: 400, height: 300 });
    expect(rotatedDimensions(400, 300, -1)).toEqual({ width: 300, height: 400 });
    expect(rotatedDimensions(400, 300, 4)).toEqual({ width: 400, height: 300 });
  });
});

describe('needsDownscale', () => {
  it('skips small in-bounds files', () => expect(needsDownscale(500_000, 1600, 1200)).toBe(false));
  it('re-encodes big files, oversized dimensions and rotations', () => {
    expect(needsDownscale(5_000_000, 1600, 1200)).toBe(true);
    expect(needsDownscale(500_000, 4000, 3000)).toBe(true);
    expect(needsDownscale(500_000, 1600, 1200, 1)).toBe(true);
  });
});
