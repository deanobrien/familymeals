// Rear camera for continuous barcode scanning (BS1, D270): getUserMedia with progressive enhancement. Torch and tap-to-focus
// are only offered where the track reports the capability (Android Chrome mostly; iOS Safari exposes neither), and every
// advanced constraint is best effort: a failure never stops scanning.

export interface CameraCapabilities {
  torch: boolean;
  /** The camera accepts a focus point (tap to focus). */
  tapFocus: boolean;
  continuousFocus: boolean;
}

export interface CameraSession {
  stream: MediaStream;
  caps: CameraCapabilities;
  setTorch(on: boolean): Promise<boolean>;
  /** x, y in 0..1 of the video frame. */
  focusAt(x: number, y: number): Promise<boolean>;
  stop(): void;
}

type Caps = { torch?: boolean; focusMode?: string[]; pointsOfInterest?: unknown } & Record<string, unknown>;
type TrackLike = Pick<MediaStreamTrack, 'applyConstraints' | 'stop'> & { getCapabilities?: () => Caps };

export function readCapabilities(track: Pick<TrackLike, 'getCapabilities'>): CameraCapabilities {
  let c: Caps = {};
  try { c = track.getCapabilities?.() ?? {}; } catch { c = {}; }
  const modes = Array.isArray(c.focusMode) ? c.focusMode : [];
  return {
    torch: c.torch === true,
    tapFocus: modes.includes('single-shot') && c.pointsOfInterest !== undefined,
    continuousFocus: modes.includes('continuous'),
  };
}

export type CameraErrorKind = 'denied' | 'no-camera' | 'in-use' | 'insecure' | 'unsupported' | 'other';

export function classifyCameraError(e: unknown, secure: boolean = typeof window === 'undefined' ? true : window.isSecureContext): CameraErrorKind {
  const name = (e as { name?: string } | null)?.name;
  if (!secure) return 'insecure';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'in-use';
  return 'other';
}

export const CAMERA_MESSAGES: Record<CameraErrorKind, string> = {
  denied: 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again. You can still type barcodes.',
  'no-camera': 'No camera was found on this device. You can still type barcodes.',
  'in-use': 'The camera is busy (another app or tab is using it). Close it and try again.',
  insecure: 'The camera only works on a secure (https) page.',
  unsupported: 'This browser cannot open the camera. You can still type barcodes.',
  other: 'The camera could not be opened. Check permissions and try again, or type the barcodes.',
};

export async function openRearCamera(devices: Pick<MediaDevices, 'getUserMedia'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices): Promise<CameraSession> {
  if (!devices?.getUserMedia) throw Object.assign(new Error('unsupported'), { kind: 'unsupported' satisfies CameraErrorKind });
  const stream = await devices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0] as unknown as TrackLike | undefined;
  if (!track) { stream.getTracks().forEach((t) => t.stop()); throw Object.assign(new Error('no camera'), { name: 'NotFoundError' }); }
  const caps = readCapabilities(track);
  const apply = async (advanced: Record<string, unknown>): Promise<boolean> => {
    try { await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints); return true; } catch { return false; }
  };
  if (caps.continuousFocus) void apply({ focusMode: 'continuous' });
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    stream,
    caps,
    setTorch: (on) => (caps.torch ? apply({ torch: on }) : Promise.resolve(false)),
    async focusAt(x, y) {
      if (!caps.tapFocus) return false;
      const ok = await apply({ focusMode: 'single-shot', pointsOfInterest: [{ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }] });
      if (ok && caps.continuousFocus) { clearTimeout(focusTimer); focusTimer = setTimeout(() => void apply({ focusMode: 'continuous' }), 1800); }
      return ok;
    },
    stop() {
      clearTimeout(focusTimer);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
