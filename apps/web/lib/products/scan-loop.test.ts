import { describe, expect, it, vi } from 'vitest';
import { CAMERA_MESSAGES, classifyCameraError, openRearCamera, readCapabilities } from './camera';
import type { DecodedCode, FrameDecoder } from './decoder';
import { createScanFeedback, createScreenWake } from './scan-feedback';
import { MAX_DECODE_WIDTH, ROI_HEIGHT, ROI_WIDTH, roiRect, startFrameLoop, type DrawCanvas } from './scan-loop';

describe('roiRect', () => {
  it('crops a centred region and downscales wide frames to the decode cap', () => {
    const r = roiRect(1280, 720);
    expect(r.sw).toBe(Math.round(1280 * ROI_WIDTH));
    expect(r.sh).toBe(Math.round(720 * ROI_HEIGHT));
    expect(r.sx).toBe(Math.round((1280 - r.sw) / 2));
    expect(r.dw).toBe(MAX_DECODE_WIDTH);
    expect(r.dh).toBe(Math.round(r.sh * (MAX_DECODE_WIDTH / r.sw)));
  });
  it('never upscales a small frame and copes with a portrait phone stream', () => {
    const small = roiRect(320, 240);
    expect(small.dw).toBe(small.sw);
    const portrait = roiRect(720, 1280);
    expect(portrait.sw).toBe(Math.round(720 * ROI_WIDTH));
    expect(portrait.dw).toBeLessThanOrEqual(MAX_DECODE_WIDTH);
    expect(roiRect(0, 0)).toMatchObject({ sw: 1, sh: 1 });
  });
});

function fakes() {
  const timers: { fn: () => void; ms: number }[] = [];
  let t = 0;
  const draws: unknown[][] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...a: unknown[]) => { draws.push(a); }, getImageData: () => ({}) as ImageData }),
  } as unknown as DrawCanvas;
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
  return {
    timers, draws, canvas, video, advance: (ms: number) => { t += ms; },
    opts: {
      now: () => t,
      schedule: (fn: () => void, ms: number) => { const h = { fn, ms }; timers.push(h); return h; },
      cancel: (h: unknown) => { const i = timers.indexOf(h as { fn: () => void; ms: number }); if (i >= 0) timers.splice(i, 1); },
    },
    run: async () => { timers.shift()?.fn(); for (let i = 0; i < 5; i++) await Promise.resolve(); },
  };
}

describe('startFrameLoop', () => {
  it('draws the ROI downscaled, decodes, reports codes, and aims at ~10 fps', async () => {
    const f = fakes();
    const decoder: FrameDecoder = { kind: 'wasm', decode: vi.fn(async (): Promise<DecodedCode[]> => { f.advance(30); return [{ code: '5009000000015' }]; }), close() {} };
    const onCodes = vi.fn();
    const stop = startFrameLoop({ video: f.video, canvas: f.canvas, decoder, onCodes, ...f.opts });
    await f.run();
    expect(f.draws).toHaveLength(1);
    expect(f.canvas.width).toBe(MAX_DECODE_WIDTH);
    expect(onCodes).toHaveBeenCalledWith([{ code: '5009000000015' }], 30);
    expect(f.timers[0]!.ms).toBe(70); // 100 ms target minus the 30 ms the decode took
    stop();
    expect(f.timers).toHaveLength(0);
  });

  it('never overlaps decodes: the next tick is only scheduled after the decode resolves', async () => {
    const f = fakes();
    let release!: () => void;
    const decoder: FrameDecoder = { kind: 'wasm', decode: () => new Promise<DecodedCode[]>((r) => { release = () => r([]); }), close() {} };
    startFrameLoop({ video: f.video, canvas: f.canvas, decoder, onCodes: vi.fn(), ...f.opts });
    await f.run();
    expect(f.timers).toHaveLength(0); // still decoding
    release();
    await Promise.resolve(); await Promise.resolve();
    expect(f.timers).toHaveLength(1);
  });

  it('runs flat out (delay 0) when decoding is slower than the target', async () => {
    const f = fakes();
    const decoder: FrameDecoder = { kind: 'wasm', decode: async () => { f.advance(180); return []; }, close() {} };
    startFrameLoop({ video: f.video, canvas: f.canvas, decoder, onCodes: vi.fn(), ...f.opts });
    await f.run();
    expect(f.timers[0]!.ms).toBe(0);
  });

  it('skips frames while paused or before the video has data, and survives decoder errors', async () => {
    const f = fakes();
    let paused = true;
    const decode = vi.fn(async (): Promise<DecodedCode[]> => { throw new Error('boom'); });
    const onError = vi.fn();
    startFrameLoop({ video: f.video, canvas: f.canvas, decoder: { kind: 'wasm', decode, close() {} }, onCodes: vi.fn(), isPaused: () => paused, onError, ...f.opts });
    await f.run();
    expect(decode).not.toHaveBeenCalled();
    paused = false;
    f.video.readyState = 1;
    await f.run();
    expect(decode).not.toHaveBeenCalled();
    f.video.readyState = 4;
    await f.run();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(f.timers).toHaveLength(1); // the loop carried on
  });
});

describe('camera', () => {
  it('reads torch and tap-to-focus capabilities only when the track reports them', () => {
    expect(readCapabilities({ getCapabilities: () => ({ torch: true, focusMode: ['continuous', 'single-shot'], pointsOfInterest: {} }) }))
      .toEqual({ torch: true, tapFocus: true, continuousFocus: true });
    expect(readCapabilities({})).toEqual({ torch: false, tapFocus: false, continuousFocus: false }); // iOS Safari
    expect(readCapabilities({ getCapabilities: () => { throw new Error('x'); } }).torch).toBe(false);
  });

  it('classifies getUserMedia failures into messages the owner can act on', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' }, true)).toBe('denied');
    expect(classifyCameraError({ name: 'NotFoundError' }, true)).toBe('no-camera');
    expect(classifyCameraError({ name: 'NotReadableError' }, true)).toBe('in-use');
    expect(classifyCameraError({ name: 'NotAllowedError' }, false)).toBe('insecure');
    expect(classifyCameraError(new Error('?'), true)).toBe('other');
    expect(Object.values(CAMERA_MESSAGES).every((m) => m.length > 20)).toBe(true);
  });

  it('opens the rear camera, applies torch / focus best effort, and stops every track', async () => {
    const applied: unknown[] = [];
    const stopped = vi.fn();
    const track = {
      getCapabilities: () => ({ torch: true, focusMode: ['continuous', 'single-shot'], pointsOfInterest: {} }),
      applyConstraints: vi.fn(async (c: unknown) => { applied.push(c); }),
      stop: stopped,
    };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    const gum = vi.fn(async () => stream);
    const cam = await openRearCamera({ getUserMedia: gum });
    expect(gum).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.objectContaining({ facingMode: { ideal: 'environment' } }) }));
    expect(await cam.setTorch(true)).toBe(true);
    expect(await cam.focusAt(2, -1)).toBe(true); // clamped to 0..1
    expect(applied).toContainEqual({ advanced: [{ torch: true }] });
    expect(applied).toContainEqual({ advanced: [{ focusMode: 'single-shot', pointsOfInterest: [{ x: 1, y: 0 }] }] });
    cam.stop();
    expect(stopped).toHaveBeenCalled();
  });

  it('torch and focus are no-ops without the capability, and an unsupported browser is reported', async () => {
    const track = { getCapabilities: () => ({}), applyConstraints: vi.fn(), stop: vi.fn() };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    const cam = await openRearCamera({ getUserMedia: async () => stream });
    expect(await cam.setTorch(true)).toBe(false);
    expect(await cam.focusAt(0.5, 0.5)).toBe(false);
    expect(track.applyConstraints).not.toHaveBeenCalled();
    await expect(openRearCamera(undefined)).rejects.toMatchObject({ kind: 'unsupported' });
  });
});

describe('screen wake lock and feedback', () => {
  it('acquires the wake lock, re-acquires when the tab becomes visible again, and releases', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    let visible: () => void = () => undefined;
    const doc = { visibilityState: 'visible', addEventListener: (_: string, cb: () => void) => { visible = cb; }, removeEventListener: vi.fn() };
    const wake = createScreenWake({ wakeLock: { request } }, doc);
    expect(await wake.acquire()).toBe(true);
    visible();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    wake.release();
    expect(release).toHaveBeenCalled();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  it('is quiet when the Wake Lock API is missing or refuses', async () => {
    expect(await createScreenWake({}, undefined).acquire()).toBe(false);
    expect(await createScreenWake({ wakeLock: { request: async () => { throw new Error('denied'); } } }, undefined).acquire()).toBe(false);
  });

  it('beeps and vibrates on a counted scan, honours the toggles, and never throws without the APIs', () => {
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    class Ctx { currentTime = 0; destination = {}; resume = vi.fn(async () => undefined); close = vi.fn(async () => undefined); createOscillator = () => osc; createGain = () => gain; }
    const vibrate = vi.fn(() => true);
    const fb = createScanFeedback({ AudioContext: Ctx }, { vibrate });
    fb.scanned({ sound: true, vibrate: true }); // before unlock: no sound, still a buzz
    expect(osc.start).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledTimes(1);
    fb.unlock();
    fb.scanned({ sound: true, vibrate: false });
    expect(osc.start).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    fb.scanned({ sound: false, vibrate: false });
    expect(osc.start).toHaveBeenCalledTimes(1);
    fb.close();
    const none = createScanFeedback({}, {});
    none.unlock();
    expect(() => none.scanned({ sound: true, vibrate: true })).not.toThrow();
  });
});
