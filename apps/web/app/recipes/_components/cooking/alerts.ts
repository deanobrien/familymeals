'use client';

/**
 * Cook-mode alerts for a finished timer: a short beep (Web Audio), vibration where the device has it, and a system
 * notification when the browser has permission. Every call is best effort: none of them may throw into the UI, and the
 * in-page alert banner (rendered by cook mode itself) is the one that always works.
 */

type AudioWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

/** Create (or resume) the audio context from a user gesture, so a beep is allowed later when a timer ends. */
export function primeAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio */
  }
}

export function beep(times = 3): void {
  try {
    primeAudio();
    if (!ctx) return;
    const c = ctx;
    for (let i = 0; i < times; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      const t0 = c.currentTime + i * 0.45;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.32);
    }
  } catch {
    /* no audio */
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* no vibration */
  }
}

export type NotifyState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyState(): NotifyState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Ask once, from a click (a timer being started). Resolves to the resulting state. */
export async function requestNotifyPermission(): Promise<NotifyState> {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission;
  } catch {
    return notifyState();
  }
}

export function showTimerNotification(label: string, recipeTitle: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(`${label} timer done`, { body: recipeTitle, tag: `cook-timer-${label}`, requireInteraction: false });
  } catch {
    /* some mobile browsers only allow notifications through a service worker */
  }
}

/** Screen Wake Lock: keep the screen on while cooking. Returns a release function; `supported` false when unavailable. */
export async function keepScreenAwake(): Promise<{ supported: boolean; release: () => void }> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> } };
  if (!nav.wakeLock) return { supported: false, release: () => undefined };
  let lock: Awaited<ReturnType<NonNullable<typeof nav.wakeLock>['request']>> | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      if (!stopped) lock = await nav.wakeLock!.request('screen');
    } catch {
      /* refused (battery saver, hidden tab): try again when the tab is visible */
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!lock || (lock as { released?: boolean }).released)) void acquire();
  };
  document.addEventListener('visibilitychange', onVisible);
  await acquire();
  return {
    supported: true,
    release: () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    },
  };
}

/** Web Speech: read text aloud. Returns false when the browser has no speech synthesis. */
export function speak(text: string): boolean {
  try {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = document.documentElement.lang || 'en-GB';
    u.rate = 0.95;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

export const speechSupported = (): boolean => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
