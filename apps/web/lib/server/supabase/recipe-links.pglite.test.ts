// IL1 (D223, D225): the real migrations on PGlite. save_recipe's explicit "not in list" and the exact-match backfill.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecipeInput } from '../../recipes/schema';
import { SupabaseRecipeRepository } from './recipe-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const ONION = '11000000-0000-4000-8000-000000000002';
const FLOUR = '11000000-0000-4000-8000-000000000003';
const BEEF = '11000000-0000-4000-8000-000000000004';
const PORK = '11000000-0000-4000-8000-000000000005';

const BACKFILL = readFileSync(
  fileURLToPath(new URL('../../../../../supabase/migrations/20261020002301_backfill_recipe_ingredient_links.sql', import.meta.url)),
  'utf8',
);

let pg: PgliteSupabase;
const repo = () => new SupabaseRecipeRepository({ client: pg.client, householdId: HA, userId: ALICE });

type Line = RecipeInput['ingredients'][number];
const line = (name: string, ingredientId?: string | null): Line => ({
  name,
  ...(ingredientId !== undefined ? { ingredientId } : {}),
  quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' },
  optional: false,
});
const recipe = (title: string, ingredients: Line[]): RecipeInput => ({
  title, description: '', imageUrl: null, sourceAttribution: '', sourceUrl: '', originalText: '', prepMinutes: null,
  cookMinutes: null, servings: 2, cuisine: '', mealType: 'dinner', diet: 'vegan', tags: [], ingredients, steps: ['Cook.'],
});
const ids = async (id: string) => (await repo().get(id))!.ingredients.map((i) => i.ingredientId ?? null);

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'alice@example.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}');
    insert into public.ingredients (id, name, slug, category, form) values
      ('${ONION}', 'Onion', 'onion', 'Vegetables', 'fresh'), ('${FLOUR}', 'Plain flour', 'plain-flour', 'Baking', null),
      ('${BEEF}', 'Beef mince', 'beef-mince', 'Meat', null), ('${PORK}', 'Mince', 'mince', 'Meat', null);
    insert into public.ingredient_aliases (ingredient_id, alias) values ('${FLOUR}', 'flour'), ('${BEEF}', 'mince');`);
  await pg.actAs(ALICE);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('save_recipe explicit unlink (20261020002300)', () => {
  it('stores a valid id, carries over when the key is absent, and drops the link when null/empty is sent', async () => {
    const created = await repo().create(recipe('Links', [line('onion', ONION), line('plain flour', FLOUR), line('chilli')]));
    expect(await ids(created.id)).toEqual([ONION, FLOUR, null]);

    // key absent -> carried over from the same-named previous line (imports, duplicate, older clients)
    await repo().update(created.id, recipe('Links', [line('onion'), line('plain flour'), line('chilli')]));
    expect(await ids(created.id)).toEqual([ONION, FLOUR, null]);

    // null = "not in list": never carried over. '' behaves the same.
    await repo().update(created.id, recipe('Links', [line('onion', null), line('plain flour', ''), line('chilli')]));
    expect(await ids(created.id)).toEqual([null, null, null]);

    // and it stays unlinked on a later save that omits the key (nothing left to carry over)
    await repo().update(created.id, recipe('Links', [line('onion'), line('plain flour'), line('chilli')]));
    expect(await ids(created.id)).toEqual([null, null, null]);

    // an explicit choice always wins over the previous link
    await repo().update(created.id, recipe('Links', [line('onion', FLOUR), line('plain flour', ONION), line('chilli')]));
    expect(await ids(created.id)).toEqual([FLOUR, ONION, null]);
  });
});

describe('backfill (20261020002301)', () => {
  it('links only lines whose exact name or alias hits exactly one ingredient, and is idempotent', async () => {
    const r = await repo().create(
      recipe('Backfill me', [
        line('Onion', null), // exact name, different case
        line('flour', null), // exact alias
        line('mince', null), // Mince (name) AND Beef mince (alias): ambiguous, left alone
        line('onions', null), // plural only: left to the app matcher
        line('plain flour', FLOUR), // already linked: untouched
      ]),
    );
    expect(await ids(r.id)).toEqual([null, null, null, null, FLOUR]);

    await pg.admin(BACKFILL);
    expect(await ids(r.id)).toEqual([ONION, FLOUR, null, null, FLOUR]);

    await pg.admin(BACKFILL);
    expect(await ids(r.id)).toEqual([ONION, FLOUR, null, null, FLOUR]);
  });
});
