import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

afterEach(() => vi.unstubAllEnvs());

describe('middleware with invalid production config', () => {
  it('answers 503 HTML for pages, leaves /api/health alone', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_SECRET', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const res = await middleware(new NextRequest('http://localhost/'));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/not configured yet/);
    const health = await middleware(new NextRequest('http://localhost/api/health'));
    expect(health.status).not.toBe(503);
  });
});
