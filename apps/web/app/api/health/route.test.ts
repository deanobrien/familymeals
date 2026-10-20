import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/health', () => {
  it('returns 503 misconfigured with problems and no values', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_SECRET', 'super-secret-value-123456');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const res = GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('misconfigured');
    expect(body.problems.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('super-secret-value');
  });
  it('returns 200 outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const res = GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});
