import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';
import { acceptsBearer } from '../../../lib/server/auth/routes';
import { resetMemorySettings } from '../../../lib/server/settings/memory-store';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));
const cookieTrap = () => {
  throw new Error('cookie session must not be used');
};
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const { GET, POST } = await import('./route');

const H = 'a1000000-0000-4000-8000-0000000000a2';
const ok = (over: Record<string, unknown> = {}): AuthOutcome => ({ ok: true, auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4, ...over } });
const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://t/api/settings', { method: 'POST', headers, body: JSON.stringify(body) }));

describe('/api/settings (Bearer or cookie, same module as the web Settings page)', () => {
  beforeEach(() => {
    outcome = ok();
  });
  afterEach(() => resetMemorySettings());

  it('is a bearer route', () => {
    expect(acceptsBearer('/api/settings', 'Bearer abc')).toBe(true);
    expect(acceptsBearer('/api/settings', null)).toBe(false);
  });

  it('answers 401 for an unauthenticated caller', async () => {
    outcome = { ok: false, status: 401, message: 'Please sign in.' };
    expect((await GET(new Request('http://t/api/settings'))).status).toBe(401);
  });

  it('reads defaults, saves preferences and the dietary list, and reads them back', async () => {
    const first = await (await GET(new Request(`http://t/api/settings?householdId=${H}`))).json();
    expect(first.settings).toMatchObject({ defaultServings: 4, exclusions: [], consentActive: false });
    expect((await post({ action: 'preferences', defaultServings: '6', weeklyBudget: '85.50' })).status).toBe(200);
    const saved = await (await post({ action: 'dietary', tags: ['Peanuts'], consent: true })).json();
    expect(saved.settings).toMatchObject({ defaultServings: 6, weeklyBudgetPence: 8550, exclusions: ['peanuts'], consentActive: true, withheldExclusions: 0 });
    const withdrawn = await (await post({ action: 'withdraw_consent' })).json();
    expect(withdrawn.settings).toMatchObject({ exclusions: ['peanuts'], consentActive: false, withheldExclusions: 1 });
    const cleared = await (await post({ action: 'remove_all' })).json();
    expect(cleared.settings).toMatchObject({ exclusions: [], consentActive: false, withheldExclusions: 0 });
  });

  it('422 with field errors for bad input; consent is required for exclusions', async () => {
    const bad = await post({ action: 'preferences', defaultServings: '0', weeklyBudget: '' });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fieldErrors.defaultServings).toBeTruthy();
    const noConsent = await post({ action: 'dietary', tags: ['fish'], consent: false });
    expect(noConsent.status).toBe(422);
    expect((await noConsent.json()).error.fieldErrors.consent).toBeTruthy();
  });

  it('403 READ_ONLY while the household is pending deletion; 400 for an unknown action; 415 for a non-JSON body', async () => {
    outcome = ok({ readOnly: true });
    const ro = await post({ action: 'remove_all' });
    expect(ro.status).toBe(403);
    expect((await ro.json()).error.code).toBe('READ_ONLY');
    outcome = ok();
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect((await post({ action: 'remove_all' }, { 'content-type': 'text/plain' })).status).toBe(415);
  });
});
