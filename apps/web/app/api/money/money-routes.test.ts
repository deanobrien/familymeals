import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';
import { acceptsBearer } from '../../../lib/server/auth/routes';
import type { ListCompareView, PriceHistoryView, SpendingView } from '../../../lib/money/types';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const spending = await import('./spending/route');
const csv = await import('./spending/csv/route');
const compare = await import('./compare/route');
const prices = await import('./prices/route');
let n = 0;
let H = '';

beforeEach(() => {
  H = `dd${String(++n).padStart(6, '0')}-0000-4000-8000-0000000000dd`;
  outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

const url = (p: string, qs = '') => `http://t/api/money/${p}?householdId=${H}${qs}`;
const post = (route: { POST: (r: Request) => Promise<Response> }, p: string, body: Record<string, unknown>) =>
  route.POST(new Request(`http://t/api/money/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ householdId: H, ...body }) }));

describe('/api/money', () => {
  it('is a bearer family and needs a signed-in caller', async () => {
    for (const p of ['/api/money/spending', '/api/money/spending/csv', '/api/money/compare', '/api/money/prices']) expect(acceptsBearer(p, 'Bearer abc')).toBe(true);
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await spending.GET(new Request(url('spending')))).status).toBe(401);
    expect((await post(spending, 'spending', { action: 'add' })).status).toBe(401);
    expect((await compare.GET(new Request(url('compare')))).status).toBe(401);
  });

  it('GET spending returns the weekly and monthly view with honest labelling data', async () => {
    const res = await spending.GET(new Request(url('spending', '&weeks=6')));
    expect(res.status).toBe(200);
    const { view } = (await res.json()) as { view: SpendingView };
    expect(view.weeks).toHaveLength(6);
    expect(view.months.length).toBeGreaterThan(0);
    expect(view.notes.join(' ')).toMatch(/estimates/);
    expect(view).toMatchObject({ weeklyBudgetPence: expect.anything(), thisWeek: expect.anything(), categoryChoices: expect.any(Array), stores: expect.any(Array) });
  });

  it('adds, shows and deletes a manual entry; refuses bad input and read-only households', async () => {
    const add = await post(spending, 'spending', { action: 'add', date: '2026-10-21', amountPence: 1234, retailer: 'Market stall', category: 'Fruit & veg', note: 'berries' });
    expect(add.status).toBe(200);
    const { entry } = (await add.json()) as { entry: { id: string; amountPence: number } };
    expect(entry.amountPence).toBe(1234);
    let view = ((await (await spending.GET(new Request(url('spending')))).json()) as { view: SpendingView }).view;
    expect(view.recent.find((r) => r.id === entry.id)).toMatchObject({ source: 'manual', totalPence: 1234, shop: 'Market stall' });
    expect(view.totals.manualPence).toBeGreaterThanOrEqual(1234);
    for (const bad of [{ date: 'nope', amountPence: 100 }, { date: '2026-10-21', amountPence: 0 }, { date: '2026-10-21', amountPence: 12.5 }, { date: '2026-10-21', amountPence: '5' }, { date: '2026-10-21', amountPence: 100, storeId: 'not-a-uuid' }]) {
      const r = await post(spending, 'spending', { action: 'add', ...bad });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    }
    const foreign = await post(spending, 'spending', { action: 'add', date: '2026-10-21', amountPence: 100, storeId: '99999999-9999-4999-8999-999999999999' });
    expect(foreign.status).toBe(422);
    expect((await post(spending, 'spending', { action: 'nope' })).status).toBe(400);
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    expect((await post(spending, 'spending', { action: 'delete', id: entry.id })).status).toBe(403);
    expect((await spending.GET(new Request(url('spending')))).status).toBe(200); // reads stay open
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
    expect((await post(spending, 'spending', { action: 'delete', id: entry.id })).status).toBe(200);
    view = ((await (await spending.GET(new Request(url('spending')))).json()) as { view: SpendingView }).view;
    expect(view.recent.find((r) => r.id === entry.id)).toBeUndefined();
    expect((await post(spending, 'spending', { action: 'update', id: '00000000-0000-4000-8000-00000000dead', date: '2026-10-21', amountPence: 5 })).status).toBe(404);
  });

  it('links a retailer to a store only with a real store of the household', async () => {
    expect((await post(spending, 'spending', { action: 'link', retailer: 'TESCO EXTRA', storeId: '99999999-9999-4999-8999-999999999999' })).status).toBe(422);
    expect((await post(spending, 'spending', { action: 'link' })).status).toBe(400);
    expect((await post(spending, 'spending', { action: 'link', retailer: 'TESCO EXTRA', storeId: null })).status).toBe(200); // removing nothing is fine
  });

  it('serves the spend as a CSV download', async () => {
    await post(spending, 'spending', { action: 'add', date: '2026-10-21', amountPence: 250, note: '=evil' });
    const res = await csv.GET(new Request(url('spending/csv', '&weeks=4')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const text = await res.text();
    expect(text.split('\r\n')[0]).toBe('Date,Week starting,Source,Shop,Category,Amount (GBP),Note');
    expect(text).toContain("'=evil");
  });

  it('GET compare answers for the active list; prices answers per ingredient and refuses unknown ones', async () => {
    const c = await compare.GET(new Request(url('compare')));
    expect(c.status).toBe(200);
    const { view } = (await c.json()) as { view: ListCompareView };
    expect(view).toMatchObject({ totalItems: expect.any(Number), shops: expect.any(Array), badges: expect.any(Object), note: expect.any(String) });
    expect((await prices.GET(new Request(url('prices')))).status).toBe(404);
    expect((await prices.GET(new Request(url('prices', '&ingredientId=nope')))).status).toBe(404);
    expect((await post(prices, 'prices', { action: 'add', ingredientId: 'nope', retailer: 'x', pricePence: 100, packValue: 1, packUnit: 'kg' })).status).toBe(422);
    expect((await post(prices, 'prices', { action: 'zzz' })).status).toBe(400);
  });

  it('records a price you saw and shows it in that ingredient\'s history', async () => {
    const { getIngredientCatalogue } = await import('../../../lib/server/refdata/catalogue');
    const rice = getIngredientCatalogue().all.find((i) => /rice/i.test(i.name))!;
    const add = await post(prices, 'prices', { action: 'add', ingredientId: rice.id, retailer: 'Corner shop', pricePence: 199, packValue: 1, packUnit: 'kg' });
    expect(add.status).toBe(200);
    const { view } = (await (await prices.GET(new Request(url('prices', `&ingredientId=${rice.id}`)))).json()) as { view: PriceHistoryView };
    expect(view.history[0]).toMatchObject({ label: 'Corner shop', pricePence: 199, kind: 'user_confirmed', unitText: '£1.99 per kg' });
    expect(view.comparison.note).toMatch(/Only Corner shop/);
  });
});
