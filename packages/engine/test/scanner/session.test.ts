import { describe, expect, it } from 'vitest';
import {
  buildPhoneLink, createApplied, createRateLimiter, formatCountdown, isToken, parsePhoneLink, secondsLeft, sessionState,
  type ScannerItem,
} from '../../src/scanner';

const ID = '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

describe('phone link', () => {
  it('round-trips, keeping the token in the fragment', () => {
    const link = buildPhoneLink('https://app.example.test/', ID, TOKEN);
    expect(link).toBe(`https://app.example.test/scan/phone?s=${ID}#t=${TOKEN}`);
    expect(new URL(link).search).not.toContain(TOKEN); // never in the part a server sees
    expect(parsePhoneLink(link)).toEqual({ origin: 'https://app.example.test', sessionId: ID, token: TOKEN });
  });

  it('only accepts the exact shape', () => {
    const ok = buildPhoneLink('https://app.example.test', ID, TOKEN);
    expect(parsePhoneLink(' ' + ok + ' ')).not.toBeNull();
    for (const bad of [
      '', 'not a url', 'javascript:alert(1)', 'ftp://app.example.test/scan/phone?s=' + ID + '#t=' + TOKEN,
      `http://app.example.test/scan/phone?s=${ID}#t=${TOKEN}`, // plain http only for localhost
      `https://user:pw@app.example.test/scan/phone?s=${ID}#t=${TOKEN}`,
      `https://app.example.test/scan/other?s=${ID}#t=${TOKEN}`,
      `https://app.example.test/scan/phone?s=nope#t=${TOKEN}`,
      `https://app.example.test/scan/phone?s=${ID}#t=short`,
      `https://app.example.test/scan/phone?s=${ID}`, // token missing
      `https://app.example.test/scan/phone?s=${ID}&t=${TOKEN}`, // token in the query is not accepted
    ]) expect(parsePhoneLink(bad), bad).toBeNull();
    expect(parsePhoneLink(`http://localhost:3100/scan/phone?s=${ID}#t=${TOKEN}`)?.origin).toBe('http://localhost:3100');
  });

  it('the app can pin the server: a QR for another site is refused', () => {
    const link = buildPhoneLink('https://evil.example.test', ID, TOKEN);
    expect(parsePhoneLink(link, { allowedOrigin: 'https://app.example.test' })).toBeNull();
    expect(parsePhoneLink(link, { allowedOrigin: 'https://evil.example.test/some/path' })).not.toBeNull();
    expect(parsePhoneLink(link, { allowedOrigin: 'garbage' })).toBeNull();
  });

  it('token and id validators', () => {
    expect(isToken(TOKEN)).toBe(true);
    expect(isToken('x'.repeat(19))).toBe(false);
    expect(isToken('x'.repeat(129))).toBe(false);
    expect(isToken('has space has space has space')).toBe(false);
  });
});

describe('session state and countdown', () => {
  const exp = '2026-10-21T10:10:00Z';
  const now = Date.parse('2026-10-21T10:00:00Z');
  it('derives the state', () => {
    expect(sessionState({ expiresAt: exp, connected: false }, now)).toBe('waiting');
    expect(sessionState({ expiresAt: exp, connected: true }, now)).toBe('connected');
    expect(sessionState({ expiresAt: exp, connected: true }, Date.parse(exp))).toBe('expired');
    expect(sessionState({ expiresAt: exp, connected: true, revokedAt: '2026-10-21T10:01:00Z' }, now)).toBe('revoked');
  });
  it('formats time left', () => {
    expect(secondsLeft(exp, now)).toBe(600);
    expect(secondsLeft(exp, now + 700_000)).toBe(0);
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(65)).toBe('1:05');
  });
});

describe('createApplied', () => {
  const item = (seq: number, id = `i${seq}`): ScannerItem => ({ id, seq, kind: 'barcode', barcode: '5000157024671', count: 1 });
  it('hands out each item once, in seq order, and remembers the highest seq', () => {
    const a = createApplied();
    const first = a.fresh([item(2), item(1)]);
    expect(first.map((i) => i.seq)).toEqual([1, 2]);
    first.forEach((i) => a.done(i));
    expect(a.lastSeq()).toBe(2);
    expect(a.fresh([item(1), item(2), item(3)]).map((i) => i.seq)).toEqual([3]); // a repeated poll re-sends 1 and 2
    a.reset();
    expect(a.fresh([item(1)]).length).toBe(1);
    expect(a.lastSeq()).toBe(0);
  });
});

describe('rate limiter', () => {
  it('allows `limit` hits per window per key and recovers', () => {
    const l = createRateLimiter(3, 1000);
    expect([0, 100, 200, 300].map((t) => l.hit('ip', t))).toEqual([true, true, true, false]);
    expect(l.hit('other', 300)).toBe(true);
    expect(l.hit('ip', 1150)).toBe(true); // the first hit left the window
    l.sweep(5000);
    expect(l.hit('ip', 5000)).toBe(true);
  });
});
