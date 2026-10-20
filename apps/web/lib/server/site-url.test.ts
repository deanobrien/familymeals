import { describe, expect, it, vi, beforeEach } from 'vitest';
import { configuredOrigin, publicOrigin } from './site-url';

const SITE = 'https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net';
const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe('publicOrigin', () => {
  it('env wins over container-internal request url, host and forwarded headers', () => {
    const req = { url: 'https://65339094faad:8080/auth/callback', headers: h({ host: '65339094faad:8080', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }) };
    expect(publicOrigin(req, { NEXT_PUBLIC_SITE_URL: `${SITE}/`, NODE_ENV: 'production' })).toBe(SITE);
  });
  it('rejects non-https configured url in production', () => {
    expect(configuredOrigin({ NEXT_PUBLIC_SITE_URL: 'http://x.example', NODE_ENV: 'production' })).toBeNull();
    expect(configuredOrigin({ NEXT_PUBLIC_SITE_URL: 'not a url', NODE_ENV: 'production' })).toBeNull();
    expect(configuredOrigin({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3100', NODE_ENV: 'development' })).toBe('http://localhost:3100');
  });
  it('honours forwarded headers only for allow-listed local hosts', () => {
    expect(publicOrigin({ headers: h({ 'x-forwarded-host': 'localhost:3141, evil.example', 'x-forwarded-proto': 'http' }) }, { NODE_ENV: 'development' })).toBe('http://localhost:3141');
  });
  it('rejects foreign forwarded/Host headers (no host-header poisoning)', () => {
    const req = { url: 'https://evil.example/x', headers: h({ host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }) };
    expect(publicOrigin(req, { NODE_ENV: 'development' })).toBe('http://localhost:3100');
    expect(publicOrigin(req, { NODE_ENV: 'production' })).not.toContain('evil.example');
  });
  it('dev fallback uses a localhost request origin', () => {
    expect(publicOrigin({ url: 'http://127.0.0.1:3000/a' }, { NODE_ENV: 'development' })).toBe('http://127.0.0.1:3000');
    expect(publicOrigin(undefined, { NODE_ENV: 'test' })).toBe('http://localhost:3100');
  });
});

describe('call sites use the public origin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);
    vi.stubEnv('NODE_ENV', 'production');
  });

  async function loadActions(authMock: Record<string, unknown>) {
    vi.doMock('next/headers', () => ({ headers: async () => h({ host: '65339094faad:8080', 'x-forwarded-host': '65339094faad:8080' }) }));
    vi.doMock('next/navigation', () => ({
      redirect: (u: string) => {
        throw new Error(`REDIRECT:${u}`);
      },
    }));
    vi.doMock('../supabase/env', () => ({ resolveAuthMode: () => 'supabase' }));
    vi.doMock('../supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: authMock }) }));
    return import('../../app/(auth)/actions');
  }
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it('signUp emailRedirectTo', async () => {
    const signUp = vi.fn(async () => ({ data: { session: null }, error: null }));
    const a = await loadActions({ signUp });
    await expect(a.signUpAction(fd({ email: 'a@b.co', password: 'longenough123' }))).rejects.toThrow('REDIRECT:/sign-up?sent=1');
    expect((signUp.mock.calls[0] as unknown as [{ options: { emailRedirectTo: string } }])[0].options.emailRedirectTo).toBe(`${SITE}/auth/callback?next=%2Fhousehold%2Fnew`);
  });
  it('reset password redirectTo', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({}));
    const a = await loadActions({ resetPasswordForEmail });
    await expect(a.forgotPasswordAction(fd({ email: 'a@b.co' }))).rejects.toThrow('REDIRECT:/forgot-password?sent=1');
    expect((resetPasswordForEmail.mock.calls[0] as unknown as [string, { redirectTo: string }])[1].redirectTo).toBe(`${SITE}/auth/callback?next=%2Freset-password`);
  });
  it('resend confirmation uses public origin', async () => {
    const resend = vi.fn(async () => ({ error: null }));
    const a = await loadActions({ resend });
    await expect(a.resendConfirmationAction(fd({ email: 'a@b.co' }))).rejects.toThrow('REDIRECT:/sign-in?resent=1');
    const arg = (resend.mock.calls[0] as unknown as [{ type: string; options: { emailRedirectTo: string } }])[0];
    expect(arg.type).toBe('signup');
    expect(arg.options.emailRedirectTo.startsWith(`${SITE}/auth/callback`)).toBe(true);
  });

  async function loadCallback(auth: Record<string, unknown>) {
    vi.doMock('../supabase/env', () => ({ resolveAuthMode: () => 'supabase' }));
    vi.doMock('../supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth }) }));
    return import('../../app/(auth)/auth/callback/route');
  }
  const cbReq = (qs: string) => {
    const url = `https://65339094faad:8080/auth/callback?${qs}`;
    return { url, headers: h({ host: '65339094faad:8080' }) } as unknown as import('next/server').NextRequest;
  };

  it('callback success redirects to public origin + safe next', async () => {
    const r = await loadCallback({ exchangeCodeForSession: async () => ({ error: null }) });
    const res = await r.GET(cbReq('code=abc&next=%2Fhousehold%2Fnew'));
    expect(res.headers.get('location')).toBe(`${SITE}/household/new`);
  });
  it('callback open-redirect next is neutralised', async () => {
    const r = await loadCallback({ exchangeCodeForSession: async () => ({ error: null }) });
    const res = await r.GET(cbReq('code=abc&next=%2F%2Fevil.example'));
    expect(res.headers.get('location')).toBe(`${SITE}/`);
  });
  it('callback failure maps precisely (not invalid_credentials) on public origin', async () => {
    const r = await loadCallback({ exchangeCodeForSession: async () => ({ error: { code: 'otp_expired' } }) });
    const res = await r.GET(cbReq('code=abc'));
    expect(res.headers.get('location')).toBe(`${SITE}/sign-in?error=link_expired`);
    const res2 = await r.GET(cbReq('error=access_denied&error_code=otp_expired'));
    expect(res2.headers.get('location')).toBe(`${SITE}/sign-in?error=link_expired`);
  });
});
