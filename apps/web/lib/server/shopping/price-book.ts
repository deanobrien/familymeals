import 'server-only';
import type { CanonicalIngredient } from '@fr/domain';
import type { PriceBook } from '../../shopping/prices';
import { getPriceStore, type PriceStore } from '../prices/store';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';

const nameKey = (s: string) => `name:${s.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/** Every priced ingredient for this household, plus a by-name index for hand-added items (simple plurals). */
export function buildPriceBook(
  householdId: string,
  store: PriceStore = getPriceStore(),
  catalogue: Pick<IngredientCatalogue, 'get'> = getIngredientCatalogue(),
): PriceBook {
  const observations = store.observationsFor(householdId).filter((o) => o.ingredientId !== undefined);
  const ingredients: CanonicalIngredient[] = [];
  const nameIndex: Record<string, string> = {};
  const priced: CanonicalIngredient[] = [];
  for (const id of new Set(observations.map((o) => o.ingredientId!))) {
    const ing = catalogue.get(id);
    if (!ing) continue;
    priced.push(ing);
    ingredients.push({ ...ing, aliases: [] });
  }
  // Exact names and aliases win over plural guesses ("bananas" -> banana, never a "banana chips" alias).
  for (const ing of priced) for (const n of [ing.name, ...ing.aliases]) nameIndex[nameKey(n)] ??= ing.id;
  for (const ing of priced) {
    for (const n of [ing.name, ...ing.aliases]) for (const v of [`${n}s`, `${n}es`]) nameIndex[nameKey(v)] ??= ing.id;
  }
  return { observations, ingredients, nameIndex };
}
