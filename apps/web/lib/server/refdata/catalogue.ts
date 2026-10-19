import 'server-only';
import type { CanonicalIngredient } from '@fr/domain';
import { createGramsConverter, createQuantityConverter, type GramsConverter, type QuantityConverter } from '@fr/engine/units';
import { IngredientMatcher } from '@fr/engine/normalise';
import ingredientsJson from '@fr/refdata/ingredients.json';

/**
 * Server-only canonical ingredient catalogue (DECISIONS D28).
 *
 * `@fr/refdata`'s loaders read files relative to `import.meta.url`, which breaks once webpack bundles them,
 * so apps/web imports the built `data/out/ingredients.json` through the package's `./ingredients.json`
 * export instead (no fs at runtime). `catalogue.test.ts` fails if that file drifts from `loadSeed()`.
 * Everything here is built once per process and shared by import, pantry and the planner.
 */
interface RefdataIngredient extends CanonicalIngredient {
  slug?: string;
  cofid?: unknown;
}

export interface IngredientCatalogue {
  readonly all: readonly CanonicalIngredient[];
  get(id: string): CanonicalIngredient | undefined;
  readonly matcher: IngredientMatcher;
  /** Unit conversion with density / unit-weight lookup (`@fr/engine/units`). */
  readonly converter: QuantityConverter;
  readonly grams: GramsConverter;
}

function toCanonical(r: RefdataIngredient): CanonicalIngredient {
  const out: CanonicalIngredient = { id: r.id, name: r.name, category: r.category, aliases: [...r.aliases] };
  if (r.densityGPerMl) out.densityGPerMl = r.densityGPerMl;
  if (r.unitWeightG) out.unitWeightG = r.unitWeightG;
  if (r.form) out.form = r.form;
  return out;
}

export function createIngredientCatalogue(records: readonly CanonicalIngredient[]): IngredientCatalogue {
  const all = records.map((r) => toCanonical(r));
  const byId = new Map(all.map((i) => [i.id, i]));
  const get = (id: string) => byId.get(id);
  return {
    all,
    get,
    matcher: new IngredientMatcher(all),
    converter: createQuantityConverter(get),
    grams: createGramsConverter(get),
  };
}

const KEY = Symbol.for('fr.refdata.catalogue');
type G = typeof globalThis & { [KEY]?: IngredientCatalogue };

/** Process-wide singleton over the @fr/refdata canonical ingredients. */
export function getIngredientCatalogue(): IngredientCatalogue {
  const g = globalThis as G;
  return (g[KEY] ??= createIngredientCatalogue(ingredientsJson as unknown as RefdataIngredient[]));
}
