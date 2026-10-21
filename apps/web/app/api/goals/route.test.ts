import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';
import { acceptsBearer } from '../../../lib/server/auth/routes';
import { resetMemoryGoals } from '../../../lib/server/goals/memory-store';

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
  POST(new Request('http://t/api/goals', { method: 'POST', headers, body: JSON.stringify(body) }));
const save = { action: 'save', goals: ['more_fibre'], portionShare: 1, nudgePlan: false, consent: true, adultConfirmed: true };

describe('/api/goals (Bearer, same module as web Settings > Health goals)', () => {
  beforeEach(() => {
    outcome = ok();
  });
  afterEach(() => resetMemoryGoals());

  it('is a bearer route', () => {
    expect(acceptsBearer('/api/goals', 'Bearer abc')).toBe(true);
    expect(acceptsBearer('/api/goals', null)).toBe(false);
  });

  it('answers 401 for an unauthenticated caller', async () => {
    outcome = { ok: false, status: 401, message: 'Please sign in.' };
    expect((await GET(new Request('http://t/api/goals'))).status).toBe(401);
  });

  it('starts with nothing, refuses goals without consent (403 CONSENT_REQUIRED), stores them with consent, and withdraw deletes', async () => {
    expect(await (await GET(new Request(`http://t/api/goals?householdId=${H}`))).json()).toEqual({
      goals: { consentActive: false, goals: [], portionShare: 1, nudgePlan: false, adultConfirmed: false, wordingVersion: null },
    });
    const refused = await post({ ...save, consent: false });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe('CONSENT_REQUIRED');
    expect((await (await GET(new Request(`http://t/api/goals?householdId=${H}`))).json()).goals.consentActive).toBe(false);
    const saved = await (await post(save)).json();
    expect(saved.goals).toMatchObject({ consentActive: true, goals: ['more_fibre'], adultConfirmed: true });
    const gone = await (await post({ action: 'withdraw' })).json();
    expect(gone.goals).toMatchObject({ consentActive: false, goals: [] });
  });

  it('422 for unknown goals or no adult confirmation; 400 for an unknown action; 415 for a non-JSON body', async () => {
    expect((await post({ ...save, goals: ['lose_weight'] })).status).toBe(422);
    expect((await post({ ...save, adultConfirmed: false })).status).toBe(422);
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect((await post(save, { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('403 READ_ONLY for a save while the household is pending deletion, but withdrawing is still allowed', async () => {
    await post(save);
    outcome = ok({ readOnly: true });
    const ro = await post(save);
    expect(ro.status).toBe(403);
    expect((await ro.json()).error.code).toBe('READ_ONLY');
    expect((await post({ action: 'withdraw' })).status).toBe(200);
  });
});
