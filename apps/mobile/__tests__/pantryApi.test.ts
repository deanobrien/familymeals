import { acceptAdjustment, addItem, correctItem, expiryError, fetchPantry, parsePantryView, parseQuantity, planLeftovers } from '@/lib/pantryApi';
import type { ServerApi } from '@/lib/serverApi';

function fakeApi(handler: (method: string, path: string, payload: unknown) => unknown) {
  const calls: Array<{ method: string; path: string; payload: unknown }> = [];
  const api: ServerApi = {
    configured: true,
    get: async (path, query) => { calls.push({ method: 'GET', path, payload: query }); return handler('GET', path, query) as never; },
    post: async (path, body) => { calls.push({ method: 'POST', path, payload: body }); return handler('POST', path, body) as never; },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls };
}

describe('parsePantryView', () => {
  it('reads a full view', () => {
    const v = parsePantryView({
      view: {
        settings: { purchaseMode: 'auto', staleAfterDays: 7 },
        totalItems: 1,
        categories: [{ category: 'dairy_eggs', label: 'Dairy and eggs', items: [{ id: 'i1', name: 'milk', quantityLabel: '500 ml', value: 500, unit: 'ml', expiry: '2026-10-21', expiryBadge: { tone: 'danger', label: 'Expires today' }, status: 'confident', confidenceMessage: '', stale: false }] }],
        staleItems: [], expiring: [{ id: 'i1', name: 'milk', quantityLabel: '500 ml', expiry: '2026-10-21', daysLeft: 0, expired: false, badge: { tone: 'danger', label: 'Expires today' } }],
        suggestions: [{ recipeId: 'r1', title: 'Pancakes', coveragePct: 80, covered: ['milk'], missing: ['flour'], headline: '80% covered' }],
        pending: [{ eventId: 'e1', name: 'rice', quantityLabel: '1 kg', reason: 'bought' }],
        leftovers: [{ key: 'k', title: 'Stew', portionsRemaining: 2, useBy: '2026-10-23', suggestions: ['a'], advice: [], summary: '2 left' }],
      },
    });
    expect(v.settings).toEqual({ purchaseMode: 'auto', staleAfterDays: 7 });
    expect(v.categories[0]!.items[0]).toMatchObject({ id: 'i1', value: 500, unit: 'ml', expiryBadge: { tone: 'danger' } });
    expect(v.expiring[0]!.badge.label).toBe('Expires today');
    expect(v.suggestions[0]).toMatchObject({ coveragePct: 80, missing: ['flour'] });
    expect(v.pending[0]!.eventId).toBe('e1');
    expect(v.leftovers[0]!.summary).toBe('2 left');
  });

  it('is defensive about junk, unknown tones and missing sections', () => {
    const v = parsePantryView({
      view: {
        settings: { purchaseMode: 'weird', staleAfterDays: 'x' },
        categories: [{ items: [null, { id: 1 }, { id: 'ok', name: 'salt', expiryBadge: { tone: 'purple', label: 'Soon' } }] }, 'nope'],
        expiring: [{ id: 'x' }], suggestions: [{}], pending: [{ eventId: 1 }], leftovers: [{}],
      },
    });
    expect(v.settings).toEqual({ purchaseMode: 'suggest', staleAfterDays: 14 });
    expect(v.categories).toHaveLength(1);
    expect(v.categories[0]!.category).toBe('other');
    expect(v.categories[0]!.items.map((i) => i.id)).toEqual(['ok']);
    expect(v.categories[0]!.items[0]!.expiryBadge).toEqual({ tone: 'neutral', label: 'Soon' });
    expect(v.totalItems).toBe(1);
    expect(v.expiring).toEqual([]);
    expect(v.suggestions).toEqual([]);
    expect(v.pending).toEqual([]);
    expect(v.leftovers).toEqual([]);
    expect(v.staleItems).toEqual([]);
  });

  it('throws on an unexpected body', () => {
    expect(() => parsePantryView(null)).toThrow(/unexpected/);
    expect(() => parsePantryView({ nope: 1 })).toThrow(/unexpected/);
  });
});

describe('validation helpers', () => {
  it('parses quantities', () => {
    expect(parseQuantity(' 2,5 ')).toBe(2.5);
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });
  it('validates expiry dates', () => {
    expect(expiryError('')).toBeNull();
    expect(expiryError('2026-11-05')).toBeNull();
    expect(expiryError('5/11/2026')).toMatch(/YYYY-MM-DD/);
    expect(expiryError('2026-02-31')).toMatch(/real date/);
  });
});

describe('calls', () => {
  it('GETs the view with the household', async () => {
    const { api, calls } = fakeApi(() => ({ view: { categories: [] } }));
    await fetchPantry(api, 'hh');
    expect(calls[0]).toEqual({ method: 'GET', path: '/api/pantry', payload: { householdId: 'hh' } });
  });

  it('POSTs actions with the household and returns the server message', async () => {
    const { api, calls } = fakeApi(() => ({ ok: true, message: 'Added rice' }));
    expect(await addItem(api, 'hh', { name: 'rice', value: 1, unit: 'kg' })).toBe('Added rice');
    await correctItem(api, 'hh', { id: 'i', value: 2, unit: 'g', expiry: null });
    await acceptAdjustment(api, 'hh', 'e1');
    expect(calls.map((c) => (c.payload as { action: string }).action)).toEqual(['add', 'correct', 'acceptAdjustment']);
    expect(calls[1]!.payload).toEqual({ action: 'correct', householdId: 'hh', id: 'i', value: 2, unit: 'g', expiry: null });
    expect(calls[2]!.payload).toEqual({ action: 'acceptAdjustment', householdId: 'hh', eventId: 'e1' });
  });

  it('parses a leftovers plan and rejects a bad one', async () => {
    const good = fakeApi(() => ({ ok: true, plan: { key: 'adhoc', title: 'Chilli', portionsRemaining: 4, useBy: '2026-10-23', suggestions: [], advice: [], summary: 's' } }));
    expect((await planLeftovers(good.api, 'hh', { title: 'Chilli', portionsCooked: 6, portionsEaten: 2 })).portionsRemaining).toBe(4);
    const bad = fakeApi(() => ({ ok: true }));
    await expect(planLeftovers(bad.api, 'hh', { title: 'x', portionsCooked: 1, portionsEaten: 0 })).rejects.toThrow(/unexpected/);
  });
});
