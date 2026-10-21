import { buildPhoneLink } from '@fr/engine/scanner';
import { DEVICE_KEY, createPhoneTransport, loadDeviceId, parseScannedLink } from '@/lib/scannerApi';

jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const ID = '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const BASE = 'https://app.example.test';
const CRED = { sessionId: ID, token: TOKEN, device: 'device-one-0123456789' };

describe('parseScannedLink', () => {
  it('accepts our link for the configured server only', () => {
    expect(parseScannedLink(buildPhoneLink(BASE, ID, TOKEN), BASE)).toEqual({ origin: BASE, sessionId: ID, token: TOKEN });
    expect(parseScannedLink(buildPhoneLink('https://evil.example.test', ID, TOKEN), BASE)).toBeNull();
    expect(parseScannedLink('https://app.example.test/recipes', BASE)).toBeNull();
    expect(parseScannedLink('some text', BASE)).toBeNull();
    expect(parseScannedLink(buildPhoneLink(BASE, ID, TOKEN), undefined)).toBeNull(); // a build with no server address connects to nothing
  });
});

describe('loadDeviceId', () => {
  const kv = () => {
    const data = new Map<string, string>();
    return { data, getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) } as never;
  };
  it('creates an id once and keeps it', async () => {
    const store = kv();
    const a = await loadDeviceId(store);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await loadDeviceId(store)).toBe(a);
    expect((store as unknown as { data: Map<string, string> }).data.get(DEVICE_KEY)).toBe(a);
  });
  it('replaces a damaged value', async () => {
    const store = kv();
    await (store as unknown as { setItem(k: string, v: string): Promise<void> }).setItem(DEVICE_KEY, 'x');
    expect(await loadDeviceId(store)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('createPhoneTransport', () => {
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

  it('posts JSON to the public phone routes with the credentials and the push', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return res(200, url.endsWith('/connect') ? { ok: true, purpose: 'pantry', expiresAt: 'x', itemCount: 0 } : { ok: true, duplicate: false, itemCount: 1 });
    }) as unknown as typeof fetch;
    const t = createPhoneTransport(`${BASE}/`, fetchImpl);
    expect(await t.connect(CRED)).toMatchObject({ ok: true, purpose: 'pantry' });
    expect(await t.push(CRED, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671', count: 1 })).toMatchObject({ ok: true, itemCount: 1 });
    expect(calls[0]!.url).toBe(`${BASE}/api/scanner/phone/connect`);
    expect(calls[1]!.url).toBe(`${BASE}/api/scanner/phone/push`);
    expect(calls[1]!.body).toMatchObject({ sessionId: ID, token: TOKEN, device: CRED.device, kind: 'barcode', barcode: '5000157024671' });
    expect(calls[1]!.headers['content-type']).toBe('application/json');
    expect(JSON.stringify(calls.map((c) => c.headers))).not.toContain('authorization'); // no sign-in token is ever sent
  });

  it('maps server errors to the shared codes and network failures to "unavailable"', async () => {
    const t1 = createPhoneTransport(BASE, (async () => res(403, { error: { code: 'expired', message: 'm' } })) as unknown as typeof fetch);
    expect(await t1.connect(CRED)).toEqual({ ok: false, code: 'expired', message: 'm' });
    const t2 = createPhoneTransport(BASE, (async () => res(503, null)) as unknown as typeof fetch);
    expect(await t2.connect(CRED)).toMatchObject({ ok: false, code: 'unavailable' });
    const t3 = createPhoneTransport(BASE, (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch);
    expect(await t3.push(CRED, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671' })).toMatchObject({ ok: false, code: 'unavailable' });
    const t4 = createPhoneTransport(BASE, (async () => res(429, { error: { code: 'rate_limited', message: 'slow' } })) as unknown as typeof fetch);
    expect(await t4.push(CRED, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671' })).toMatchObject({ ok: false, code: 'rate_limited' });
  });
});
