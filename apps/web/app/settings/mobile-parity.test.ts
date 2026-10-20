import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_MESSAGES, mapAuthApiError, mapCallbackError, mapDbError } from '../../lib/server/auth/errors';
import { consentNoticeText } from '../../lib/consent/notice';
import { COMMON_EXCLUSIONS, CONSENT_CHECKBOX_LABEL, CONSENT_WORDING_V1, CONSENT_WORDING_VERSION } from './schema';
import * as ts from 'typescript';

/**
 * Drift guard for the Android copies (P0-A, D324): the special-category consent wording, the allergen list, the withheld-consent
 * notice and the user-facing auth/household messages are duplicated in apps/mobile (it cannot import server code). Both sides
 * must stay identical, and the Android error mappers must keep answering exactly like the web ones.
 */
const mobileSrc = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../mobile/src/${rel}`, import.meta.url)), 'utf8');

/** Transpile and run an import-free mobile module (importing it directly would drag in the mobile tsconfig). */
interface MobileErrors {
  ACCOUNT_ERROR_MESSAGES: Record<string, string>;
  mapAuthApiError(e: unknown): string;
  mapDbError(e: unknown): string;
  mapLinkError(c: string | null | undefined): string;
}
interface MobilePrivacy {
  CONSENT_WORDING_V1: string;
  CONSENT_CHECKBOX_LABEL: string;
  CONSENT_WORDING_VERSION: string;
  COMMON_EXCLUSIONS: readonly string[];
  consentNoticeText(n: number): string | null;
}
function loadMobile<T>(rel: string): T {
  const out = ts.transpileModule(mobileSrc(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', out)(mod, mod.exports);
  return mod.exports;
}
const mobileErrors = loadMobile<MobileErrors>('lib/accountErrors.ts');
const mobilePrivacy = loadMobile<MobilePrivacy>('lib/privacyText.ts');

describe('Android consent text equals the web text', () => {
  it('wording, checkbox label and version are verbatim', () => {
    expect(mobilePrivacy.CONSENT_WORDING_V1).toBe(CONSENT_WORDING_V1);
    expect(mobilePrivacy.CONSENT_CHECKBOX_LABEL).toBe(CONSENT_CHECKBOX_LABEL);
    expect(mobilePrivacy.CONSENT_WORDING_VERSION).toBe(CONSENT_WORDING_VERSION);
  });
  it('the allergen / exclusion list is the same, in the same order', () => {
    expect([...mobilePrivacy.COMMON_EXCLUSIONS]).toEqual([...COMMON_EXCLUSIONS]);
  });
  it('the withheld-consent notice reads the same for every count', () => {
    for (const n of [-1, 0, 0.5, 1, 2, 7]) expect(mobilePrivacy.consentNoticeText(n)).toBe(consentNoticeText(n));
  });
  it('the source text on the mobile side still contains the literal wording (no escaping surprises)', () => {
    expect(mobileSrc('lib/privacyText.ts')).toContain(CONSENT_WORDING_V1);
  });
});

describe('Android messages and error mapping equal the web ones', () => {
  it('every message both platforms share is word for word the same', () => {
    for (const key of Object.keys(AUTH_ERROR_MESSAGES) as Array<keyof typeof AUTH_ERROR_MESSAGES>) {
      if (key in mobileErrors.ACCOUNT_ERROR_MESSAGES && key !== 'not_configured' && key !== 'mock_mode') {
        expect(mobileErrors.ACCOUNT_ERROR_MESSAGES[key]).toBe(AUTH_ERROR_MESSAGES[key]);
      }
    }
  });
  const authErrors = [
    { code: 'weak_password' }, { code: 'email_not_confirmed' }, { code: 'otp_expired' }, { code: 'validation_failed' }, { status: 429 },
    { code: 'over_email_send_rate_limit' }, { status: 503 }, { message: 'Invalid login credentials', status: 400 }, {}, null,
  ];
  it('auth errors map to the same codes (offline is the only extra Android code)', () => {
    for (const e of authErrors) expect(mobileErrors.mapAuthApiError(e)).toBe(mapAuthApiError(e));
  });
  it('database errors map to the same codes', () => {
    const dbErrors = [
      { code: '42501', message: 'household is pending_deletion' }, { code: '42501', message: 'denied' }, { code: '22023', message: 'invalid invitation' },
      { code: '22023', message: 'x' }, { code: '23514', message: 'at least one active owner' }, { code: '23514', message: 'x' },
      { message: 'cannot transfer ownership' }, { message: 'last member' }, { code: 'PGRST116' }, { status: 429 }, { code: 'XX000', message: 'boom' }, null,
    ];
    for (const e of dbErrors) expect(mobileErrors.mapDbError(e)).toBe(mapDbError(e));
  });
  it('email-link failures map to the same codes', () => {
    for (const c of ['otp_expired', 'access_denied', 'email_not_confirmed', 'over_request_rate_limit', undefined, null]) {
      expect(mobileErrors.mapLinkError(c)).toBe(mapCallbackError(c));
    }
  });
});
