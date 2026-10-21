import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BASE_LOCK_MS, FREE_ATTEMPTS, MAX_LOCK_MS, OPEN_GATE, allVoted, attemptPin, checkCandidates, checkKidProfile, createPinRecord, hashPin, isRoundOpen,
  isValidPin, lockLabel, lockMsFor, parseGateState, parsePinRecord, roundOverlapsWeek, sha256Hex, softPreference, tallyVotes, winners,
  type GateState, type PinRecord, type VoteLike,
} from '../../src/kids';

const SALT = '0123456789abcdef0123456789abcdef';

describe('sha256Hex', () => {
  it('matches node crypto, including multi-block and non-ASCII input', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'café \u{1F98A}']) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('kid-mode PIN gate', () => {
  const record = createPinRecord('4821', SALT) as PinRecord;
  const t0 = 1_000_000;

  it('accepts only 4-6 digit PINs and a hex salt', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    for (const bad of ['123', '1234567', '12a4', '', ' 1234', 1234 as unknown as string]) expect(isValidPin(bad)).toBe(false);
    expect(createPinRecord('12', SALT)).toBeNull();
    expect(createPinRecord('1234', 'xyz')).toBeNull();
  });

  it('stores a salted hash, never the PIN', () => {
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toContain('4821');
    expect(createPinRecord('4821', 'f'.repeat(32))!.hash).not.toBe(record.hash);
    expect(hashPin('4821', SALT)).toBe(record.hash);
  });

  it('opens with the right PIN and resets the failure count', () => {
    const r = attemptPin(record, '4821', { failures: 2, lockedUntil: 0 }, t0);
    expect(r).toEqual({ ok: true, state: OPEN_GATE });
  });

  it('counts wrong guesses, then locks for longer each time', () => {
    let state: GateState = OPEN_GATE;
    let now = t0;
    for (let i = 1; i < FREE_ATTEMPTS; i++) {
      const r = attemptPin(record, '0000', state, now);
      expect(r).toMatchObject({ ok: false, reason: 'wrong', retryAfterMs: 0 });
      state = r.state;
    }
    const third = attemptPin(record, '0000', state, now);
    expect(third).toMatchObject({ ok: false, reason: 'wrong', retryAfterMs: BASE_LOCK_MS, attemptsLeft: 0 });
    state = third.state;
    expect(state.lockedUntil).toBe(now + BASE_LOCK_MS);

    // while locked, even the right PIN is refused and the lock is not extended
    const locked = attemptPin(record, '4821', state, now + 1000);
    expect(locked).toMatchObject({ ok: false, reason: 'locked', retryAfterMs: BASE_LOCK_MS - 1000 });
    expect(locked.state).toEqual(state);

    now += BASE_LOCK_MS + 1;
    const fourth = attemptPin(record, '1111', state, now);
    expect(fourth).toMatchObject({ ok: false, reason: 'wrong', retryAfterMs: BASE_LOCK_MS * 2 });
    // and the right PIN works again once the lock has run out
    expect(attemptPin(record, '4821', fourth.state, now + BASE_LOCK_MS * 2 + 1).ok).toBe(true);
  });

  it('caps the lock-out and treats malformed guesses as free', () => {
    expect(lockMsFor(0)).toBe(0);
    expect(lockMsFor(FREE_ATTEMPTS - 1)).toBe(0);
    expect(lockMsFor(FREE_ATTEMPTS)).toBe(BASE_LOCK_MS);
    expect(lockMsFor(50)).toBe(MAX_LOCK_MS);
    const r = attemptPin(record, 'abcd', { failures: 1, lockedUntil: 0 }, t0);
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
    expect(r.state).toEqual({ failures: 1, lockedUntil: 0 });
  });

  it('reads stored state defensively', () => {
    expect(parsePinRecord(record)).toEqual(record);
    expect(parsePinRecord({ salt: SALT, hash: 'short', iterations: 3000 })).toBeNull();
    expect(parsePinRecord({ salt: SALT, hash: record.hash, iterations: 1e9 })).toBeNull();
    expect(parsePinRecord(null)).toBeNull();
    expect(parseGateState({ failures: -3, lockedUntil: 'x' })).toEqual({ failures: 0, lockedUntil: 0 });
    expect(parseGateState(undefined)).toEqual(OPEN_GATE);
    expect(lockLabel(30_000)).toBe('30 seconds');
    expect(lockLabel(5 * 60_000)).toBe('5 minutes');
  });
});

describe('kid profiles and candidates', () => {
  it('accepts a name + emoji + colour and nothing personal', () => {
    expect(checkKidProfile({ displayName: '  Mia  ', avatar: '🦊', colour: 'blue' })).toEqual({ ok: true, value: { displayName: 'Mia', avatar: '🦊', colour: 'blue' } });
    for (const displayName of ['', 'a'.repeat(25), 'mia@example.com', 'https://x.test', 'Mia 07123456789']) {
      expect(checkKidProfile({ displayName, avatar: '🦊', colour: 'blue' }).ok).toBe(false);
    }
    expect(checkKidProfile({ displayName: 'Mia', avatar: 'photo.jpg', colour: 'blue' }).ok).toBe(false);
    expect(checkKidProfile({ displayName: 'Mia', avatar: '🦊', colour: '#ff0000' }).ok).toBe(false);
  });

  it('needs 3 to 6 different recipes', () => {
    expect(checkCandidates(['a', 'b'])).toMatchObject({ ok: false });
    expect(checkCandidates(['a', 'a', 'b'])).toMatchObject({ ok: false });
    expect(checkCandidates(['a', 'b', 'c'])).toEqual({ ok: true, ids: ['a', 'b', 'c'] });
    expect(checkCandidates(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toMatchObject({ ok: false });
    expect(checkCandidates('abc')).toMatchObject({ ok: false });
  });
});

describe('rounds and tally', () => {
  const kid = (id: string) => ({ kind: 'kid' as const, id });
  const mem = (id: string) => ({ kind: 'member' as const, id });
  const vote = (recipeId: string, voter: VoteLike['voter'], value: VoteLike['value']): VoteLike => ({ recipeId, voter, value });

  it('closes manually or at the closing time', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(isRoundOpen({ status: 'open' }, now)).toBe(true);
    expect(isRoundOpen({ status: 'closed' }, now)).toBe(false);
    expect(isRoundOpen({ status: 'open', closesAt: '2026-10-21T12:00:00Z' }, now)).toBe(false);
    expect(isRoundOpen({ status: 'open', closesAt: '2026-10-21T12:00:01Z' }, now)).toBe(true);
  });

  it('weights hearts double, replaces a changed vote and lists every voter', () => {
    const t = tallyVotes(['a', 'b', 'c'], [
      vote('a', kid('k1'), 'up'), vote('a', mem('u1'), 'heart'), vote('b', kid('k1'), 'heart'), vote('b', kid('k1'), 'up'), vote('zzz', kid('k1'), 'up'),
    ]);
    expect(t.map((r) => [r.recipeId, r.up, r.heart, r.score])).toEqual([['a', 1, 1, 3], ['b', 1, 0, 1], ['c', 0, 0, 0]]);
    expect(t[0]!.voters).toHaveLength(2);
    expect(winners(t)).toEqual(['a']);
    expect(softPreference(t)).toEqual(['a', 'b']);
  });

  it('has no winner or preference when nobody voted, and ties all win', () => {
    expect(winners(tallyVotes(['a', 'b', 'c'], []))).toEqual([]);
    expect(softPreference(tallyVotes(['a', 'b', 'c'], []))).toEqual([]);
    expect(winners(tallyVotes(['a', 'b'], [vote('a', kid('1'), 'up'), vote('b', kid('2'), 'up')]))).toEqual(['a', 'b']);
  });

  it('knows when everyone has voted on everything', () => {
    const votes = [vote('a', kid('1'), 'up'), vote('b', kid('1'), 'up')];
    expect(allVoted(['a', 'b'], votes, [kid('1')])).toBe(true);
    expect(allVoted(['a', 'b'], votes, [kid('1'), kid('2')])).toBe(false);
  });

  it('overlaps a round with a plan week', () => {
    expect(roundOverlapsWeek('2026-10-21', 1, '2026-10-19', 7)).toBe(true);
    expect(roundOverlapsWeek('2026-10-25', 7, '2026-10-19', 7)).toBe(true);
    expect(roundOverlapsWeek('2026-10-26', 1, '2026-10-19', 7)).toBe(false);
  });
});
