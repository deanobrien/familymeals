import { AUTH_REDIRECT_URL, isAuthCallbackUrl, parseAuthLink } from '@/lib/authLink';

describe('auth deep link', () => {
  it('recognises the callback URL in the app scheme and the Expo Go form', () => {
    expect(isAuthCallbackUrl(AUTH_REDIRECT_URL)).toBe(true);
    expect(isAuthCallbackUrl('familyrecipes://auth/callback#access_token=a&refresh_token=b')).toBe(true);
    expect(isAuthCallbackUrl('exp://192.168.0.10:8081/--/auth/callback?code=x')).toBe(true);
    expect(isAuthCallbackUrl('familyrecipes://recipe/123')).toBe(false);
    expect(isAuthCallbackUrl(null)).toBe(false);
  });

  it('reads implicit-flow tokens from the fragment', () => {
    expect(parseAuthLink('familyrecipes://auth/callback#access_token=AT&refresh_token=RT&token_type=bearer&type=signup')).toEqual({
      kind: 'tokens',
      accessToken: 'AT',
      refreshToken: 'RT',
    });
  });

  it('reads a PKCE code from the query', () => {
    expect(parseAuthLink('familyrecipes://auth/callback?code=abc123')).toEqual({ kind: 'code', code: 'abc123' });
  });

  it('reports an error link (expired / used) with its message', () => {
    expect(parseAuthLink('familyrecipes://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toEqual({
      kind: 'error',
      message: 'Email link is invalid or has expired',
      code: 'otp_expired',
    });
  });

  it('ignores other URLs and empty callbacks', () => {
    expect(parseAuthLink('familyrecipes://households')).toEqual({ kind: 'none' });
    expect(parseAuthLink('familyrecipes://auth/callback')).toEqual({ kind: 'none' });
  });
});
