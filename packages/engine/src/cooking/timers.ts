/**
 * Cook-mode timers: detect durations in step text ("simmer for 20 minutes", "10-12 mins", "1 hour 30 minutes") and a
 * tiny pure state machine (start / pause / reset) shared by the web and Android cook modes. No I/O, no clocks: callers
 * pass `now` (epoch ms), so the same logic is testable and survives a screen sleeping (the end time is absolute).
 */

export interface DetectedTimer {
  /** Short label for the button, e.g. "20 min" or "10-12 min". */
  label: string;
  /** Duration to run. For a range this is the LOWER bound (check at the earliest time). */
  seconds: number;
  /** Upper bound of a range, when written as one. */
  maxSeconds?: number;
  /** The words in the step that produced it. */
  text: string;
  start: number;
  end: number;
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60 };
const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

const UNIT = '(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)';
const NUM = '(?:\\d+(?:[.,]\\d+)?\\s*[½¼¾⅓⅔]?|[½¼¾⅓⅔]|\\d+\\s*\\/\\s*\\d+|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|sixty))';
const RANGE_SEP = '(?:\\s*(?:-|–|—|to|or)\\s*)';
// "half an hour" | "[N]( - [M]) unit( [P] unit)"
const PATTERN = new RegExp(
  `\\bhalf an hour\\b|\\b(${NUM})(?:${RANGE_SEP}(${NUM}))?\\s*-?\\s*${UNIT}\\b(?:\\s*(?:and\\s*)?(${NUM})\\s*${UNIT}\\b)?`,
  'gi',
);

function toNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(',', '.');
  if (s === '') return null;
  if (s in WORD_NUMBERS) return WORD_NUMBERS[s]!;
  const frac = /^(\d+)?\s*([½¼¾⅓⅔])$/.exec(s);
  if (frac) return Number(frac[1] ?? 0) + FRACTIONS[frac[2]!]!;
  const slash = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (slash) return Number(slash[2]) === 0 ? null : Number(slash[1]) / Number(slash[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function unitSeconds(u: string): number {
  const c = u.toLowerCase();
  if (c.startsWith('h')) return 3600;
  if (c.startsWith('s')) return 1;
  return 60;
}

export const MAX_TIMER_SECONDS = 24 * 3600;

/** "20 min", "1 h 30 min", "45 sec". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (sec && !h) parts.push(`${sec} sec`);
  return parts.join(' ') || '0 sec';
}

/** Durations written in a method step, in reading order. Anything implausible (0, > 24 h) is ignored. */
export function parseStepTimers(text: string): DetectedTimer[] {
  const out: DetectedTimer[] = [];
  PATTERN.lastIndex = 0;
  for (let m = PATTERN.exec(text); m; m = PATTERN.exec(text)) {
    const matched = m[0];
    if (/^half an hour$/i.test(matched)) {
      out.push({ label: '30 min', seconds: 1800, text: matched, start: m.index, end: m.index + matched.length });
      continue;
    }
    const unit = m[3];
    if (!unit) continue;
    // A bare "m"/"s"/"h" unit is only trusted next to a number written in digits ("20m").
    if (/^[msh]$/i.test(unit) && !/\d/.test(m[1] ?? '')) continue;
    const per = unitSeconds(unit);
    const lo = toNumber(m[1] ?? '');
    const hi = m[2] ? toNumber(m[2]) : null;
    if (lo === null) continue;
    let seconds = lo * per;
    let maxSeconds: number | undefined;
    if (hi !== null && hi > lo) maxSeconds = hi * per;
    if (m[4] && m[5]) {
      // "1 hour 30 minutes": the second part is added to the first.
      const extra = toNumber(m[4]);
      if (extra !== null) seconds += extra * unitSeconds(m[5]);
    }
    seconds = Math.round(seconds);
    if (seconds <= 0 || seconds > MAX_TIMER_SECONDS) continue;
    const label = maxSeconds ? `${Math.round(seconds / per)}-${formatDuration(maxSeconds)}` : formatDuration(seconds);
    out.push({ label, seconds, ...(maxSeconds ? { maxSeconds: Math.round(maxSeconds) } : {}), text: matched, start: m.index, end: m.index + matched.length });
  }
  return out;
}

// ---- state machine ----

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface CookTimer {
  id: string;
  label: string;
  /** Step index (0-based) it was detected on, for the "from step N" hint. */
  stepIndex: number;
  totalSeconds: number;
  status: TimerStatus;
  /** Epoch ms the timer ends, while running. */
  endsAt: number | null;
  /** Seconds left, while idle / paused. */
  remainingSeconds: number;
  /** True once the end has been announced (notification, sound), so it fires once. */
  alerted: boolean;
}

export function createTimer(id: string, label: string, totalSeconds: number, stepIndex = 0): CookTimer {
  const t = Math.max(1, Math.min(MAX_TIMER_SECONDS, Math.round(totalSeconds)));
  return { id, label, stepIndex, totalSeconds: t, status: 'idle', endsAt: null, remainingSeconds: t, alerted: false };
}

/** Seconds left at `now` (rounded up so "0:01" shows until it is really done). */
export function secondsLeft(t: CookTimer, now: number): number {
  if (t.status === 'running' && t.endsAt !== null) return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
  if (t.status === 'done') return 0;
  return t.remainingSeconds;
}

export function startTimer(t: CookTimer, now: number): CookTimer {
  if (t.status === 'running') return t;
  const left = t.status === 'done' ? t.totalSeconds : t.remainingSeconds;
  return { ...t, status: 'running', endsAt: now + left * 1000, remainingSeconds: left, alerted: false };
}

export function pauseTimer(t: CookTimer, now: number): CookTimer {
  if (t.status !== 'running') return t;
  return { ...t, status: 'paused', endsAt: null, remainingSeconds: Math.max(1, secondsLeft(t, now)) };
}

export function resetTimer(t: CookTimer): CookTimer {
  return { ...t, status: 'idle', endsAt: null, remainingSeconds: t.totalSeconds, alerted: false };
}

/** Moves running timers whose time has come to `done`; returns the new list and the ones that JUST finished. */
export function tickTimers(timers: CookTimer[], now: number): { timers: CookTimer[]; finished: CookTimer[] } {
  const finished: CookTimer[] = [];
  const next = timers.map((t) => {
    if (t.status === 'running' && t.endsAt !== null && now >= t.endsAt) {
      const d: CookTimer = { ...t, status: 'done', endsAt: null, remainingSeconds: 0, alerted: true };
      finished.push(d);
      return d;
    }
    return t;
  });
  return { timers: finished.length ? next : timers, finished };
}

/** "m:ss" / "h:mm:ss". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
