// Continuous frame loop for rapid barcode scanning (BS1, D270). Each tick copies a centred, downscaled region of the video
// onto a small canvas and hands it to the decoder; the next tick is scheduled when the decode finishes (never overlapping),
// aiming at ~10 frames a second, and simply runs as fast as the phone allows when decoding is slower than that. Pure over
// small interfaces so it is unit-tested with a fake video, canvas and decoder.
import type { DecodedCode, FrameCanvas, FrameDecoder } from './decoder';

/** The part of the frame the decoder sees: centred, wide and not very tall (a barcode is a wide, flat target). */
export const ROI_WIDTH = 0.92;
export const ROI_HEIGHT = 0.5;
/** Decoded width cap: a retail barcode still has 4+ px per module at this size, and the decode stays cheap. */
export const MAX_DECODE_WIDTH = 640;
export const TARGET_FRAME_MS = 100;

export interface RoiRect { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }

/** Source crop (in video pixels) and destination size (the downscaled canvas) for a video of `vw` x `vh`. */
export function roiRect(vw: number, vh: number): RoiRect {
  const sw = Math.max(1, Math.round(vw * ROI_WIDTH));
  const sh = Math.max(1, Math.round(vh * ROI_HEIGHT));
  const sx = Math.round((vw - sw) / 2);
  const sy = Math.round((vh - sh) / 2);
  const scale = Math.min(1, MAX_DECODE_WIDTH / sw);
  return { sx, sy, sw, sh, dw: Math.max(1, Math.round(sw * scale)), dh: Math.max(1, Math.round(sh * scale)) };
}

export interface VideoLike {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}

export interface DrawCanvas extends FrameCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): (ReturnType<FrameCanvas['getContext']> & { drawImage(...args: unknown[]): void }) | null;
}

export interface FrameLoopOptions {
  video: VideoLike;
  canvas: DrawCanvas;
  decoder: FrameDecoder;
  onCodes: (codes: DecodedCode[], at: number) => void;
  /** While true frames are skipped (paused / lookups showing). */
  isPaused?: () => boolean;
  onError?: (e: unknown) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  targetMs?: number;
}

/** Start the loop; returns stop(). */
export function startFrameLoop(o: FrameLoopOptions): () => void {
  const now = o.now ?? (() => performance.now());
  const schedule = o.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const target = o.targetMs ?? TARGET_FRAME_MS;
  let stopped = false;
  let handle: unknown;

  const tick = async () => {
    if (stopped) return;
    const t0 = now();
    const v = o.video;
    if (!(o.isPaused?.() ?? false) && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
      try {
        const r = roiRect(v.videoWidth, v.videoHeight);
        if (o.canvas.width !== r.dw) o.canvas.width = r.dw;
        if (o.canvas.height !== r.dh) o.canvas.height = r.dh;
        const ctx = o.canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
          const codes = await o.decoder.decode(o.canvas);
          if (!stopped && codes.length > 0) o.onCodes(codes, now());
        }
      } catch (e) {
        o.onError?.(e);
      }
    }
    if (!stopped) handle = schedule(() => void tick(), Math.max(0, target - (now() - t0)));
  };
  handle = schedule(() => void tick(), 0);
  return () => {
    stopped = true;
    cancel(handle);
  };
}
