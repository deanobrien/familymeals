// Browser-only: turn a recorded video into 6-10 sharp JPEG frames, entirely on the device (DECISIONS D82).
// The video itself is never uploaded; only the chosen frames are.
import { CANDIDATES_PER_WINDOW, chooseFrameCount, pickSharpest, planFrameTimes, sharpnessOfRgba } from './frames';

export interface ExtractedFrame {
  file: File;
  /** Where in the clip the frame came from. */
  time: number;
  /** Sharpness score (variance of Laplacian on a downscaled copy). */
  score: number;
}

export interface ExtractOptions {
  /** Override the frame count (default: by duration, 6..10). */
  frames?: number;
  /** Longest edge of the saved JPEG. */
  maxEdge?: number;
  quality?: number;
  /** Width of the downscaled copy used to score sharpness. */
  scoreWidth?: number;
  onProgress?: (done: number, total: number) => void;
}

function waitFor(el: HTMLVideoElement, event: 'loadedmetadata' | 'seeked' | 'durationchange', ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error(`video ${event} timed out`)); }, ms);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('video could not be read')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(event, ok); el.removeEventListener('error', bad); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

async function seek(el: HTMLVideoElement, time: number): Promise<void> {
  const done = waitFor(el, 'seeked');
  el.currentTime = time;
  await done;
}

/** MediaRecorder / some phones write webm/mp4 without a duration (Infinity): seeking far forces the browser to compute it. */
async function resolveDuration(el: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  const changed = waitFor(el, 'durationchange', 4000).catch(() => undefined);
  el.currentTime = 1e7;
  await changed;
  const d = el.duration;
  await seek(el, 0).catch(() => undefined);
  return Number.isFinite(d) ? d : 0;
}

const canvasBlob = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', quality));

export async function extractVideoFrames(file: File, opts: ExtractOptions = {}): Promise<ExtractedFrame[]> {
  const { maxEdge = 1280, quality = 0.85, scoreWidth = 160, onProgress } = opts;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await waitFor(video, 'loadedmetadata', 15000);
    const duration = await resolveDuration(video);
    if (!(duration > 0) || !video.videoWidth || !video.videoHeight) throw new Error('This video could not be read.');

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const sw = Math.max(8, Math.min(scoreWidth, w));
    const sh = Math.max(8, Math.round((h * sw) / w));

    const windows = planFrameTimes(duration, opts.frames ?? chooseFrameCount(duration), CANDIDATES_PER_WINDOW);
    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const wctx = work.getContext('2d', { willReadFrequently: false });
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!wctx || !sctx) throw new Error('canvas unavailable');

    const frames: ExtractedFrame[] = [];
    let done = 0;
    const total = windows.length;
    for (const times of windows) {
      // Keep only the best full-size canvas of this window, so memory stays at two canvases.
      const best = document.createElement('canvas');
      best.width = w; best.height = h;
      const scored: Array<{ score: number; time: number }> = [];
      let bestScore = -1;
      for (const t of times) {
        await seek(video, t);
        wctx.drawImage(video, 0, 0, w, h);
        sctx.drawImage(work, 0, 0, sw, sh);
        const score = sharpnessOfRgba(sctx.getImageData(0, 0, sw, sh).data, sw, sh);
        scored.push({ score, time: t });
        if (score > bestScore) {
          bestScore = score;
          best.getContext('2d')!.drawImage(work, 0, 0);
        }
      }
      const winner = pickSharpest(scored)!;
      const blob = await canvasBlob(best, quality);
      if (!blob) throw new Error('could not encode a video frame');
      frames.push({ file: new File([blob], `frame-${frames.length + 1}.jpg`, { type: 'image/jpeg' }), time: winner.time, score: winner.score });
      onProgress?.(++done, total);
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
