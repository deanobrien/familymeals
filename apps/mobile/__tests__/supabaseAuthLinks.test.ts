import { AccountError } from '@/lib/accountErrors';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { ME, fakeAccountDb } from './helpers/fakeAccountDb';

const user = { id: ME.id, email: ME.email };

function ds(auth: Record<string, unknown>) {
  const { client } = fakeAccountDb(undefined, auth);
  return new SupabaseDataSource({ client });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AccountError ? e.code : 'other';
  }
  return 'resolved';
};

describe('SupabaseDataSource auth links (D214, D320)', () => {
  it('exposes the account source', () => {
    expect(ds({}).account).toBeDefined();
  });

  it('a confirmation link establishes the session and is not a recovery', async () => {
    const setSession = jest.fn(async () => ({ data: { user }, error: null }));
    const out = await ds({ setSession }).completeAuthLink('familyrecipes://auth/callback#access_token=A&refresh_token=R&type=signup');
    expect(out).toEqual({ userId: ME.id, email: ME.email });
    expect(setSession).toHaveBeenCalledWith({ access_token: 'A', refresh_token: 'R' });
  });

  it('a recovery link is flagged so the app goes on to choose a new password', async () => {
    const setSession = jest.fn(async () => ({ data: { user }, error: null }));
    const out = await ds({ setSession }).completeAuthLink('familyrecipes://auth/callback#access_token=A&refresh_token=R&type=recovery');
    expect(out).toEqual({ userId: ME.id, email: ME.email, recovery: true });
  });

  it('an expired or already-used link is the fixed "expired or already used" message, never provider text', async () => {
    const e = await ds({}).completeAuthLink('familyrecipes://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired').catch((x: Error) => x);
    expect(e).toBeInstanceOf(AccountError);
    expect((e as AccountError).code).toBe('link_expired');
    expect((e as Error).message).toMatch(/expired or was already used/);
    expect((e as Error).message).not.toMatch(/invalid or has expired/);
  });

  it('a rejected session or code exchange is also reported as an expired link', async () => {
    const bad = { data: { user: null }, error: { code: 'otp_expired', message: 'Token has expired or is invalid' } };
    expect(await code(ds({ setSession: jest.fn(async () => bad) }).completeAuthLink('familyrecipes://auth/callback#access_token=A&refresh_token=R'))).toBe('link_expired');
    expect(await code(ds({ exchangeCodeForSession: jest.fn(async () => bad) }).completeAuthLink('familyrecipes://auth/callback?code=abc'))).toBe('link_expired');
  });

  it('sign-in reports an unconfirmed email as a code the screen can act on, and wrong passwords in plain words', async () => {
    const unconfirmed = ds({ signInWithPassword: jest.fn(async () => ({ data: { user: null }, error: { code: 'email_not_confirmed', message: 'Email not confirmed' } })) });
    expect(await code(unconfirmed.signIn('a@b.co', 'pw'))).toBe('email_not_confirmed');
    const wrong = ds({ signInWithPassword: jest.fn(async () => ({ data: { user: null }, error: { message: 'Invalid login credentials', status: 400 } })) });
    expect(await code(wrong.signIn('a@b.co', 'pw'))).toBe('invalid_credentials');
    const offline = ds({ signInWithPassword: jest.fn(async () => ({ data: { user: null }, error: { message: 'Network request failed' } })) });
    expect(await code(offline.signIn('a@b.co', 'pw'))).toBe('offline');
  });
});
