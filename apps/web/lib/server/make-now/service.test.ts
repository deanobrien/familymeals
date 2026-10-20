import { describe, expect, it } from 'vitest';
import { deriveAll } from '../../shopping/engine';
import { buildDemoPantryService, DEMO_HOUSEHOLD_ID as H } from '../pantry/deps';
import { defaultIngredientLookup } from '../pantry/ingredients';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { InMemoryShoppingRepository } from '../shopping/repository';
import { createMakeNowService } from './service';

const NOW = '2026-10-19T12:00:00.000Z';
const USER = 'a1a1a102-0000-4000-8000-000000000001';
const converter = getIngredientCatalogue().converter;

function setup(exclusions: string[] = [], withheld = 0) {
  const pantry = buildDemoPantryService(() => NOW);
  const shopping = new InMemoryShoppingRepository({ converter });
  const svc = createMakeNowService({
    pantry, shopping, ingredients: defaultIngredientLookup(), converter, now: () => NOW,
    loadHousehold: async () => ({ household: { hardExclusions: exclusions.map((ingredientName) => ({ ingredientName, kind: 'allergy' as const })) }, withheldExclusions: withheld }),
  });
  return { svc, shopping };
}
const listItems = async (shopping: InMemoryShoppingRepository) => deriveAll((await shopping.snapshot(H)).state, { converter }).filter((v) => !v.item.removed);

describe('make now: ranking', () => {
  it('suggests recipes the demo pantry covers, best first, with coverage and missing items', async () => {
    const { svc } = setup();
    const v = await svc.getView(H, { limit: 30, minCoverage: 0.2 });
    expect(v.items.length).toBeGreaterThan(0);
    for (const it of v.items) {
      expect(it.coveragePct).toBeGreaterThanOrEqual(20);
      expect(it.coveragePct).toBeLessThanOrEqual(100);
      expect(it.href).toBe(`/recipes/${it.recipeId}`);
      expect(it.makeable).toBe(it.missing.length === 0 && it.coveragePct >= 100);
    }
    // fully makeable recipes never come after one that still needs shopping
    const firstNeedy = v.items.findIndex((i) => !i.makeable);
    if (firstNeedy >= 0) expect(v.items.slice(firstNeedy).some((i) => i.makeable)).toBe(false);
    expect(v.pantryEmpty).toBe(false);
    expect(v.exclusionsActive).toBe(false);
  });

  it('respects the limit', async () => {
    const { svc } = setup();
    expect((await svc.getView(H, { limit: 2, minCoverage: 0 })).items.length).toBeLessThanOrEqual(2);
  });
});

describe('make now: allergy exclusions', () => {
  it('hides every recipe that contains an excluded ingredient and counts them, fail-safe', async () => {
    const open = await setup().svc.getView(H, { limit: 30, minCoverage: 0.2 });
    const target = open.items.find((i) => i.covered.length > 0)!;
    const word = target.covered[0]!;
    const { svc } = setup([word]);
    const v = await svc.getView(H, { limit: 30, minCoverage: 0.2 });
    expect(v.exclusionsActive).toBe(true);
    expect(v.hiddenByAllergy).toBeGreaterThan(0);
    expect(v.items.find((i) => i.recipeId === target.recipeId)).toBeUndefined();
    for (const it of v.items) {
      expect([...it.covered, ...it.missing.map((m) => m.name)].some((n) => n.toLowerCase().includes(word.toLowerCase()))).toBe(false);
    }
  });

  it('reports the withheld count so clients can show the consent notice', async () => {
    const v = await setup([], 2).svc.getView(H, { minCoverage: 0 });
    expect(v.withheldExclusions).toBe(2);
    expect(v.exclusionsActive).toBe(false);
  });
});

describe('make now: add missing to the shopping list', () => {
  it('adds what is missing, and a repeat (or double tap) changes nothing', async () => {
    const { svc, shopping } = setup();
    const v = await svc.getView(H, { limit: 30, minCoverage: 0.2 });
    const needy = v.items.find((i) => i.missing.length > 0)!;
    expect(needy).toBeDefined();
    const first = await svc.addMissing(H, USER, needy.recipeId);
    expect(first).toMatchObject({ ok: true });
    const after = await listItems(shopping);
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(needy.missing.length);
    expect(after.every((l) => /^For /.test(l.item.notes ?? ''))).toBe(true);
    const second = await svc.addMissing(H, USER, needy.recipeId);
    expect(second).toMatchObject({ ok: true, added: 0 });
    expect(await listItems(shopping)).toHaveLength(after.length);
    await Promise.all([svc.addMissing(H, USER, needy.recipeId), svc.addMissing(H, USER, needy.recipeId)]);
    expect(await listItems(shopping)).toHaveLength(after.length);
  });

  it('skips items already outstanding on the list', async () => {
    const { svc, shopping } = setup();
    const v = await svc.getView(H, { limit: 30, minCoverage: 0.2 });
    const needy = v.items.find((i) => i.missing.length > 0)!;
    await svc.addMissing(H, USER, needy.recipeId);
    const before = (await listItems(shopping)).length;
    // another recipe that shares a missing line must not duplicate it
    for (const other of v.items.filter((i) => i.recipeId !== needy.recipeId && i.missing.length > 0)) await svc.addMissing(H, USER, other.recipeId);
    const names = (await listItems(shopping)).map((l) => l.item.displayName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(before);
  });

  it('refuses an unknown recipe and says so when nothing is missing', async () => {
    const { svc } = setup();
    expect(await svc.addMissing(H, USER, 'nope')).toMatchObject({ ok: false });
    const v = await svc.getView(H, { limit: 30, minCoverage: 0 });
    const done = v.items.find((i) => i.makeable);
    if (done) expect(await svc.addMissing(H, USER, done.recipeId)).toMatchObject({ ok: true, added: 0 });
  });
});
