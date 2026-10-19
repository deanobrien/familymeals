import { describe, expect, it } from 'vitest';
import { loadSeed } from '@fr/refdata';
import ingredientsJson from '@fr/refdata/ingredients.json';
import { getIngredientCatalogue } from './catalogue';

describe('ingredient catalogue', () => {
  it('bundled data/out/ingredients.json matches @fr/refdata loadSeed()', () => {
    const ids = (xs: { id: string; name: string }[]) => xs.map((i) => [i.id, i.name]);
    expect(ids(ingredientsJson as { id: string; name: string }[])).toEqual(ids(loadSeed().ingredients));
  });

  it('matches conservatively and converts with density / unit weight', () => {
    const cat = getIngredientCatalogue();
    const onion = cat.matcher.match('onions');
    expect(onion.status).toBe('matched');
    expect(cat.get(onion.ingredientId!)?.name).toBe('onion');
    expect(cat.matcher.match('zzzz unknown thing').status).toBe('no_match');
    const g = cat.converter.convert({ kind: 'exact', value: 2, unit: 'item', originalText: '2' }, 'g', onion.ingredientId);
    expect(g).toMatchObject({ unit: 'g', value: 300 });
    expect(cat.converter.convert({ kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' }, 'g')).toMatchObject({ value: 1000 });
  });
});
