// Screen wake lock and per-scan feedback (beep, vibration) for rapid barcode scanning (BS1, D270). Every browser API is
// optional and every call is guarded: no sound, no vibration (iOS Safari has none) or no wake lock never breaks scanning.

/** localStorage key of the "scan sound" setting (Settings page and the scanner's own toggle share it; 'off' = silent, default on). */
export const SCAN_SOUND_KEY = 'fr.rapidscan.sound';

interface WakeLockSentinelLike { release(): Promise<void>; addEventListener?(type: 'release', cb: () => void): void }
interface NavigatorLike { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> }; vibrate?: (p: number | number[]) => boolean }
interface DocumentLike { visibilityState?: string; addEventListener(type: 'visibilitychange', cb: () => void): void; removeEventListener(type: 'visibilitychange', cb: () => void): void }

export interface ScreenWake {
  /** Ask for the lock; resolves true when held. */
  acquire(): Promise<boolean>;
  release(): void;
}

/** Keep the screen awake while scanning. The browser drops the lock when the tab is hidden, so re-acquire on return. */
export function createScreenWake(
  nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as NavigatorLike),
  doc: DocumentLike | undefined = typeof document === 'undefined' ? undefined : (document as unknown as DocumentLike),
): ScreenWake {
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  const take = async (): Promise<boolean> => {
    if (!nav?.wakeLock) return false;
    try { sentinel = await nav.wakeLock.request('screen'); return true; } catch { sentinel = null; return false; }
  };
  const onVisible = () => { if (wanted && doc?.visibilityState === 'visible') void take(); };
  return {
    async acquire() {
      wanted = true;
      doc?.addEventListener('visibilitychange', onVisible);
      return take();
    },
    release() {
      wanted = false;
      doc?.removeEventListener('visibilitychange', onVisible);
      const s = sentinel;
      sentinel = null;
      void s?.release().catch(() => undefined);
    },
  };
}

interface AudioContextLike {
  state?: string;
  currentTime: number;
  destination: unknown;
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
  createOscillator(): { type: string; frequency: { value: number }; connect(n: unknown): void; start(t: number): void; stop(t: number): void };
  createGain(): { gain: { value: number; setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void };
}

export interface ScanFeedback {
  /** Call from a user gesture (the Start button): browsers only allow audio after one. */
  unlock(): void;
  /** A scan was counted: short beep (if enabled) and a short buzz. */
  scanned(opts: { sound: boolean; vibrate: boolean }): void;
  close(): void;
}

export function createScanFeedback(
  win: object | undefined = typeof window === 'undefined' ? undefined : window,
  nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : (navigator as unknown as NavigatorLike),
): ScanFeedback {
  let ctx: AudioContextLike | null = null;
  const Ctor = (win as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike } | undefined);
  const make = Ctor?.AudioContext ?? Ctor?.webkitAudioContext;
  return {
    unlock() {
      if (!make) return;
      try {
        ctx ??= new make();
        void ctx.resume?.();
      } catch { ctx = null; }
    },
    scanned({ sound, vibrate }) {
      if (vibrate) { try { nav?.vibrate?.(40); } catch { /* not allowed: ignore */ } }
      if (!sound || !ctx) return;
      try {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 1046;
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.13);
      } catch { /* ignore */ }
    },
    close() {
      const c = ctx;
      ctx = null;
      void c?.close?.().catch(() => undefined);
    },
  };
}
