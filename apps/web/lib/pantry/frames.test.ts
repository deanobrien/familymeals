import { describe, expect, it } from 'vitest';
import {
  CANDIDATES_PER_WINDOW, MAX_VIDEO_FRAMES, MIN_VIDEO_FRAMES, chooseFrameCount, laplacianVariance, pickSharpest, planFrameTimes,
  sharpnessOfRgba, toGrayscale,
} from './frames';

const W = 32;
const H = 32;

/** RGBA checkerboard (very sharp edges). */
function checker(cell: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 255 : 0;
    const i = (y * W + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  return px;
}
const flat = (v: number): Uint8ClampedArray => new Uint8ClampedArray(W * H * 4).fill(v);

/** Box blur on RGBA (radius r), a stand-in for a motion-blurred / out-of-focus frame. */
function blur(src: Uint8ClampedArray, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let sum = 0; let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx; const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      sum += src[(yy * W + xx) * 4 + c]!; n++;
    }
    out[(y * W + x) * 4 + c] = sum / n;
  }
  return out;
}

describe('frame sharpness (variance of Laplacian)', () => {
  it('converts RGBA to luma', () => {
    const g = toGrayscale(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1);
    expect([...g]).toEqual([255, 0, 76]);
  });

  it('a flat frame scores zero and a sharp frame scores far higher', () => {
    expect(sharpnessOfRgba(flat(128), W, H)).toBe(0);
    expect(sharpnessOfRgba(checker(2), W, H)).toBeGreaterThan(1000);
  });

  it('blurring lowers the score, more blur lowers it further', () => {
    const sharp = checker(4);
    const a = sharpnessOfRgba(sharp, W, H);
    const b = sharpnessOfRgba(blur(sharp, 1), W, H);
    const c = sharpnessOfRgba(blur(sharp, 3), W, H);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('is zero for images too small to have an interior', () => {
    expect(laplacianVariance(new Uint8ClampedArray(4), 2, 2)).toBe(0);
  });

  it('picks the sharpest candidate (first wins a tie) and handles an empty list', () => {
    const cands = [
      { id: 'blurred', score: sharpnessOfRgba(blur(checker(4), 2), W, H) },
      { id: 'sharp', score: sharpnessOfRgba(checker(4), W, H) },
      { id: 'flat', score: sharpnessOfRgba(flat(10), W, H) },
    ];
    expect(pickSharpest(cands)?.id).toBe('sharp');
    expect(pickSharpest([{ id: 'a', score: 1 }, { id: 'b', score: 1 }])?.id).toBe('a');
    expect(pickSharpest([])).toBeUndefined();
  });
});

describe('frame timing', () => {
  it('keeps 6 to 10 frames depending on clip length', () => {
    expect(chooseFrameCount(1)).toBe(MIN_VIDEO_FRAMES);
    expect(chooseFrameCount(0)).toBe(MIN_VIDEO_FRAMES);
    expect(chooseFrameCount(Number.POSITIVE_INFINITY)).toBe(MIN_VIDEO_FRAMES);
    expect(chooseFrameCount(12)).toBe(8);
    expect(chooseFrameCount(60)).toBe(MAX_VIDEO_FRAMES);
  });

  it('spreads candidates over the whole clip, increasing, inside the clip and clear of the exact end', () => {
    const duration = 20;
    const windows = planFrameTimes(duration, 8);
    expect(windows).toHaveLength(8);
    expect(windows.every((w) => w.length === CANDIDATES_PER_WINDOW)).toBe(true);
    const flatTimes = windows.flat();
    expect([...flatTimes].sort((a, b) => a - b)).toEqual(flatTimes);
    expect(flatTimes[0]!).toBeGreaterThan(0);
    expect(flatTimes.at(-1)!).toBeLessThan(duration);
    // every window sits in its own slice of the clip: first window early, last window late
    expect(windows[0]![0]!).toBeLessThan(duration * 0.2);
    expect(windows.at(-1)!.at(-1)!).toBeGreaterThan(duration * 0.8);
    // no two windows overlap
    for (let i = 1; i < windows.length; i++) expect(windows[i]![0]!).toBeGreaterThan(windows[i - 1]!.at(-1)!);
  });

  it('returns nothing for an unusable duration', () => {
    expect(planFrameTimes(0, 8)).toEqual([]);
    expect(planFrameTimes(Number.NaN, 8)).toEqual([]);
    expect(planFrameTimes(10, 0)).toEqual([]);
  });
});
