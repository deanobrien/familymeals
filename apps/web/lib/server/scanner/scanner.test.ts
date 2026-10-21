// Phone-as-scanner (P3-C, D447-D449): the in-memory store (same rules as the SQL functions), the validation in front of it, expiry and
// rate limits with an injected clock, and the HTTP routes end to end in mock mode. The SQL side is packages/db/tests/rls/014_*.sql.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../auth/request-auth';
import { MemoryScannerStore, hashToken } from './store';
import { errorBody, newScannerToken, readCredentials, readPush, statusFor } from './service';

let outcome: AuthOutcome;
vi.mock('../auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const ALICE = { householdId: 'aa000000-0000-4000-8000-0000000000aa', userId: 'a0000000-0000-4000-8000-000000000001' };
const D1 = 'device-one-0123456789';
const D2 = 'device-two-0123456789';
const CODE = '5000157024671';
const photo = (n = 100) => ({ mime: 'image/jpeg' as const, bytes: Buffer.alloc(n, 7) });

function world() {
  let t = Date.parse('2026-10-21T10:00:00Z');
  let n = 0;
  const store = new MemoryScannerStore(() => t, () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
  const token = newScannerToken();
  return { store, token, advance: (ms: number) => { t += ms; } };
}
async function started(w = world(), ctx = ALICE) {
  const r = await w.store.create(ctx, 'pantry', hashToken(w.token));
  if (!r.ok) throw new Error(r.error);
  return { ...w, id: r.id };
}
const bc = (i: number, extra: object = {}) => ({ clientId: `client-${String(i).padStart(6, '0')}`, kind: 'barcode' as const, barcode: CODE, count: 1, ...extra });

describe('token', () => {
  it('is 256 random bits as 43 url-safe characters, and the store only ever sees the hash', () => {
    const a = newScannerToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newScannerToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('MemoryScannerStore: session lifecycle', () => {
  it('create -> connect -> push -> desktop reads the items in order', async () => {
    const s = await started();
    const c = await s.store.connect(s.id, s.token, D1);
    expect(c).toMatchObject({ ok: true, purpose: 'pantry', itemCount: 0 });
    expect(await s.store.push(s.id, s.token, D1, bc(1))).toMatchObject({ ok: true, duplicate: false, itemCount: 1 });
    expect(await s.store.push(s.id, s.token, D1, bc(2, { barcode: '96385074', count: 2 }))).toMatchObject({ ok: true, itemCount: 2 });
    const st = await s.store.status(ALICE, s.id, 0);
    expect(st.ok && st.session.state).toBe('connected');
    expect(st.ok && st.items.map((i) => [i.seq, i.barcode, i.count])).toEqual([[1, CODE, 1], [2, '96385074', 2]]);
    const later = await s.store.status(ALICE, s.id, 1);
    expect(later.ok && later.items.map((i) => i.seq)).toEqual([2]);
  });

  it('a retried push (same clientId) is acknowledged once, never doubled', async () => {
    const s = await started();
    await s.store.push(s.id, s.token, D1, bc(1));
    expect(await s.store.push(s.id, s.token, D1, bc(1))).toMatchObject({ ok: true, duplicate: true, itemCount: 1 });
    const st = await s.store.status(ALICE, s.id, 0);
    expect(st.ok && st.items).toHaveLength(1);
  });

  it('a session lives 10 minutes: after that nothing connects or pushes', async () => {
    const s = await started();
    expect((await s.store.connect(s.id, s.token, D1)).ok).toBe(true);
    s.advance(10 * 60_000 - 1);
    expect((await s.store.push(s.id, s.token, D1, bc(1))).ok).toBe(true);
    s.advance(2);
    expect(await s.store.push(s.id, s.token, D1, bc(2))).toEqual({ ok: false, error: 'expired' });
    expect(await s.store.connect(s.id, s.token, D1)).toEqual({ ok: false, error: 'expired' });
    const st = await s.store.status(ALICE, s.id, 0);
    expect(st.ok && st.session.state).toBe('expired');
  });

  it('only the first phone scans; release lets another take over', async () => {
    const s = await started();
    await s.store.connect(s.id, s.token, D1);
    expect(await s.store.push(s.id, s.token, D2, bc(1))).toEqual({ ok: false, error: 'scanner_in_use' });
    expect(await s.store.connect(s.id, s.token, D2)).toEqual({ ok: false, error: 'scanner_in_use' });
    expect((await s.store.release(ALICE, s.id)).ok).toBe(true);
    expect((await s.store.connect(s.id, s.token, D2)).ok).toBe(true);
    expect(await s.store.connect(s.id, s.token, D1)).toEqual({ ok: false, error: 'scanner_in_use' });
  });

  it('wrong id and wrong token look the same; ten wrong tokens revoke the session', async () => {
    const s = await started();
    expect(await s.store.connect('00000000-0000-4000-8000-0000000000ff', s.token, D1)).toEqual({ ok: false, error: 'invalid' });
    for (let i = 0; i < 10; i++) expect(await s.store.connect(s.id, `wrong-token-${i}-0123456789abcdef`, D1)).toEqual({ ok: false, error: 'invalid' });
    expect(await s.store.connect(s.id, s.token, D1)).toEqual({ ok: false, error: 'revoked' }); // even the right one now
  });

  it('revoke ends the session and deletes what was sent, photos included', async () => {
    const s = await started();
    await s.store.push(s.id, s.token, D1, bc(1));
    const p = await s.store.push(s.id, s.token, D1, { clientId: 'client-photo-1', kind: 'photo', photo: photo() });
    expect(p.ok).toBe(true);
    const before = await s.store.status(ALICE, s.id, 0);
    const photoItem = before.ok ? before.items.find((i) => i.kind === 'photo') : undefined;
    expect((await s.store.photo(ALICE, photoItem!.id)).ok).toBe(true);
    expect((await s.store.revoke(ALICE, s.id)).ok).toBe(true);
    const after = await s.store.status(ALICE, s.id, 0);
    expect(after.ok && after.items).toEqual([]);
    expect(after.ok && after.session.state).toBe('revoked');
    expect((await s.store.photo(ALICE, photoItem!.id)).ok).toBe(false);
    expect(await s.store.push(s.id, s.token, D1, bc(2))).toEqual({ ok: false, error: 'revoked' });
  });

  it("is bound to its creator: another user or household can neither read nor end it", async () => {
    const s = await started();
    await s.store.push(s.id, s.token, D1, { clientId: 'client-photo-1', kind: 'photo', photo: photo() });
    const bob = { householdId: ALICE.householdId, userId: 'b0000000-0000-4000-8000-000000000002' };
    const other = { householdId: 'cc000000-0000-4000-8000-0000000000cc', userId: ALICE.userId };
    for (const who of [bob, other]) {
      expect(await s.store.status(who, s.id, 0)).toEqual({ ok: false, error: 'not_found' });
      expect(await s.store.revoke(who, s.id)).toEqual({ ok: false, error: 'not_found' });
      expect(await s.store.release(who, s.id)).toEqual({ ok: false, error: 'not_found' });
    }
    const st = await s.store.status(ALICE, s.id, 0);
    const item = st.ok ? st.items[0]! : undefined;
    expect(await s.store.photo(bob, item!.id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('starting a new session revokes the earlier one (one scanner session at a time)', async () => {
    const w = world();
    const first = await started(w);
    const t2 = newScannerToken();
    const second = await w.store.create(ALICE, 'receipt', hashToken(t2));
    expect(second.ok).toBe(true);
    expect(await w.store.connect(first.id, w.token, D1)).toEqual({ ok: false, error: 'revoked' });
    expect((await w.store.connect((second as { id: string }).id, t2, D1)).ok).toBe(true);
  });

  it('limits session creation to 20 per user per hour', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) expect((await w.store.create(ALICE, 'pantry', hashToken(`t${i}`))).ok).toBe(true);
    expect(await w.store.create(ALICE, 'pantry', hashToken('one-more'))).toEqual({ ok: false, error: 'rate_limited' });
    w.advance(3_600_001);
    expect((await w.store.create(ALICE, 'pantry', hashToken('later'))).ok).toBe(true);
  });

  it('rejects a malformed hash or purpose', async () => {
    const w = world();
    expect(await w.store.create(ALICE, 'pantry', 'not-a-hash')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await w.store.create(ALICE, 'garden' as never, hashToken('x'))).toEqual({ ok: false, error: 'invalid_input' });
  });
});

describe('MemoryScannerStore: caps', () => {
  it('120 pushes a minute, then the window frees up', async () => {
    const s = await started();
    for (let i = 0; i < 120; i++) expect((await s.store.push(s.id, s.token, D1, bc(i))).ok).toBe(true);
    expect(await s.store.push(s.id, s.token, D1, bc(500))).toEqual({ ok: false, error: 'rate_limited' });
    s.advance(60_001);
    expect((await s.store.push(s.id, s.token, D1, bc(501))).ok).toBe(true);
  });

  it('300 items per session', async () => {
    const s = await started();
    for (let i = 0; i < 300; i++) {
      if (i % 100 === 0) s.advance(61_000);
      expect((await s.store.push(s.id, s.token, D1, bc(i))).ok).toBe(true);
    }
    s.advance(61_000);
    expect(await s.store.push(s.id, s.token, D1, bc(900))).toEqual({ ok: false, error: 'session_full' });
  });

  it('10 photos of at most 1.5 MB', async () => {
    const s = await started();
    expect(await s.store.push(s.id, s.token, D1, { clientId: 'client-big-0001', kind: 'photo', photo: photo(1_500_001) })).toEqual({ ok: false, error: 'photo_too_large' });
    for (let i = 0; i < 10; i++) expect((await s.store.push(s.id, s.token, D1, { clientId: `client-photo-${i}x`, kind: 'photo', photo: photo() })).ok).toBe(true);
    expect(await s.store.push(s.id, s.token, D1, { clientId: 'client-photo-11x', kind: 'photo', photo: photo() })).toEqual({ ok: false, error: 'too_many_photos' });
  });

  it('refuses bad barcodes, counts and image types', async () => {
    const s = await started();
    expect(await s.store.push(s.id, s.token, D1, bc(1, { barcode: '12345' }))).toEqual({ ok: false, error: 'invalid_input' });
    expect(await s.store.push(s.id, s.token, D1, bc(2, { count: 100 }))).toEqual({ ok: false, error: 'invalid_input' });
    expect(await s.store.push(s.id, s.token, D1, { clientId: 'client-pdf-0001', kind: 'photo', photo: { mime: 'application/pdf' as never, bytes: Buffer.from('x') } })).toEqual({ ok: false, error: 'invalid_input' });
  });
});

describe('request validation', () => {
  const ID = '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f';
  const T = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
  it('credentials: session id, token and device must all be well formed', () => {
    expect(readCredentials({ sessionId: ID, token: T, device: 'device-one-0123456789' })).toEqual({ sessionId: ID, token: T, device: 'device-one-0123456789' });
    for (const bad of [{ sessionId: 'x', token: T, device: D1 }, { sessionId: ID, token: 'short', device: D1 }, { sessionId: ID, token: T, device: 'tiny' }, { sessionId: ID, token: T, device: 'has spaces and more!!' }, {}]) expect(readCredentials(bad)).toBeNull();
  });

  it('barcode pushes are normalised and bounded', () => {
    expect(readPush({ clientId: 'client-000001', kind: 'barcode', barcode: '036000291452' })).toMatchObject({ ok: true, push: { barcode: '0036000291452' } }); // UPC-A becomes EAN-13
    expect(readPush({ clientId: 'client-000001', kind: 'barcode', barcode: CODE, count: 3 })).toMatchObject({ ok: true, push: { barcode: CODE, count: 3 } });
    expect(readPush({ clientId: 'client-000001', kind: 'barcode', barcode: '5000157024672' })).toEqual({ ok: false, error: 'invalid_input' }); // bad check digit
    expect(readPush({ clientId: 'client-000001', kind: 'barcode', barcode: CODE, count: 0 })).toEqual({ ok: false, error: 'invalid_input' });
    expect(readPush({ clientId: 'short', kind: 'barcode', barcode: CODE })).toEqual({ ok: false, error: 'invalid_input' });
    expect(readPush({ clientId: 'client-000001', kind: 'weird' })).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('photo pushes need base64 and an image type', () => {
    const ok = readPush({ clientId: 'client-000001', kind: 'photo', photo: Buffer.from('hello').toString('base64'), mime: 'image/png' });
    expect(ok.ok && ok.push.photo?.bytes.toString()).toBe('hello');
    expect(readPush({ clientId: 'client-000001', kind: 'photo', photo: '@@@', mime: 'image/png' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(readPush({ clientId: 'client-000001', kind: 'photo', photo: 'aGVsbG8=', mime: 'text/html' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(readPush({ clientId: 'client-000001', kind: 'photo', photo: 'A'.repeat(2_100_001), mime: 'image/png' })).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('errors map to statuses that do not reveal which check failed', () => {
    expect(['invalid', 'revoked', 'expired', 'scanner_in_use'].map((c) => statusFor(c as never))).toEqual([403, 403, 403, 403]);
    expect(statusFor('rate_limited')).toBe(429);
    expect(statusFor('photo_too_large')).toBe(413);
    expect(errorBody('expired').error.message).toContain('10 minutes');
  });
});

describe('HTTP routes (mock mode)', () => {
  const ID_RE = /^[0-9a-f-]{36}$/;
  let sessions: typeof import('../../../app/api/scanner/sessions/route');
  let one: typeof import('../../../app/api/scanner/sessions/[id]/route');
  let photos: typeof import('../../../app/api/scanner/sessions/[id]/photos/[itemId]/route');
  let connect: typeof import('../../../app/api/scanner/phone/connect/route');
  let push: typeof import('../../../app/api/scanner/phone/push/route');
  const json = (url: string, body: unknown, method = 'POST') => new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ip = (n: number) => ({ 'x-forwarded-for': `10.0.0.${n}` });

  beforeEach(async () => {
    sessions = await import('../../../app/api/scanner/sessions/route');
    one = await import('../../../app/api/scanner/sessions/[id]/route');
    photos = await import('../../../app/api/scanner/sessions/[id]/photos/[itemId]/route');
    connect = await import('../../../app/api/scanner/phone/connect/route');
    push = await import('../../../app/api/scanner/phone/push/route');
    const { memoryScannerStore } = await import('./store');
    memoryScannerStore().reset();
    outcome = { ok: true, auth: { userId: ALICE.userId, householdId: ALICE.householdId, readOnly: false, dataContext: null, defaultServings: 4 } };
  });

  async function start(purpose = 'pantry') {
    const res = await sessions.POST(json('http://t/api/scanner/sessions', { purpose }));
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; token: string; expiresAt: string };
  }
  const phoneBody = (s: { id: string; token: string }, extra: object, device = D1) => ({ sessionId: s.id, token: s.token, device, ...extra });

  it('desktop: needs a signed-in caller, a valid purpose and a writable household', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await sessions.POST(json('http://t/api/scanner/sessions', { purpose: 'pantry' }))).status).toBe(401);
    outcome = { ok: true, auth: { userId: ALICE.userId, householdId: ALICE.householdId, readOnly: true, dataContext: null, defaultServings: 4 } };
    expect((await sessions.POST(json('http://t/api/scanner/sessions', { purpose: 'pantry' }))).status).toBe(403);
    outcome = { ok: true, auth: { userId: ALICE.userId, householdId: ALICE.householdId, readOnly: false, dataContext: null, defaultServings: 4 } };
    expect((await sessions.POST(json('http://t/api/scanner/sessions', { purpose: 'garden' }))).status).toBe(400);
    expect((await sessions.POST(new Request('http://t/api/scanner/sessions', { method: 'POST', body: 'purpose=pantry' }))).status).toBe(415);
  });

  it('full flow: phone connects and pushes without any sign-in, desktop reads and ends it', async () => {
    const s = await start();
    expect(s.id).toMatch(ID_RE);
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    outcome = { ok: false, status: 401, message: 'the phone has no session' }; // the phone routes never consult it
    const c = await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: s.id, token: s.token, device: D1 }));
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ ok: true, purpose: 'pantry' });
    const p = await push.POST(json('http://t/api/scanner/phone/push', phoneBody(s, { clientId: 'client-000001', kind: 'barcode', barcode: CODE })));
    expect(p.status).toBe(200);
    expect(await p.json()).toMatchObject({ ok: true, duplicate: false, itemCount: 1 });
    const img = await push.POST(json('http://t/api/scanner/phone/push', phoneBody(s, { clientId: 'client-000002', kind: 'photo', photo: Buffer.from('JPEGDATA').toString('base64'), mime: 'image/jpeg' })));
    expect(img.status).toBe(200);

    outcome = { ok: true, auth: { userId: ALICE.userId, householdId: ALICE.householdId, readOnly: false, dataContext: null, defaultServings: 4 } };
    const st = await one.GET(new Request(`http://t/api/scanner/sessions/${s.id}?after=0`), { params: Promise.resolve({ id: s.id }) });
    const body = (await st.json()) as { session: { state: string; itemCount: number }; items: Array<{ id: string; kind: string; barcode?: string }> };
    expect(body.session).toMatchObject({ state: 'connected', itemCount: 2 });
    expect(body.items.map((i) => i.kind)).toEqual(['barcode', 'photo']);
    expect(JSON.stringify(body)).not.toContain(s.token);

    const photoId = body.items.find((i) => i.kind === 'photo')!.id;
    const pr = await photos.GET(new Request(`http://t/api/scanner/sessions/${s.id}/photos/${photoId}`), { params: Promise.resolve({ id: s.id, itemId: photoId }) });
    expect(pr.status).toBe(200);
    expect(pr.headers.get('content-type')).toBe('image/jpeg');
    expect(pr.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await pr.arrayBuffer()).toString()).toBe('JPEGDATA');

    const del = await one.DELETE(new Request(`http://t/api/scanner/sessions/${s.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: s.id }) });
    expect(del.status).toBe(200);
    const after = await push.POST(json('http://t/api/scanner/phone/push', phoneBody(s, { clientId: 'client-000003', kind: 'barcode', barcode: CODE })));
    expect(after.status).toBe(403);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe('revoked');
  });

  it('phone: bad credentials and bodies get the same 403 / 422 as wrong tokens, nothing is leaked', async () => {
    const s = await start();
    const wrongToken = await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: s.id, token: 'x'.repeat(43), device: D1 }));
    const unknownId = await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: '00000000-0000-4000-8000-0000000000ff', token: s.token, device: D1 }));
    const malformed = await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: 'nope', token: 1, device: [] }));
    for (const r of [wrongToken, unknownId, malformed]) {
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('invalid');
    }
    expect((await connect.POST(new Request('http://t/api/scanner/phone/connect', { method: 'POST', body: '{}' }))).status).toBe(422); // not application/json
    expect((await push.POST(new Request('http://t/api/scanner/phone/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }))).status).toBe(422);
    const huge = await push.POST(new Request('http://t/api/scanner/phone/push', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '9000000' }, body: '{}' }));
    expect(huge.status).toBe(413);
  });

  it('phone: a second phone is refused and the creator can release it', async () => {
    const s = await start();
    expect((await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: s.id, token: s.token, device: D1 }))).status).toBe(200);
    const second = await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: s.id, token: s.token, device: D2 }));
    expect(second.status).toBe(403);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('scanner_in_use');
    const rel = await one.POST(json(`http://t/api/scanner/sessions/${s.id}`, { action: 'release' }), { params: Promise.resolve({ id: s.id }) });
    expect(rel.status).toBe(200);
    expect((await connect.POST(json('http://t/api/scanner/phone/connect', { sessionId: s.id, token: s.token, device: D2 }))).status).toBe(200);
  });

  it('another signed-in user cannot read or end the session', async () => {
    const s = await start();
    outcome = { ok: true, auth: { userId: 'b0000000-0000-4000-8000-000000000002', householdId: ALICE.householdId, readOnly: false, dataContext: null, defaultServings: 4 } };
    expect((await one.GET(new Request(`http://t/api/scanner/sessions/${s.id}`), { params: Promise.resolve({ id: s.id }) })).status).toBe(404);
    expect((await one.DELETE(new Request(`http://t/api/scanner/sessions/${s.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: s.id }) })).status).toBe(404);
  });

  it('a per-IP shield sits in front of the public routes', async () => {
    const s = await start();
    let limited = 0;
    for (let i = 0; i < 320; i++) {
      const r = await connect.POST(new Request('http://t/api/scanner/phone/connect', { method: 'POST', headers: { 'content-type': 'application/json', ...ip(99) }, body: JSON.stringify({ sessionId: s.id, token: s.token, device: D1 }) }));
      if (r.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await connect.POST(new Request('http://t/api/scanner/phone/connect', { method: 'POST', headers: { 'content-type': 'application/json', ...ip(7) }, body: JSON.stringify({ sessionId: s.id, token: s.token, device: D1 }) }))).status).toBe(200);
  });
});
