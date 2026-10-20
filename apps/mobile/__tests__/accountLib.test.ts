import { ACCOUNT_ERROR_MESSAGES, AccountError, mapAuthApiError, mapDbError, mapLinkError, messageOf } from '@/lib/accountErrors';
import {
  daysLeft,
  isEmail,
  isNewPassword,
  parseCreateHousehold,
  parseExclusionTag,
  parsePreferences,
  poundsToPence,
} from '@/lib/accountForms';
import { INVITE_TOKEN_RE, buildAppInviteUrl, buildInviteUrl, parseInviteUrl } from '@/lib/inviteLink';
import { clearPendingNext, safeAppPath, setPendingNext, takePendingNext } from '@/lib/pendingNext';
import { COMMON_EXCLUSIONS, CONSENT_CHECKBOX_LABEL, CONSENT_WORDING_V1, CONSENT_WORDING_VERSION, consentNoticeText } from '@/lib/privacyText';
import { webUrl } from '@/lib/webLinks';
import { loadDevicePrefs, saveDevicePrefs } from '@/lib/devicePrefs';
import { parseAuthLink } from '@/lib/authLink';

const TOKEN = 'cd'.repeat(32);

describe('account errors (same wording and mapping as the web)', () => {
  it('maps auth API errors coarsely, rate limits and offline distinctly', () => {
    expect(mapAuthApiError({ code: 'weak_password' })).toBe('weak_password');
    expect(mapAuthApiError({ code: 'email_not_confirmed' })).toBe('email_not_confirmed');
    expect(mapAuthApiError({ code: 'otp_expired' })).toBe('link_expired');
    expect(mapAuthApiError({ status: 429 })).toBe('rate_limited');
    expect(mapAuthApiError({ code: 'over_email_send_rate_limit' })).toBe('rate_limited');
    expect(mapAuthApiError({ message: 'Network request failed' })).toBe('offline');
    expect(mapAuthApiError({ status: 503 })).toBe('unknown');
    expect(mapAuthApiError({ message: 'Invalid login credentials', status: 400 })).toBe('invalid_credentials');
  });
  it('maps database errors', () => {
    expect(mapDbError({ code: '42501', message: 'household is pending_deletion' })).toBe('read_only');
    expect(mapDbError({ code: '42501', message: 'permission denied' })).toBe('forbidden');
    expect(mapDbError({ code: '22023', message: 'invalid invitation' })).toBe('invitation_invalid');
    expect(mapDbError({ code: '22023', message: 'bad ttl' })).toBe('invalid_input');
    expect(mapDbError({ code: '23514', message: 'needs at least one active owner' })).toBe('last_owner');
    expect(mapDbError({ message: 'cannot remove the last member' })).toBe('last_owner');
    expect(mapDbError({ code: 'PGRST116' })).toBe('not_found');
    expect(mapDbError({ message: 'fetch failed' })).toBe('offline');
    expect(mapDbError(null)).toBe('unknown');
  });
  it('treats every email-link failure as expired / used, except rate limits', () => {
    expect(mapLinkError('otp_expired')).toBe('link_expired');
    expect(mapLinkError('access_denied')).toBe('link_expired');
    expect(mapLinkError(undefined)).toBe('link_expired');
    expect(mapLinkError('over_request_rate_limit')).toBe('rate_limited');
    expect(mapLinkError('email_not_confirmed')).toBe('email_not_confirmed');
  });
  it('AccountError carries only the fixed text', () => {
    const e = new AccountError('link_expired');
    expect(e.message).toBe(ACCOUNT_ERROR_MESSAGES.link_expired);
    expect(messageOf(e)).toContain('expired or was already used');
    expect(messageOf(new Error('secret@x.co token abc'))).toBe(ACCOUNT_ERROR_MESSAGES.unknown);
  });
});

describe('form validation', () => {
  it('emails and passwords (minimum 10)', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail(' a@b.co ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('')).toBe(false);
    expect(isNewPassword('1234567890')).toBe(true);
    expect(isNewPassword('123456789')).toBe(false);
    expect(isNewPassword('x'.repeat(201))).toBe(false);
  });
  it('pounds to pence', () => {
    expect(poundsToPence('')).toBeNull();
    expect(poundsToPence('85')).toBe(8500);
    expect(poundsToPence('85.5')).toBe(8550);
    expect(poundsToPence('0.07')).toBe(7);
    expect(poundsToPence('85.555')).toBeUndefined();
    expect(poundsToPence('-1')).toBeUndefined();
    expect(poundsToPence('1,50')).toBeUndefined();
  });
  it('create household: name, servings 1-50, optional budget and display name', () => {
    expect(parseCreateHousehold({ name: ' The Smiths ', defaultServings: '', weeklyBudgetPounds: '', displayName: '  ' })).toEqual({
      ok: true,
      value: { name: 'The Smiths', defaultServings: 4, weeklyBudgetPence: null },
    });
    expect(parseCreateHousehold({ name: 'A', defaultServings: '6', weeklyBudgetPounds: '90.50', displayName: 'Dean' })).toEqual({
      ok: true,
      value: { name: 'A', defaultServings: 6, weeklyBudgetPence: 9050, displayName: 'Dean' },
    });
    const bad = parseCreateHousehold({ name: '  ', defaultServings: '51', weeklyBudgetPounds: 'abc', displayName: 'x'.repeat(81) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['defaultServings', 'displayName', 'name', 'weeklyBudgetPounds']);
  });
  it('preferences: servings 1-24', () => {
    expect(parsePreferences({ defaultServings: '24', weeklyBudgetPounds: '' })).toEqual({ ok: true, value: { defaultServings: 24, weeklyBudgetPence: null } });
    expect(parsePreferences({ defaultServings: '25', weeklyBudgetPounds: '' }).ok).toBe(false);
    expect(parsePreferences({ defaultServings: '0', weeklyBudgetPounds: '' }).ok).toBe(false);
    expect(parsePreferences({ defaultServings: 'x', weeklyBudgetPounds: '' }).ok).toBe(false);
  });
  it('exclusion tags: letters, spaces, apostrophes, hyphens', () => {
    expect(parseExclusionTag('  Tree Nuts ')).toEqual({ ok: true, value: 'tree nuts' });
    expect(parseExclusionTag("saint-john's wort")).toEqual({ ok: true, value: "saint-john's wort" });
    expect(parseExclusionTag('').ok).toBe(false);
    expect(parseExclusionTag('peanut2').ok).toBe(false);
    expect(parseExclusionTag('x'.repeat(41)).ok).toBe(false);
  });
  it('counts whole days left, never negative', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(daysLeft('2026-11-03T12:00:00Z', now)).toBe(14);
    expect(daysLeft('2026-10-20T13:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('invite links', () => {
  it('builds the shareable and the app-scheme link', () => {
    expect(buildInviteUrl('https://web.test/', TOKEN)).toBe(`https://web.test/invite/${TOKEN}`);
    expect(buildAppInviteUrl(TOKEN)).toBe(`familyrecipes://invite/${TOKEN}`);
    expect(INVITE_TOKEN_RE.test(TOKEN)).toBe(true);
  });
  it('parses app-scheme, https and Expo Go links; rejects everything else', () => {
    expect(parseInviteUrl(`familyrecipes://invite/${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteUrl(`https://web.test/invite/${TOKEN}?utm=1`)).toBe(TOKEN);
    expect(parseInviteUrl(`exp://192.168.0.10:8081/--/invite/${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteUrl(`familyrecipes://invite/${TOKEN.toUpperCase()}`)).toBe(TOKEN);
    expect(parseInviteUrl('familyrecipes://invite/short')).toBeNull();
    expect(parseInviteUrl(`https://web.test/other/${TOKEN}`)).toBeNull();
    expect(parseInviteUrl(`https://web.test/invite/${TOKEN}/extra`)).toBeNull();
    expect(parseInviteUrl(null)).toBeNull();
  });
});

describe('pending next (invite survives sign-up and sign-in)', () => {
  it('only an invite path is ever remembered', () => {
    expect(safeAppPath(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    expect(safeAppPath('/settings')).toBeNull();
    expect(safeAppPath('//evil.test')).toBeNull();
    expect(safeAppPath('https://evil.test')).toBeNull();
    expect(safeAppPath(`/invite/${TOKEN}/../x`)).toBeNull();
  });
  it('is read once, expires after an hour and ignores anything else', async () => {
    await clearPendingNext();
    await setPendingNext('/settings');
    expect(await takePendingNext()).toBeNull();
    await setPendingNext(`/invite/${TOKEN}`, () => 1_000);
    expect(await takePendingNext(() => 2_000)).toBe(`/invite/${TOKEN}`);
    expect(await takePendingNext(() => 2_000)).toBeNull(); // consumed
    await setPendingNext(`/invite/${TOKEN}`, () => 1_000);
    expect(await takePendingNext(() => 1_000 + 61 * 60 * 1000)).toBeNull(); // expired
  });
});


describe('consent text', () => {
  it('the withheld-consent notice is a count only, with the web wording', () => {
    expect(consentNoticeText(1)).toBe("1 allergy exclusion isn't being applied because consent hasn't been given");
    expect(consentNoticeText(3)).toBe("3 allergy exclusions aren't being applied because consent hasn't been given");
    expect(consentNoticeText(0)).toBeNull();
  });
  it('the consent wording and allergen list are non-empty (apps/web/app/settings/mobile-parity.test.ts proves they equal the web copies)', () => {
    expect(CONSENT_WORDING_V1.length).toBeGreaterThan(100);
    expect(CONSENT_CHECKBOX_LABEL).toMatch(/^I agree/);
    expect(CONSENT_WORDING_VERSION).toBe('v1');
    expect(COMMON_EXCLUSIONS).toHaveLength(14);
  });
});

describe('small helpers', () => {
  it('webUrl joins the base and path, or is null without a base', () => {
    expect(webUrl('/privacy', 'https://web.test/')).toBe('https://web.test/privacy');
    expect(webUrl('about/sources', 'https://web.test')).toBe('https://web.test/about/sources');
    expect(webUrl('/privacy', '')).toBeNull();
    expect(webUrl('/privacy', undefined)).toBeNull();
  });
  it('device preferences default to metric / en-GB, round-trip and survive junk', async () => {
    expect(await loadDevicePrefs()).toEqual({ units: 'metric', locale: 'en-GB', scanSound: true });
    await saveDevicePrefs({ units: 'imperial', locale: 'en-IE', scanSound: false });
    expect(await loadDevicePrefs()).toEqual({ units: 'imperial', locale: 'en-IE', scanSound: false });
  });
  it('recognises a recovery link by its type', () => {
    expect(parseAuthLink('familyrecipes://auth/callback#access_token=A&refresh_token=R&type=recovery')).toMatchObject({ kind: 'tokens', type: 'recovery' });
    expect(parseAuthLink('familyrecipes://auth/callback#access_token=A&refresh_token=R')).toEqual({ kind: 'tokens', accessToken: 'A', refreshToken: 'R' });
  });
});
