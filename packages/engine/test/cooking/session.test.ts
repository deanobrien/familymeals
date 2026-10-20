import { describe, expect, it } from 'vitest';
import {
  cookSessionKey, cookedLabel, createTimer, parseCookSession, ratingLabel, serializeCookSession, startTimer, timeAgo,
} from '../../src/cooking/index';

const NOW = Date.parse('2026-10-21T12:00:00Z');

describe('cook session persistence', () => {
  const timer = startTimer(createTimer('s1-600', '10 min (step 2)', 600, 1), NOW);
  it('round-trips and resumes', () => {
    const raw = serializeCookSession({ step: 3, servings: 6, checked: ['a'], swaps: [{ lineId: 'l1', name: 'margarine', guidance: 'Swap 1:1.' }], timers: [timer] }, NOW);
    const s = parseCookSession(raw, NOW + 60_000)!;
    expect(s).toMatchObject({ step: 3, servings: 6, checked: ['a'], swaps: [{ name: 'margarine' }], timers: [{ id: 's1-600', status: 'running', endsAt: NOW + 600_000 }] });
    expect(cookSessionKey('h', 'u', 'r')).toBe('fr.cook.h.u.r');
  });
  it('drops stale, malformed and hand-edited data safely', () => {
    const raw = serializeCookSession({ step: 1, servings: 2, checked: [], swaps: [], timers: [] }, NOW);
    expect(parseCookSession(raw, NOW + 25 * 3600_000)).toBeNull();
    expect(parseCookSession('not json', NOW)).toBeNull();
    expect(parseCookSession(null, NOW)).toBeNull();
    expect(parseCookSession(JSON.stringify({ v: 2 }), NOW)).toBeNull();
    expect(parseCookSession(JSON.stringify({ v: 1, step: -1, servings: 2, savedAt: NOW }), NOW)).toBeNull();
    const dirty = JSON.stringify({
      v: 1, step: 2, servings: 4, savedAt: NOW, checked: ['ok', 7, ''], swaps: [{ lineId: 'x' }, 'bad'],
      timers: [
        { id: 't', label: 'l', totalSeconds: 0, remainingSeconds: 1, stepIndex: 0, status: 'idle' },
        { id: 'r', label: 'l', totalSeconds: 60, remainingSeconds: 60, stepIndex: 0, status: 'running' },
      ],
    });
    expect(parseCookSession(dirty, NOW)).toMatchObject({ step: 2, checked: ['ok'], swaps: [], timers: [] });
  });
});

describe('display helpers', () => {
  it('describes how long ago and how often', () => {
    expect(timeAgo('2026-10-21T01:00:00Z', NOW)).toBe('today');
    expect(timeAgo('2026-10-20T01:00:00Z', NOW)).toBe('yesterday');
    expect(timeAgo('2026-10-11T12:00:00Z', NOW)).toBe('10 days ago');
    expect(timeAgo('2026-09-01T12:00:00Z', NOW)).toBe('7 weeks ago');
    expect(timeAgo(null, NOW)).toBe('');
    expect(cookedLabel({ cookedCount: 3, lastCookedAt: '2026-10-19T12:00:00Z' }, NOW)).toBe('Cooked 3 times, last 2 days ago');
    expect(cookedLabel({ cookedCount: 1, lastCookedAt: '2026-10-20T12:00:00Z' }, NOW)).toBe('Cooked once, yesterday');
    expect(cookedLabel(null, NOW)).toBe('Not cooked yet');
    expect(ratingLabel(4.5)).toBe('4.5/5');
    expect(ratingLabel(null)).toBe('');
  });
});
