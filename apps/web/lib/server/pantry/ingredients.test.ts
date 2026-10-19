import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import recipeData from './data/recipes.json';
import { createIngredientLookup, defaultIngredientLookup, type IngredientRecord } from './ingredients';

describe('recipe snapshot', () => {
  it('recipe snapshot matches the e2e recipe fixtures', () => {
    const dir = resolve(__dirname, '../../../../../e2e/fixtures/recipes');
    const titles = readdirSync(dir)
      .filter((f) => f.endsWith('.expected.json'))
      .sort()
      .map((f) => (JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as { expected: { title: string; ingredients: unknown[] } }).expected);
    expect(recipeData.map((r) => [r.title, r.lines.length])).toEqual(titles.map((t) => [t.title, t.ingredients.length]));
  });
});

describe('ingredient search', () => {
  const lookup = defaultIngredientLookup();
  it('ranks exact and prefix matches first and respects the limit', () => {
    const hits = lookup.search('onion', 5);
    expect(hits[0]?.name).toBe('onion');
    expect(hits.length).toBeLessThanOrEqual(5);
  });
  it('finds by alias and returns nothing for blank/garbage', () => {
    expect(lookup.search('scallion').map((h) => h.name)).toContain('spring onion');
    expect(lookup.search('   ')).toEqual([]);
    expect(lookup.search('zzzzqqq')).toEqual([]);
  });
  it('works over an arbitrary record set', () => {
    const l = createIngredientLookup([{ id: '1', name: 'tofu', category: 'meat_alternatives', aliases: ['bean curd'] }] as IngredientRecord[]);
    expect(l.search('curd')[0]?.id).toBe('1');
    expect(l.findByName('Bean Curd')?.name).toBe('tofu');
  });
});
