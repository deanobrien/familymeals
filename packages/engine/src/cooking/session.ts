/**
 * A cook-mode session saved on the device so cooking can resume where it left off (web localStorage, Android AsyncStorage).
 * Parsed defensively: storage can hold anything (old versions, hand edits), so every field is validated and a bad value
 * falls back to a safe default instead of throwing.
 */
import type { CookTimer } from './timers';

export interface CookSwap {
  /** The recipe line being replaced. */
  lineId: string;
  /** What to use instead (already vetted by the server against the household exclusions when it was suggested). */
  name: string;
  /** Quantity guidance from the suggestion ("Use about 3/4 of the amount."). */
  guidance: string;
}

export interface CookSession {
  v: 1;
  step: number;
  servings: number;
  /** Ingredient line ids ticked off. */
  checked: string[];
  swaps: CookSwap[];
  timers: CookTimer[];
  /** Epoch ms of the last save: a session untouched for a day is not resumed. */
  savedAt: number;
}

export const SESSION_MAX_AGE_MS = 24 * 3600 * 1000;

export function cookSessionKey(householdId: string, userId: string, recipeId: string): string {
  return `fr.cook.${householdId}.${userId}.${recipeId}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseCookSession(raw: string | null | undefined, now: number): CookSession | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1) return null;
  const savedAt = typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0;
  if (now - savedAt > SESSION_MAX_AGE_MS || savedAt - now > 3_600_000) return null;
  const step = int(v.step, 0, 500);
  const servings = int(v.servings, 1, 100);
  if (step === null || servings === null) return null;
  const checked = Array.isArray(v.checked) ? v.checked.map((c) => str(c, 64)).filter((c): c is string => c !== null).slice(0, 200) : [];
  const swaps: CookSwap[] = [];
  for (const s of Array.isArray(v.swaps) ? v.swaps.slice(0, 20) : []) {
    if (!isObj(s)) continue;
    const lineId = str(s.lineId, 64);
    const name = str(s.name, 80);
    if (lineId && name) swaps.push({ lineId, name, guidance: typeof s.guidance === 'string' ? s.guidance.slice(0, 200) : '' });
  }
  const timers: CookTimer[] = [];
  for (const t of Array.isArray(v.timers) ? v.timers.slice(0, 20) : []) {
    if (!isObj(t)) continue;
    const id = str(t.id, 64);
    const label = str(t.label, 80);
    const total = int(t.totalSeconds, 1, 86_400);
    const remaining = int(t.remainingSeconds, 0, 86_400);
    const idx = int(t.stepIndex, 0, 500);
    const status = t.status === 'idle' || t.status === 'running' || t.status === 'paused' || t.status === 'done' ? t.status : null;
    if (!id || !label || total === null || remaining === null || idx === null || !status) continue;
    const endsAt = typeof t.endsAt === 'number' && Number.isFinite(t.endsAt) ? t.endsAt : null;
    if (status === 'running' && endsAt === null) continue;
    timers.push({ id, label, stepIndex: idx, totalSeconds: total, status, endsAt: status === 'running' ? endsAt : null, remainingSeconds: remaining, alerted: t.alerted === true });
  }
  return { v: 1, step, servings, checked, swaps, timers, savedAt };
}

export function serializeCookSession(s: Omit<CookSession, 'v' | 'savedAt'>, now: number): string {
  const out: CookSession = { v: 1, ...s, savedAt: now };
  return JSON.stringify(out);
}
