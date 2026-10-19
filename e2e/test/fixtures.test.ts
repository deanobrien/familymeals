import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { HouseholdSeed, Quantity, ReceiptFixture, RecipeFixture, PurchaseEvent } from '../fixtures-src/contract.js';

const root = join(import.meta.dirname, '..', 'fixtures');
const load = (...p: string[]) => JSON.parse(readFileSync(join(root, ...p), 'utf8'));
const list = (d: string, suffix: string) => readdirSync(join(root, d)).filter((f) => f.endsWith(suffix));

describe('zod mirror sanity', () => {
  it('rejects malformed quantities', () => {
    expect(Quantity.safeParse({ kind: 'range', min: 3, max: 2, originalText: 'x' }).success).toBe(false);
    expect(Quantity.safeParse({ kind: 'approximate', approxLabel: 'pinch', unit: 'g', originalText: 'x' }).success).toBe(false);
    expect(Quantity.safeParse({ kind: 'to_taste', value: 1, originalText: 'x' }).success).toBe(false);
    expect(Quantity.safeParse({ kind: 'exact', originalText: 'x' }).success).toBe(false);
  });
  it('PurchaseEvent keeps pence integer', () => {
    const base = { id: 'c0c0c0c0-0000-4000-8000-000000000001', shoppingListItemId: 'c0c0c0c0-0000-4000-8000-000000000002', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' }, createdBy: 'c0c0c0c0-0000-4000-8000-000000000003', createdAt: '2026-10-19T10:00:00Z' };
    expect(PurchaseEvent.safeParse({ ...base, actualPricePence: 120 }).success).toBe(true);
    expect(PurchaseEvent.safeParse({ ...base, actualPricePence: 1.2 }).success).toBe(false);
  });
});

describe('recipe fixtures', () => {
  const files = list('recipes', '.expected.json');
  it('has 8 fixtures', () => expect(files).toHaveLength(8));
  it.each(files)('%s validates and its images exist', (f) => {
    const fx = RecipeFixture.parse(load('recipes', f));
    for (const img of [fx.image, ...fx.extraPages]) expect(existsSync(join(root, 'recipes', img))).toBe(true);
  });
  it('covers the required scenarios', () => {
    const all = files.map((f) => RecipeFixture.parse(load('recipes', f)));
    const kinds = new Set(all.flatMap((r) => r.expected.ingredients.map((i) => i.quantity.kind)));
    expect([...kinds].sort()).toEqual(['approximate', 'exact', 'range', 'to_taste', 'unparsed']);
    expect(all.some((r) => r.extraPages.length > 0)).toBe(true);
    expect(all.filter((r) => r.expectedConfidence === 'low')).toHaveLength(1);
  });
  it('blurry image has clearly lower contrast than a clean one', async () => {
    const sd = async (f: string) => (await sharp(join(root, 'recipes', f)).greyscale().stats()).channels[0]!.stdev;
    expect(await sd('05-blurry-curry.png')).toBeLessThan((await sd('01-tomato-pasta.png')) / 2);
  });
});

describe('receipt fixtures', () => {
  const files = list('receipts', '.expected.json');
  it('has 4 fixtures', () => expect(files).toHaveLength(4));
  it.each(files)('%s validates, sums to total in integer pence, has non-matching line', (f) => {
    const r = ReceiptFixture.parse(load('receipts', f));
    expect(existsSync(join(root, 'receipts', r.image))).toBe(true);
    expect(r.lines.reduce((s, l) => s + l.linePricePence, 0)).toBe(r.totalPence);
    expect(r.lines.some((l) => l.expectedIngredient === null)).toBe(true);
    for (const l of r.lines) if (l.kind !== 'item') expect(l.linePricePence).toBeLessThan(0);
  });
  it('includes a multi-buy discount', () => {
    const kinds = files.flatMap((f) => ReceiptFixture.parse(load('receipts', f)).lines.map((l) => l.kind));
    expect(kinds).toContain('multibuy_discount');
  });
});

describe('household seeds (isolation)', () => {
  const A = HouseholdSeed.parse(load('households', 'household-a.json'));
  const B = HouseholdSeed.parse(load('households', 'household-b.json'));
  const ids = (s: typeof A) => {
    const out = [s.household.id, s.mealPlan.id, s.shoppingList.id];
    out.push(...s.members.map((m) => m.userId), ...s.recipes.map((r) => r.id), ...s.recipeIngredients.map((r) => r.id), ...s.mealPlan.meals.map((m) => m.id), ...s.shoppingList.items.map((i) => i.id));
    return out;
  };
  it('share no ids or emails', () => {
    const a = new Set(ids(A));
    expect(ids(B).filter((x) => a.has(x))).toEqual([]);
    expect(new Set(ids(A)).size).toBe(ids(A).length);
    const emails = new Set(A.members.map((m) => m.email));
    expect(B.members.filter((m) => emails.has(m.email))).toEqual([]);
  });
  it.each([['A', A], ['B', B]] as const)('%s is internally consistent', (_n, s) => {
    const rid = new Set(s.recipes.map((r) => r.id));
    expect(s.recipes.every((r) => r.householdId === s.household.id)).toBe(true);
    expect(s.mealPlan.meals.every((m) => rid.has(m.recipeId))).toBe(true);
    expect(s.recipeIngredients.every((i) => rid.has(i.recipeId))).toBe(true);
    expect(s.shoppingList.planId).toBe(s.mealPlan.id);
    expect(s.members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });
});
