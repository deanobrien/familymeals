// P2-C (D410-D419): the bearer routes the Android app uses (calendar flags, ICS subscription, leftovers, Cook x2) in mock mode.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from '@fr/ai';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

process.env.URL_IMPORT_SOURCE = 'mock'; // offline fixture "internet"; the SSRF guard still runs
process.env.APP_SECRET = 'route-test-secret-0123456789abcdef';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));
vi.mock('../../../lib/server/ai/provider', () => ({ settingsAiProvider: createMockProvider({ allowInProduction: true }) }));

const cal = await import('./route');
const left = await import('../leftovers/route');
const week = await import('../plan/route');
const { POST: createRecipe } = await import('../recipes/route');
const { POST: cooked } = await import('../recipes/[id]/cooked/route');
const { POST: savePlan } = await import('../plan/save/route');
const { resetMemoryCalendar } = await import('../../../lib/server/calendar/store');
const { resetMemoryLeftovers } = await import('../../../lib/server/leftovers/store');
const { resetIcsThrottle } = await import('../../../lib/server/calendar/service');
const { resetMemoryCooking } = await import('../../../lib/server/cooking/memory-store');
const { resetPlanServices } = await import('../../../lib/server/plan/services');

const H = 'a3000000-0000-4000-8000-0000000000a3';
const ok = (over: Partial<Extract<AuthOutcome, { ok: true }>['auth']> = {}): AuthOutcome => ({
  ok: true,
  auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4, ...over },
});
const post = (body: unknown) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ householdId: H, ...(body as object) }) });
const get = (path: string) => new Request(`http://t/${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const WEEK = '2026-10-19';

beforeEach(() => {
  outcome = ok();
  resetMemoryCalendar();
  resetMemoryLeftovers();
  resetMemoryCooking();
  resetIcsThrottle();
  resetPlanServices();
});

describe('POST /api/calendar', () => {
  it('manual toggle shows up on the plan week as a labelled busy evening', async () => {
    expect((await cal.POST(post({ action: 'busy_set', date: '2026-10-21', busy: true }))).status).toBe(200);
    const data = await (await week.GET(get(`api/plan?householdId=${H}&week=${WEEK}`))).json();
    expect(data.busy).toEqual([{ date: '2026-10-21', sources: ['manual'], minutesAvailable: null, skip: false, label: 'Busy' }]);
    await cal.POST(post({ action: 'busy_set', date: '2026-10-21', busy: false }));
    expect((await (await week.GET(get(`api/plan?householdId=${H}&week=${WEEK}`))).json()).busy).toEqual([]);
  });

  it('device sync accepts derived flags only, revoke removes them', async () => {
    const days = [{ date: '2026-10-20', busy: true, minutesAvailable: 40 }, { date: '2026-10-21', busy: false, minutesAvailable: 180 }];
    const res = await cal.POST(post({ action: 'device_sync', from: '2026-10-19', to: '2026-10-25', days }));
    expect(await res.json()).toEqual({ stored: 1 });
    const status = await (await cal.GET(get(`api/calendar?householdId=${H}&week=${WEEK}`))).json();
    expect(status.status.deviceFlagCount).toBe(1);
    expect(status.busy).toMatchObject([{ date: '2026-10-20', sources: ['device'], minutesAvailable: 40 }]);
    expect((await cal.POST(post({ action: 'device_sync', from: 'nope', to: '2026-10-25', days }))).status).toBe(422);
    expect((await cal.POST(post({ action: 'device_revoke' }))).status).toBe(200);
    expect((await (await cal.GET(get(`api/calendar?householdId=${H}`))).json()).status.deviceFlagCount).toBe(0);
  });

  it('ICS: saves a fixture feed, never returns the address, and removes it again', async () => {
    const url = 'https://fixtures.recipes.test/calendar.ics';
    const saved = await cal.POST(post({ action: 'ics_save', url, timeZone: 'Europe/London' }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).busyDays).toBe(3);
    const status = await (await cal.GET(get(`api/calendar?householdId=${H}`))).json();
    expect(status.status).toMatchObject({ icsConfigured: true, icsHost: 'fixtures.recipes.test' });
    expect(JSON.stringify(status)).not.toContain('calendar.ics');
    expect((await cal.POST(post({ action: 'ics_remove' }))).status).toBe(200);
    expect((await (await cal.GET(get(`api/calendar?householdId=${H}`))).json()).status.icsConfigured).toBe(false);
  });

  it('ICS: an internal address is refused with a clear error', async () => {
    const res = await cal.POST(post({ action: 'ics_save', url: 'http://169.254.169.254/latest/meta-data/', timeZone: 'Europe/London' }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('BLOCKED');
  });

  it('is refused for a read-only household, and for unknown actions', async () => {
    outcome = ok({ readOnly: true });
    expect((await cal.POST(post({ action: 'busy_set', date: '2026-10-21', busy: true }))).status).toBe(403);
    outcome = ok();
    expect((await cal.POST(post({ action: 'nope' }))).status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    outcome = { ok: false, status: 401, message: 'Sign in' };
    expect((await cal.GET(get('api/calendar'))).status).toBe(401);
  });
});

describe('Cook x2 and the leftovers routes', () => {
  let n = 0;
  async function recipe(): Promise<string> {
    const res = await createRecipe(post({
      recipe: {
        title: `Chilli ${++n}`, description: '', imageUrl: null, sourceAttribution: '', sourceUrl: '', originalText: '', prepMinutes: 5, cookMinutes: 10, servings: 4,
        cuisine: 'British', mealType: 'dinner', diet: 'meat', tags: [],
        ingredients: [{ name: 'plain flour', quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' }, optional: false }], steps: ['Cook.'],
      },
    }));
    return ((await res.json()) as { id: string }).id;
  }
  const leftovers = async () => (await (await left.GET(get(`api/leftovers?householdId=${H}&week=${WEEK}&today=2026-10-21`))).json()).leftovers;

  it('mark cooked with x2 records the extra portions once and lists them in the fridge', async () => {
    const id = await recipe();
    const res = await cooked(post({ servings: 4, batch: { multiplier: 2, storedIn: 'fridge' }, today: '2026-10-21' }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leftover).toMatchObject({ title: expect.stringMatching(/^Chilli [0-9]+$/), portionsMade: 4, storedIn: 'fridge', useBy: '2026-10-23' });
    const view = await leftovers();
    expect(view.batches).toHaveLength(1);
    expect(view.batches[0]).toMatchObject({ title: expect.stringMatching(/^Chilli/), portionsLeft: 4, portionsFree: 4, status: 'ok', useByLabel: 'Use by Fri 23 Oct' });
    expect(view.suggestions.length).toBeGreaterThan(0);
  });

  it('x3 into the freezer: 8 portions, 3 months, "Freezer meal" suggestions', async () => {
    const id = await recipe();
    const body = await (await cooked(post({ servings: 4, batch: { multiplier: 3, storedIn: 'freezer' }, today: '2026-10-21' }), ctx(id))).json();
    expect(body.leftover).toMatchObject({ portionsMade: 8, storedIn: 'freezer', useBy: '2027-01-21' });
    const view = await leftovers();
    expect(view.suggestions[0].label).toMatch(/^Freezer meal: Chilli [0-9]+, \d portions?$/);
  });

  it('a plain cook (no batch) and a bad batch record nothing', async () => {
    const id = await recipe();
    expect((await (await cooked(post({ servings: 4 }), ctx(id))).json()).leftover).toBeUndefined();
    expect((await cooked(post({ servings: 4, batch: { multiplier: 1 } }), ctx(id))).status).toBe(422);
    expect((await leftovers()).batches).toEqual([]);
  });

  it('eat / discard / freeze / remove, with the ledger arithmetic and 409s', async () => {
    const id = await recipe();
    const { leftover } = await (await cooked(post({ servings: 2, batch: { multiplier: 3, storedIn: 'fridge' }, today: '2026-10-21' }), ctx(id))).json(); // 4 portions
    const act = async (body: object) => left.POST(post({ today: '2026-10-21', ...body }));
    expect(await (await act({ action: 'eat', batchId: leftover.id, portions: 1, key: 't1' })).json()).toEqual({ portionsLeft: 3 });
    expect(await (await act({ action: 'eat', batchId: leftover.id, portions: 1, key: 't1' })).json()).toEqual({ portionsLeft: 3 }); // retried tap
    expect((await act({ action: 'discard', batchId: leftover.id, portions: 9 })).status).toBe(409);
    expect(await (await act({ action: 'discard', batchId: leftover.id, portions: 1 })).json()).toEqual({ portionsLeft: 2 });
    expect((await act({ action: 'freeze', batchId: leftover.id })).status).toBe(200);
    expect((await leftovers()).batches[0]).toMatchObject({ storedIn: 'freezer', useBy: '2027-01-21', portionsLeft: 2 });
    expect((await act({ action: 'freeze', batchId: leftover.id })).status).toBe(409);
    expect((await act({ action: 'eat', batchId: 'missing', portions: 1 })).status).toBe(404);
    expect((await act({ action: 'eat', batchId: leftover.id, portions: 0 })).status).toBe(422);
    expect((await act({ action: 'remove', batchId: leftover.id })).status).toBe(200);
    expect((await leftovers()).batches).toEqual([]);
  });

  it('adds a freezer meal by hand', async () => {
    const res = await left.POST(post({ action: 'add', title: 'Lasagne', portions: 6, storedIn: 'freezer', today: '2026-10-21' }));
    expect(res.status).toBe(200);
    expect((await leftovers()).batches[0]).toMatchObject({ title: 'Lasagne', portionsMade: 6, storedIn: 'freezer' });
    expect((await left.POST(post({ action: 'add', title: ' ', portions: 6, storedIn: 'freezer' }))).status).toBe(422);
  });

  it('plans a batch into a slot over the plan route and eats it exactly once', async () => {
    const id = await recipe();
    const { leftover } = await (await cooked(post({ servings: 2, batch: { multiplier: 3, storedIn: 'freezer' }, today: '2026-10-21' }), ctx(id))).json(); // 4 portions
    const data = await (await week.GET(get(`api/plan?householdId=${H}&week=${WEEK}`))).json();
    const doc = { ...data.doc, entries: { '2026-10-22|dinner': { kind: 'leftovers', batchId: leftover.id, portions: 2 } } };
    const saved = await savePlan(post({ doc }));
    expect(saved.status).toBe(200);
    const planId = (await saved.json()).doc?.id ?? doc.id;
    const eaten = () => left.POST(post({ action: 'eaten', planId, date: '2026-10-22', mealType: 'dinner' }));
    expect(await (await eaten()).json()).toEqual({ applied: true, portionsLeft: 2 });
    expect(await (await eaten()).json()).toEqual({ applied: false, portionsLeft: 2 });
    expect((await (await week.GET(get(`api/plan?householdId=${H}&week=${WEEK}`))).json()).eatenSlots).toEqual(['2026-10-22|dinner']);
    // a second slot may not promise more than is left
    const greedy = { ...doc, entries: { ...doc.entries, '2026-10-23|dinner': { kind: 'leftovers', batchId: leftover.id, portions: 3 } } };
    expect((await savePlan(post({ doc: greedy }))).status).toBe(422);
  });

  it('is refused for a read-only household', async () => {
    outcome = ok({ readOnly: true });
    expect((await left.POST(post({ action: 'add', title: 'Soup', portions: 2, storedIn: 'fridge' }))).status).toBe(403);
  });
});
