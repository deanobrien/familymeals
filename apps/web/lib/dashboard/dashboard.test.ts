import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEED_DASHBOARD } from './seed';
import { InMemoryDashboardSource, basketLabel, relativeDay } from './source';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../e2e/fixtures/households/household-a.json'), 'utf8'),
);

describe('InMemoryDashboardSource', () => {
  it('matches the household-a fixture', async () => {
    const d = await new InMemoryDashboardSource().load();
    expect(d.householdName).toBe(fixture.household.name);
    expect(d.weekStart).toBe(fixture.mealPlan.weekStart);
    expect(d.plannedMeals).toBe(fixture.mealPlan.meals.length);
    expect(d.shopping.total).toBe(fixture.shoppingList.items.length);
  });

  it('labels the basket as a partial estimate when items are unpriced', async () => {
    const d = await new InMemoryDashboardSource().load();
    expect(d.basket?.kind).toBe('partial');
    expect(d.basket?.pence).toBe(1100);
    expect(basketLabel(d.basket!)).toContain('4 of 5');
  });

  it('returns copies, not the shared seed', async () => {
    const d = await new InMemoryDashboardSource().load();
    d.plannedMeals = 99;
    expect(SEED_DASHBOARD.plannedMeals).toBe(3);
  });

  it('supports empty data and failure', async () => {
    const empty = { ...SEED_DASHBOARD, plannedMeals: 0, basket: null, activity: [], tasks: [] };
    expect((await new InMemoryDashboardSource({ data: empty }).load()).basket).toBeNull();
    await expect(new InMemoryDashboardSource({ fail: true }).load()).rejects.toThrow();
  });
});

describe('relativeDay', () => {
  const now = new Date('2026-10-19T18:00:00Z');
  it('formats', () => {
    expect(relativeDay('2026-10-19T09:00:00Z', now)).toBe('today');
    expect(relativeDay('2026-10-18T09:00:00Z', now)).toBe('yesterday');
    expect(relativeDay('2026-10-15T09:00:00Z', now)).toBe('4 days ago');
  });
});
