// P3-A (D420-D424) contract test: the real sharing service + SupabaseShareStore against the real migrations in PGlite, acting as
// `authenticated` / `anon` so RLS and the SECURITY DEFINER RPCs apply. NOT covered here: Storage itself (the cover policy is in
// packages/db/tests/rls/014_p3a_sharing_kids.sql) and PostgREST.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recipeInputSchema } from '../../recipes/schema';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { resetShareLimits } from './rate-limit';
import { copyInputFor, createShare, listShares, previewShare, revokeShare, type ShareCaller, type ShareViewerCtx } from './service';
import { SupabaseShareStore } from './store';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const R1 = 'e1000000-0000-4000-8000-000000000001';
const R2 = 'e1000000-0000-4000-8000-000000000002';

let pg: PgliteSupabase;
const callerOf = (userId: string, householdId: string): ShareCaller => ({ householdId, userId, displayName: null, client: pg.client, readOnly: false });
const viewer = (userId: string | null, householdId: string | null): ShareViewerCtx => ({ userId, householdId, client: pg.client });

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    update public.household_members set display_name = 'Alice' where user_id = '${ALICE}';
    insert into public.recipes (id, household_id, title, description, prep_minutes, cook_minutes, default_servings, cuisine, meal_type, diet_category, source_attribution, created_by) values
      ('${R1}', '${HA}', 'Chilli', 'Warming', 15, 45, 4, 'Mexican', 'dinner', 'meat', 'Grandma''s book', '${ALICE}'),
      ('${R2}', '${HA}', 'Pasta', null, 10, 20, 2, null, 'dinner', 'vegetarian', null, '${ALICE}');
    insert into public.recipe_ingredients (recipe_id, household_id, original_text, display_name, quantity_kind, quantity_value, unit, preparation, position) values
      ('${R1}', '${HA}', '400 g beef mince', 'beef mince', 'exact', 400, 'g', 'browned', 0),
      ('${R1}', '${HA}', 'to taste', 'salt', 'to_taste', null, null, null, 1);
    insert into public.recipe_steps (recipe_id, household_id, step_number, instructions) values ('${R1}', '${HA}', 1, 'Brown the mince.'), ('${R1}', '${HA}', 2, 'Simmer.');
    insert into public.recipe_favourites (recipe_id, user_id, household_id) values ('${R1}', '${BOB}', '${HA}');
    insert into public.recipe_ratings (recipe_id, user_id, household_id, rating) values ('${R1}', '${BOB}', '${HA}', 5);`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('SupabaseShareStore through the service', () => {
  let token = '';
  let shareId = '';

  it('a member creates a link; the token is returned once and only its hash is stored', async () => {
    await pg.actAs(ALICE);
    resetShareLimits();
    const r = await createShare(callerOf(ALICE, HA), { scope: 'recipe', recipeIds: [R1], expiresInDays: 7, publicPreview: false });
    if (!r.ok) throw new Error(r.message);
    token = r.share.token;
    shareId = r.share.id;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.share.expiresAt).not.toBeNull();
    await pg.actAs(null);
    const stored = await pg.db.query<{ token_hash: string }>('select token_hash from public.recipe_shares');
    expect(stored.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]!.token_hash).not.toBe(token);
  });

  it('refuses a selection that is not this household\'s, and an outsider creating for another household', async () => {
    await pg.actAs(CAROL);
    expect(await createShare(callerOf(CAROL, HC), { scope: 'recipe', recipeIds: [R1], expiresInDays: 7 })).toMatchObject({ ok: false });
    expect(await createShare(callerOf(CAROL, HA), { scope: 'recipe', recipeIds: [R1], expiresInDays: 7 })).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('another household reads exactly the whitelisted view, which is a valid recipe to copy', async () => {
    await pg.actAs(CAROL);
    const r = await previewShare(viewer(CAROL, HC), token);
    if (!r.ok || r.preview.kind !== 'full') throw new Error('expected full');
    expect(r.preview.attribution).toBe("Shared by Alice's household");
    const recipe = r.preview.recipes[0]!;
    expect(recipe).toMatchObject({ title: 'Chilli', description: 'Warming', prepMinutes: 15, cookMinutes: 45, servings: 4, cuisine: 'Mexican', steps: ['Brown the mince.', 'Simmer.'] });
    expect(recipe.ingredients.map((i) => i.text)).toEqual(['400 g beef mince, browned', 'to taste salt']);
    const text = JSON.stringify(r.preview);
    for (const forbidden of ['favourite', 'rating', HA, ALICE, BOB]) expect(text).not.toContain(forbidden);

    // the internal doc builds a recipe input the normal save path accepts, with the sharer credited and nothing private
    const doc = (await new SupabaseShareStore(pg.client).read(token, { userId: CAROL, householdId: HC }))!;
    if (doc.minimal) throw new Error('expected the full doc');
    const input = copyInputFor(doc.recipes[0]!, doc.sharedBy);
    expect(recipeInputSchema.safeParse(input).success).toBe(true);
    expect(input.sourceAttribution).toBe("Shared by Alice's household. Originally: Grandma's book");
    expect(input.originalText).toBe('');
    expect(input.ingredients[0]).toMatchObject({ name: 'beef mince', quantity: { kind: 'exact', value: 400, unit: 'g' }, preparation: 'browned' });
    expect(input.ingredients[1]!.quantity.kind).toBe('to_taste');
  });

  it('signed out: minimal by default; unknown tokens say nothing', async () => {
    await pg.actAsAnon();
    const min = await previewShare(viewer(null, null), token);
    if (!min.ok) throw new Error('preview');
    expect(min.preview).toMatchObject({ kind: 'minimal', sharedBy: 'Alice', recipeCount: 1 });
    expect(JSON.stringify(min.preview)).not.toContain('Brown the mince');
    resetShareLimits();
    expect(await previewShare(viewer(null, null), 'f'.repeat(64))).toEqual({ ok: true, preview: { kind: 'invalid' } });
  });

  it('the sharer\'s household sees counts only; any member can revoke; then every read is the same generic answer', async () => {
    await pg.actAs(BOB);
    const l = await listShares(callerOf(BOB, HA));
    if (!l.ok) throw new Error('list');
    expect(l.shares[0]).toMatchObject({ id: shareId, status: 'active', openedBy: 1, saved: 0, createdByMe: false });
    expect(JSON.stringify(l.shares)).not.toContain(CAROL);
    expect((await revokeShare(callerOf(BOB, HA), shareId)).ok).toBe(true);
    await pg.actAs(CAROL);
    resetShareLimits();
    expect(await previewShare(viewer(CAROL, HC), token)).toEqual({ ok: true, preview: { kind: 'invalid' } });
    expect(await revokeShare(callerOf(CAROL, HC), shareId)).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('a signed-out visitor reads a public-preview link in full, without being recorded', async () => {
    await pg.actAs(ALICE);
    const r = await createShare(callerOf(ALICE, HA), { scope: 'collection', recipeIds: [R1, R2], title: 'Weeknights', expiresInDays: null, publicPreview: true });
    if (!r.ok) throw new Error(r.message);
    await pg.actAsAnon();
    resetShareLimits();
    const pub = await previewShare(viewer(null, null), r.share.token);
    if (!pub.ok || pub.preview.kind !== 'full') throw new Error('expected full');
    expect(pub.preview.recipes.map((x) => x.title)).toEqual(['Chilli', 'Pasta']);
    expect(pub.preview.title).toBe('Weeknights');
    expect(pub.preview.recipes.every((x) => x.imagePath === null)).toBe(true);
  });
});
