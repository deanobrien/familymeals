// Pure frame-selection maths for the video scan (DECISIONS D82). No DOM: pixel arrays in, numbers out,
// so it is unit-tested on synthetic data. The browser glue that seeks a <video> lives in video-frames.ts.

export const MIN_VIDEO_FRAMES = 6;
export const MAX_VIDEO_FRAMES = 10;
/** Candidate frames sampled inside each window; the sharpest one wins. */
export const CANDIDATES_PER_WINDOW = 3;

/** RGBA pixels -> 8-bit luma (Rec. 601). */
export function toGrayscale(rgba: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0);
  }
  return out;
}

/**
 * Variance of the Laplacian (4-neighbour kernel) over the interior pixels: the classic blur measure.
 * Higher = sharper. A flat image scores 0; blurring lowers the score.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = 4 * (gray[i] ?? 0) - (gray[i - 1] ?? 0) - (gray[i + 1] ?? 0) - (gray[i - width] ?? 0) - (gray[i + width] ?? 0);
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Sharpness of an RGBA buffer (grayscale + Laplacian variance). */
export function sharpnessOfRgba(rgba: ArrayLike<number>, width: number, height: number): number {
  return laplacianVariance(toGrayscale(rgba, width, height), width, height);
}

/** How many frames to keep for a clip of this length: about one per 1.5 seconds, clamped to 6..10. */
export function chooseFrameCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return MIN_VIDEO_FRAMES;
  return Math.min(MAX_VIDEO_FRAMES, Math.max(MIN_VIDEO_FRAMES, Math.round(durationSeconds / 1.5)));
}

/**
 * Split the clip into `windows` equal slices (skipping the first / last 3% where phones often wobble) and
 * sample `perWindow` evenly spaced candidate times inside each. The result is spread across the whole duration,
 * monotonically increasing, and never touches the exact end (seeking there can return no frame).
 */
export function planFrameTimes(durationSeconds: number, windows: number, perWindow = CANDIDATES_PER_WINDOW): number[][] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || windows < 1) return [];
  const margin = durationSeconds * 0.03;
  const span = Math.max(0, durationSeconds - 2 * margin);
  const per = Math.max(1, Math.floor(perWindow));
  const out: number[][] = [];
  for (let w = 0; w < windows; w++) {
    const start = margin + (span * w) / windows;
    const len = span / windows;
    const times: number[] = [];
    for (let c = 0; c < per; c++) times.push(Math.min(durationSeconds - 0.001, start + (len * (c + 0.5)) / per));
    out.push(times);
  }
  return out;
}

/** The candidate with the highest score (first one wins ties). */
export function pickSharpest<T extends { score: number }>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const c of candidates) if (!best || c.score > best.score) best = c;
  return best;
}
