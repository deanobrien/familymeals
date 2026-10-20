import { createServerApi, ServerApiError } from '@/lib/serverApi';

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function api(fetchImpl: jest.Mock, token: string | null = 'tok') {
  return createServerApi({ baseUrl: 'http://web.test/', getToken: async () => token, fetchImpl: fetchImpl as unknown as typeof fetch });
}

describe('createServerApi', () => {
  it('sends the Bearer token, builds the query string and returns JSON', async () => {
    const f = jest.fn(async () => json(200, { ok: 1 }));
    const out = await api(f).get<{ ok: number }>('/api/plan', { householdId: 'h1', week: '2026-10-19', skip: undefined, empty: '' });
    expect(out).toEqual({ ok: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://web.test/api/plan?householdId=h1&week=2026-10-19');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('posts JSON, and multipart without a Content-Type', async () => {
    const f = jest.fn(async () => json(200, {}));
    const a = api(f);
    await a.post('/api/plan', { action: 'save' });
    await a.postForm('/api/receipts', new FormData());
    const json1 = f.mock.calls[0] as unknown as [string, RequestInit];
    const form = f.mock.calls[1] as unknown as [string, RequestInit];
    expect((json1[1].headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(json1[1].body).toBe('{"action":"save"}');
    expect((form[1].headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('turns the error envelope into a ServerApiError and keeps the extra fields', async () => {
    const f = jest.fn(async () => json(422, { error: { code: 'VALIDATION', message: 'Nope', retryable: false }, violations: ['x'] }));
    const err = await api(f).post('/api/plan', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerApiError);
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION', message: 'Nope', retryable: false, details: { violations: ['x'] } });
  });

  it('explains 401/403 and marks 5xx retryable; a lost connection is retryable', async () => {
    const e401 = await api(jest.fn(async () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', retryable: false } }))).get('/a').catch((e: unknown) => e);
    expect((e401 as ServerApiError).message).toMatch(/sign-in/);
    const e500 = await api(jest.fn(async () => json(500, {}))).get('/a').catch((e: unknown) => e);
    expect((e500 as ServerApiError).retryable).toBe(true);
    const down = await api(jest.fn(async () => { throw new Error('offline'); })).get('/a').catch((e: unknown) => e);
    expect(down).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('is not configured without a base URL and never calls fetch', async () => {
    const f = jest.fn();
    const a = createServerApi({ baseUrl: '', getToken: async () => null, fetchImpl: f as unknown as typeof fetch });
    expect(a.configured).toBe(false);
    expect(a.webUrl('/x')).toBeNull();
    await expect(a.get('/x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(f).not.toHaveBeenCalled();
  });
});
