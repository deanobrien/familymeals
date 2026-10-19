// X2 (D187): the real SupabaseProductSnapshotStore against the real migration in PGlite, acting as `authenticated`
// members so RLS and the SECURITY DEFINER checks apply. NOT covered: PostgREST argument typing (see D128).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_CODES, OFF_FIXTURES, mapOffProduct } from '@fr/product-sources';
import { createRecipeCalculator } from '../calc';
import { getIngredientCatalogue } from '../refdata/catalogue';
import type { DataContext } from './backend';
import { SupabaseProductSnapshotStore, snapshotFromRow } from './product-store';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const cat = getIngredientCatalogue();
const BEANS = cat.matcher.match('baked beans').ingredientId!;
const now = () => new Date('2026-10-19T12:00:00Z');
const beans = mapOffProduct(FIXTURE_CODES.bakedBeans, OFF_FIXTURES[FIXTURE_CODES.bakedBeans]!, { matcher: cat.matcher, now })!;

let pg: PgliteSupabase;
const store = (hh: string) => new SupabaseProductSnapshotStore(async (): Promise<DataContext> => ({ client: pg.client, householdId: hh, userId: null }), 0);

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    insert into public.ingredients (id, name, slug, category, form) values ('${BEANS}', 'baked beans', 'baked-beans', 'Tins', null);`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('SupabaseProductSnapshotStore', () => {
  it('round-trips a linked product and feeds the household calculator', async () => {
    await pg.actAs(BOB);
    const s = store(HA);
    await s.save(HA, { barcode: beans.barcode, ingredientId: BEANS, product: beans, linkedAt: now().toISOString() });
    const [snap] = s.list(HA);
    expect(snap).toMatchObject({ barcode: beans.barcode, ingredientId: BEANS });
    expect(snap!.product).toEqual(beans); // our normalised shape survives jsonb unchanged

    const calc = createRecipeCalculator({ productSource: s.asNutritionSource(HA), now });
    const n = calc.forRecipe({ id: 'r', servings: 2, updatedAt: 'x', ingredients: [{ id: 'l', name: 'baked beans', quantity: { kind: 'exact', value: 400, unit: 'g', originalText: '400 g' }, optional: false, order: 0 }] }).nutrition;
    expect(n.totals.energy_kcal.value).toBe(312);
    expect(n.productSources?.[0]?.barcode).toBe(beans.barcode);
  });

  it('refreshes from the database, replaces on re-save (no duplicates), and removes', async () => {
    await pg.actAs(ALICE);
    const s = store(HA);
    await s.refresh(HA, true);
    expect(s.list(HA)).toHaveLength(1);
    await s.save(HA, { barcode: beans.barcode, ingredientId: null, product: beans, linkedAt: now().toISOString() });
    expect(s.list(HA)).toHaveLength(1);
    expect(s.list(HA)[0]!.ingredientId).toBeNull();
    await s.remove(HA, beans.barcode);
    expect(s.list(HA)).toEqual([]);
  });

  it('is household isolated: a non-member cannot read or write another household', async () => {
    await pg.actAs(BOB);
    await store(HA).save(HA, { barcode: beans.barcode, ingredientId: BEANS, product: beans, linkedAt: now().toISOString() });
    await pg.actAs(CAROL);
    const carol = store(HC);
    await carol.refresh(HC, true);
    expect(carol.list(HC)).toEqual([]);
    await expect(store(HA).save(HA, { barcode: beans.barcode, ingredientId: null, product: beans, linkedAt: now().toISOString() })).rejects.toThrow();
    await expect(store(HA).refresh(HA, true)).resolves.toBeUndefined(); // reads as null -> empty, never another household's data
    expect(store(HA).list(HA)).toEqual([]);
  });

  it('drops a stored row that no longer satisfies the product schema', () => {
    expect(snapshotFromRow({ barcode: beans.barcode, ingredient_id: BEANS, snapshot: { barcode: beans.barcode, name: 'x' }, linked_at: 'x' })).toBeNull();
    expect(snapshotFromRow({ barcode: beans.barcode, ingredient_id: null, snapshot: beans, linked_at: '2026-10-19T00:00:00Z' })).toMatchObject({ ingredientId: null });
  });
});
