import { describe, expect, it } from 'vitest';
import { PhoneSender, type PhoneCred, type PhoneTransport, type PushBody, type SenderResult } from '../../src/scanner';

type Failure = Extract<SenderResult<object>, { ok: false }>;

const CRED: PhoneCred = { sessionId: '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f', token: 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE', device: 'device-one-0123456789' };
const fail = (code: Failure['code']): Failure => ({ ok: false, code, message: code });

function fake(script: Array<'ok' | Failure['code']> = []) {
  const pushed: PushBody[] = [];
  let i = 0;
  const transport: PhoneTransport = {
    connect: async () => ({ ok: true, purpose: 'pantry', expiresAt: '2026-10-21T10:10:00Z', itemCount: 0 }),
    push: async (_c, p) => {
      const step = script[i++] ?? 'ok';
      if (step !== 'ok') return fail(step);
      const dup = pushed.some((x) => x.clientId === p.clientId);
      pushed.push(p);
      return { ok: true, duplicate: dup, itemCount: pushed.length };
    },
  };
  let n = 0;
  return { transport, pushed, sender: (t = transport) => new PhoneSender(CRED, t, () => undefined, () => `client-${String(++n).padStart(6, '0')}`) };
}

describe('PhoneSender', () => {
  it('connects, sends in order and reports what was sent', async () => {
    const f = fake();
    const s = f.sender();
    expect(await s.connect()).toBe(true);
    expect(s.state.status).toBe('ready');
    s.sendBarcode('5000157024671');
    s.sendBarcode('96385074', 2);
    s.sendPhoto('aGVsbG8=', 'image/jpeg');
    await s.flush();
    expect(f.pushed.map((p) => p.kind)).toEqual(['barcode', 'barcode', 'photo']);
    expect(s.state.sent).toBe(3);
    expect(s.state.queued).toBe(0);
    expect(s.state.recent.map((r) => r.state)).toEqual(['sent', 'sent', 'sent']);
  });

  it('keeps a scan through a network blip and resends it with the SAME id (idempotent)', async () => {
    const f = fake(['unavailable', 'ok']);
    const s = f.sender();
    await s.connect();
    s.sendBarcode('5000157024671');
    await s.flush(); // first attempt failed in the background
    expect(s.state.queued).toBe(1);
    expect(s.state.recent[0]!.state).toBe('waiting');
    await s.flush();
    expect(s.state.queued).toBe(0);
    expect(f.pushed).toHaveLength(1);
    expect(s.state.sent).toBe(1);
  });

  it('rate limiting also waits and retries rather than dropping', async () => {
    const f = fake(['rate_limited']);
    const s = f.sender();
    await s.connect();
    s.sendBarcode('5000157024671');
    await s.flush();
    expect(s.state.queued).toBe(1);
    await s.flush();
    expect(s.state.queued).toBe(0);
  });

  it('a fatal error (session ended, expired, taken by another phone) stops everything with a clear message', async () => {
    for (const code of ['revoked', 'expired', 'scanner_in_use', 'invalid'] as const) {
      const f = fake([code]);
      const s = f.sender();
      await s.connect();
      s.sendBarcode('5000157024671');
      s.sendBarcode('96385074');
      await s.flush();
      expect(s.state.status).toBe('stopped');
      expect(s.state.message).toBeTruthy();
      expect(s.state.queued).toBe(0);
      s.sendBarcode('5000157024671'); // ignored once stopped
      expect(s.state.queued).toBe(0);
    }
  });

  it('a photo the server refuses is dropped with a message but scanning carries on', async () => {
    const f = fake(['photo_too_large', 'ok']);
    const s = f.sender();
    await s.connect();
    s.sendPhoto('aGVsbG8=', 'image/jpeg');
    s.sendBarcode('5000157024671');
    await s.flush();
    expect(s.state.status).toBe('ready');
    expect(s.state.recent.find((r) => r.label === 'Photo')?.state).toBe('failed');
    expect(s.state.message).toContain('too big');
    expect(f.pushed.map((p) => p.kind)).toEqual(['barcode']);
  });

  it('connect failures explain themselves', async () => {
    const t: PhoneTransport = { connect: async () => fail('expired'), push: async () => fail('expired') };
    const s = new PhoneSender(CRED, t);
    expect(await s.connect()).toBe(false);
    expect(s.state.status).toBe('stopped');
    expect(s.state.message).toContain('10 minutes');
    const t2: PhoneTransport = { connect: async () => fail('unavailable'), push: async () => fail('unavailable') };
    const s2 = new PhoneSender(CRED, t2);
    await s2.connect();
    expect(s2.state.message).toContain('Could not reach the server');
  });
});
