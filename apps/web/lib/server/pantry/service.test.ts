import { describe, expect, it } from 'vitest';
import { buildDemoPantryService, DEMO_HOUSEHOLD_ID as H } from './deps';
import { InMemoryPantryRepository } from './repository';
import { InMemoryLeftoverSource, InMemoryPurchaseEventSource, InMemoryRecipeSummarySource, fixturePurchaseRecords, seedPantryItems } from './sources';
import { createPantryService } from './service';
import { defaultIngredientLookup } from './ingredients';

const NOW = '2026-10-19T12:00:00.000Z';

function demo(now = NOW) {
  return buildDemoPantryService(() => now);
}

describe('pantry view', () => {
  it('groups stock by category with expiry badges and stale prompts', async () => {
    const v = await demo().getView(H);
    expect(v.totalItems).toBe(14);
    expect(v.categories.map((c) => c.label)).toContain('Dairy and eggs');
    const all = v.categories.flatMap((c) => c.items);
    const milk = all.find((i) => i.name === 'milk')!;
    expect(milk.expiryBadge).toEqual({ tone: 'danger', label: 'Expired yesterday' });
    expect(all.find((i) => i.name === 'egg')!.expiryBadge?.label).toBe('Expires tomorrow');
    expect(v.staleItems.map((i) => i.name).sort()).toEqual(['carrot', 'lemon']);
    expect(v.expiring.map((e) => e.name)).toEqual(['milk', 'egg', 'cheddar']);
  });

  it('ranks recipes by pantry coverage with explanations and links', async () => {
    const v = await demo().getView(H);
    expect(v.suggestions.length).toBeGreaterThan(0);
    const top = v.suggestions[0]!;
    expect(top.href).toBe(`/recipes/${top.recipeId}`);
    expect(top.explanations[0]).toMatch(/covered by pantry/);
    for (let i = 1; i < v.suggestions.length; i++) {
      expect(v.suggestions[i - 1]!.coveragePct + v.suggestions[i - 1]!.urgencyPct).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists leftovers with suggested slots', async () => {
    const v = await demo().getView(H);
    const stew = v.leftovers.find((l) => l.title === 'Slow Winter Beef Stew')!;
    expect(stew.portionsRemaining).toBe(4);
    expect(stew.suggestions.length).toBeGreaterThan(0);
    expect(stew.useBy).toBe('2026-10-21');
  });
});

describe('stock actions', () => {
  it('adds, merges, corrects, confirms and removes', async () => {
    const svc = demo();
    const ing = defaultIngredientLookup().findByName('basmati rice')!;
    expect((await svc.addItem(H, { ingredientId: ing.id, value: 500, unit: 'g' })).ok).toBe(true);
    expect((await svc.addItem(H, { ingredientId: ing.id, value: 250, unit: 'g' })).ok).toBe(true);
    let v = await svc.getView(H);
    const rice = v.categories.flatMap((c) => c.items).filter((i) => i.name === 'basmati rice');
    expect(rice).toHaveLength(1);
    expect(rice[0]!.quantityLabel).toBe('750 g');

    expect((await svc.correctItem(H, { id: rice[0]!.id, value: 2, unit: 'kg', expiry: '2027-01-01' })).ok).toBe(true);
    v = await svc.getView(H);
    const fixed = v.categories.flatMap((c) => c.items).find((i) => i.name === 'basmati rice')!;
    expect(fixed.quantityLabel).toBe('2 kg');
    expect(fixed.expiry).toBe('2027-01-01');

    const lemon = v.staleItems.find((i) => i.name === 'lemon')!;
    expect((await svc.confirmItem(H, lemon.id)).ok).toBe(true);
    expect((await svc.getView(H)).staleItems.map((i) => i.name)).toEqual(['carrot']);

    expect((await svc.removeItem(H, fixed.id)).ok).toBe(true);
    expect((await svc.removeItem(H, fixed.id)).ok).toBe(false);
  });

  it('a zero correction removes the item', async () => {
    const svc = demo();
    const v = await svc.getView(H);
    const egg = v.categories.flatMap((c) => c.items).find((i) => i.name === 'egg')!;
    const res = await svc.correctItem(H, { id: egg.id, value: 0, unit: 'item' });
    expect(res).toEqual({ ok: true, message: 'Removed egg' });
    expect((await svc.getView(H)).totalItems).toBe(13);
  });

  it('validates input', async () => {
    const svc = demo();
    expect(await svc.addItem(H, { name: 'x', value: 0, unit: 'g' })).toEqual({ ok: false, error: 'Quantity must be more than zero.' });
    expect(await svc.addItem(H, { name: 'x', value: 1, unit: 'furlong' })).toEqual({ ok: false, error: 'Choose a unit.' });
    expect((await svc.addItem(H, { name: '', value: 1, unit: 'g' })).ok).toBe(false);
    expect((await svc.addItem(H, { name: 'x', value: 1, unit: 'g', expiry: '2026-02-31' })).ok).toBe(false);
    expect((await svc.addItem(H, { ingredientId: 'nope', value: 1, unit: 'g' })).ok).toBe(false);
    expect((await svc.updateSettings(H, { purchaseMode: 'sometimes' as never, staleAfterDays: 5 })).ok).toBe(false);
    expect((await svc.updateSettings(H, { purchaseMode: 'off', staleAfterDays: 0 })).ok).toBe(false);
  });

  it('staleness days setting changes which items need confirming', async () => {
    const svc = demo();
    expect((await svc.updateSettings(H, { purchaseMode: 'suggest', staleAfterDays: 4 })).ok).toBe(true);
    const names = (await svc.getView(H)).staleItems.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['lemon', 'carrot', 'rolled oats']));
    expect(names.length).toBeGreaterThan(2);
  });
});

describe('purchase adjustments', () => {
  it('suggest mode lists confirmable purchases, accept adds stock once, dismiss hides', async () => {
    const svc = demo();
    let v = await svc.getView(H);
    expect(v.settings.purchaseMode).toBe('suggest');
    expect(v.pending.map((p) => p.name)).toEqual(['chicken breast', 'basmati rice', 'Mixed salad bag']); // voided cheddar ignored
    const chicken = v.pending[0]!;
    expect((await svc.acceptAdjustment(H, chicken.eventId, '2026-10-22')).ok).toBe(true);
    expect((await svc.acceptAdjustment(H, chicken.eventId)).ok).toBe(false); // idempotent
    v = await svc.getView(H);
    const stock = v.categories.flatMap((c) => c.items).find((i) => i.name === 'chicken breast')!;
    expect(stock.quantityLabel).toBe('600 g');
    expect(stock.expiry).toBe('2026-10-22');
    const salad = v.pending.find((p) => p.name === 'Mixed salad bag')!;
    expect((await svc.dismissAdjustment(H, salad.eventId)).ok).toBe(true);
    expect((await svc.getView(H)).pending.map((p) => p.name)).toEqual(['basmati rice']);
    expect((await svc.getView(H)).totalItems).toBe(15);
  });

  it('off mode shows nothing and rejects accepts', async () => {
    const svc = demo();
    await svc.updateSettings(H, { purchaseMode: 'off', staleAfterDays: 14 });
    const v = await svc.getView(H);
    expect(v.pending).toEqual([]);
    expect((await svc.acceptAdjustment(H, 'e0e0e000-0000-4000-8000-000000000001')).ok).toBe(false);
  });

  it('auto mode applies precise purchases but still asks about approximate ones', async () => {
    const svc = demo();
    await svc.updateSettings(H, { purchaseMode: 'auto', staleAfterDays: 14 });
    const v = await svc.getView(H);
    const names = v.categories.flatMap((c) => c.items).map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['chicken breast', 'basmati rice']));
    expect(v.pending.map((p) => p.name)).toEqual(['Mixed salad bag']);
    expect((await svc.getView(H)).totalItems).toBe(16); // second read does not re-apply
  });
});

describe('leftovers helper', () => {
  it('plans slots for an ad-hoc batch and validates', async () => {
    const svc = demo();
    const res = await svc.planLeftovers(H, { title: 'Chilli', portionsCooked: 4, portionsEaten: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.portionsRemaining).toBe(3);
      expect(res.plan.suggestions).toHaveLength(3);
    }
    expect((await svc.planLeftovers(H, { title: 'Chilli', portionsCooked: 2, portionsEaten: 3 })).ok).toBe(false);
    expect((await svc.planLeftovers(H, { title: ' ', portionsCooked: 2, portionsEaten: 0 })).ok).toBe(false);
  });
});

describe('repository isolation', () => {
  it('does not leak stock between households', async () => {
    const ingredients = defaultIngredientLookup();
    const other = 'b2b2b201-0000-4000-8000-000000000001';
    const repo = new InMemoryPantryRepository({ householdId: H, items: seedPantryItems(H, NOW, ingredients) });
    const svc = createPantryService({
      repo, ingredients, now: () => NOW, recipes: new InMemoryRecipeSummarySource(),
      purchases: new InMemoryPurchaseEventSource(fixturePurchaseRecords(H, NOW, ingredients)),
      leftovers: new InMemoryLeftoverSource(() => NOW),
    });
    const v = await svc.getView(other);
    expect(v.totalItems).toBe(0);
    expect(v.pending).toEqual([]);
    expect(v.suggestions).toEqual([]);
  });
});
