import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';
import type { PantryView } from '../../../lib/pantry/types';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const { GET, POST } = await import('./route');
let n = 0;
let H = '';

beforeEach(() => {
  // A fresh household per test: the in-memory pantry service is per household and seeded with the demo stock.
  H = `bb${String(++n).padStart(6, '0')}-0000-4000-8000-0000000000bb`;
  outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null } };
});

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://t/api/pantry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ householdId: H, ...body }) }));
const view = async (): Promise<PantryView> => ((await (await GET(new Request(`http://t/api/pantry?householdId=${H}`))).json()) as { view: PantryView }).view;
const allItems = (v: PantryView) => v.categories.flatMap((c) => c.items);
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('auth', () => {
  it('GET and POST need a signed-in caller', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const g = await GET(new Request('http://t/api/pantry'));
    expect(g.status).toBe(401);
    expect((await errorOf(g)).code).toBe('UNAUTHENTICATED');
    expect((await post({ action: 'confirm', id: 'x' })).status).toBe(401);
  });

  it('refuses a household the caller is not in (403)', async () => {
    outcome = { ok: false, status: 403, message: 'not a member' };
    expect((await post({ action: 'remove', id: 'x' })).status).toBe(403);
  });

  it('refuses writes for a read-only household but still reads', async () => {
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null } };
    const res = await post({ action: 'add', name: 'rice', value: 1, unit: 'kg' });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('READ_ONLY');
    expect((await GET(new Request(`http://t/api/pantry?householdId=${H}`))).status).toBe(200);
  });

  it('rejects a non-JSON body and unknown actions', async () => {
    const bad = await POST(new Request('http://t/api/pantry', { method: 'POST', body: 'nope' }));
    expect(bad.status).toBe(400);
    expect((await post({ action: 'explode' })).status).toBe(400);
  });
});

describe('GET /api/pantry', () => {
  it('returns categories, stale, expiring, suggestions, pending and leftovers', async () => {
    const v = await view();
    expect(v.householdId).toBe(H);
    expect(v.categories.length).toBeGreaterThan(3);
    expect(v.totalItems).toBe(14);
    expect(v.staleItems.map((i) => i.name).sort()).toEqual(['carrot', 'lemon']);
    expect(v.expiring.length).toBeGreaterThan(0);
    expect(v.expiring[0]).toHaveProperty('badge.tone');
    expect(Array.isArray(v.suggestions)).toBe(true);
    expect(v.pending.length).toBe(3);
    expect(v.leftovers.length).toBe(2);
    expect(v.settings.purchaseMode).toBe('suggest');
  });
});

describe('item actions', () => {
  it('add appears in the view; bad input is refused with the message', async () => {
    const res = await post({ action: 'add', name: 'Quinoa', value: 250, unit: 'g', expiry: '2027-01-02' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toBe('Added Quinoa');
    const added = allItems(await view()).find((i) => i.name === 'Quinoa');
    expect(added).toMatchObject({ quantityLabel: '250 g', expiry: '2027-01-02' });

    const bad = await post({ action: 'add', name: 'x', value: '5', unit: 'g' });
    expect(bad.status).toBe(422);
    expect((await errorOf(bad)).message).toBe('Enter a quantity as a number.');
    expect((await errorOf(await post({ action: 'add', name: 'x', value: 1, unit: 'g', expiry: '2027-13-40' }))).message).toBe('Expiry must be a valid date.');
    expect((await errorOf(await post({ action: 'add', value: 1, unit: 'g' }))).message).toBe('Choose an ingredient or type a name.');
  });

  it('add by canonical ingredient id uses its name', async () => {
    const onion = allItems(await view()).find((i) => i.name === 'onion')!;
    const res = await post({ action: 'add', ingredientId: onion.ingredientId, value: 2, unit: 'item' });
    expect(res.status).toBe(200);
    expect((await errorOf(await post({ action: 'add', ingredientId: 'nope', value: 1, unit: 'g' }))).message).toBe('Unknown ingredient.');
  });

  it('correct updates quantity and clears the expiry', async () => {
    const egg = allItems(await view()).find((i) => i.name === 'egg')!;
    expect(egg.expiry).toBeTruthy();
    const res = await post({ action: 'correct', id: egg.id, value: 4, unit: 'item', expiry: null });
    expect(res.status).toBe(200);
    const after = allItems(await view()).find((i) => i.id === egg.id)!;
    expect(after.quantityLabel).toBe('4 item');
    expect(after.expiry).toBeUndefined();
    expect((await post({ action: 'correct', id: 'missing', value: 1, unit: 'g' })).status).toBe(422);
    expect((await post({ action: 'correct', value: 1, unit: 'g' })).status).toBe(400);
  });

  it('confirm clears a stale item', async () => {
    const [stale] = (await view()).staleItems;
    expect(stale).toBeTruthy();
    expect((await post({ action: 'confirm', id: stale!.id })).status).toBe(200);
    expect((await view()).staleItems.find((i) => i.id === stale!.id)).toBeUndefined();
    expect((await post({ action: 'confirm', id: 'nope' })).status).toBe(422);
  });

  it('remove deletes the item', async () => {
    const before = await view();
    const item = allItems(before)[0]!;
    expect((await post({ action: 'remove', id: item.id })).status).toBe(200);
    expect((await view()).totalItems).toBe(before.totalItems - 1);
    expect((await post({ action: 'remove', id: item.id })).status).toBe(422);
  });
});

describe('settings', () => {
  it('saves valid settings and validates them', async () => {
    expect((await post({ action: 'settings', purchaseMode: 'off', staleAfterDays: 30 })).status).toBe(200);
    const v = await view();
    expect(v.settings).toEqual({ purchaseMode: 'off', staleAfterDays: 30 });
    expect(v.staleItems).toHaveLength(0);
    expect((await errorOf(await post({ action: 'settings', purchaseMode: 'sometimes', staleAfterDays: 5 }))).message).toBe('Choose off, suggest or auto.');
    expect((await errorOf(await post({ action: 'settings', purchaseMode: 'off', staleAfterDays: 0 }))).message).toMatch(/between 1 and 730/);
    expect((await post({ action: 'settings', staleAfterDays: 5 })).status).toBe(422);
  });
});

describe('purchase adjustments', () => {
  it('accept (with expiry) adds stock once; dismiss hides a pending line', async () => {
    let v = await view();
    const chicken = v.pending.find((p) => p.name === 'chicken breast')!;
    expect((await post({ action: 'acceptAdjustment', eventId: chicken.eventId, expiry: '2027-02-03' })).status).toBe(200);
    expect((await post({ action: 'acceptAdjustment', eventId: chicken.eventId })).status).toBe(422);
    v = await view();
    expect(allItems(v).find((i) => i.name === 'chicken breast')).toMatchObject({ quantityLabel: '600 g', expiry: '2027-02-03' });

    const salad = v.pending.find((p) => p.name === 'Mixed salad bag')!;
    expect((await post({ action: 'dismissAdjustment', eventId: salad.eventId })).status).toBe(200);
    expect((await view()).pending.map((p) => p.name)).toEqual(['basmati rice']);
    expect((await post({ action: 'acceptAdjustment' })).status).toBe(400);
    expect((await errorOf(await post({ action: 'acceptAdjustment', eventId: 'e', expiry: 'soon' }))).message).toBe('Expiry must be a valid date.');
  });
});

describe('leftovers', () => {
  it('plans a leftover batch and validates input', async () => {
    const res = await post({ action: 'leftovers', title: 'Chilli', portionsCooked: 6, portionsEaten: 2, keepDays: 3, freezable: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; plan: { title: string; portionsRemaining: number; suggestions: string[] } };
    expect(body.plan).toMatchObject({ title: 'Chilli', portionsRemaining: 4 });
    expect(body.plan.suggestions.length).toBeGreaterThan(0);
    expect((await errorOf(await post({ action: 'leftovers', title: 'Chilli', portionsCooked: 2, portionsEaten: 3 }))).message).toBe('You cannot have eaten more than you cooked.');
    expect((await errorOf(await post({ action: 'leftovers', title: ' ', portionsCooked: 2, portionsEaten: 1 }))).message).toBe('Name the meal.');
    expect((await errorOf(await post({ action: 'leftovers', title: 'x', portionsCooked: 'a', portionsEaten: 1 }))).message).toBe('Portions must be whole numbers.');
  });
});
