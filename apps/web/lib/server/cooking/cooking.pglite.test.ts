// P1-A (D360-D369): the cooking service against the real migrations in PGlite, acting as `authenticated` members so RLS applies.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { loadCooking, markCooked, setDontSuggest, withCooking, type CookingCaller } from './service';
import { SupabaseCookingStore } from './supabase-store';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const R1 = 'e1000000-0000-4000-8000-000000000001';
const R2 = 'e1000000-0000-4000-8000-000000000002';
const RC = 'e2000000-0000-4000-8000-000000000001';

let pg: PgliteSupabase;
const as = (userId: string, householdId = HA, readOnly = false): CookingCaller => ({ householdId, userId, client: pg.client, readOnly });

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    insert into public.recipes (id, household_id, title) values ('${R1}', '${HA}', 'Chilli'), ('${R2}', '${HA}', 'Soup'), ('${RC}', '${HC}', 'Carol soup');`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('cooking against the real schema', () => {
  it('marks a recipe cooked with a rating and a private note; the rating feeds recipe_ratings', async () => {
    await pg.actAs(ALICE);
    const r = await markCooked(as(ALICE), R1, { servings: 4, rating: 4, note: 'less chilli next time' });
    expect(r).toMatchObject({ ok: true, entry: { servings: 4, rating: 4, note: { text: 'less chilli next time', isPrivate: true } }, cooking: { cookedCount: 1, myRating: 4 } });
    const ratings = await pg.client.from('recipe_ratings').select('user_id, rating').eq('recipe_id', R1);
    expect(ratings.data).toEqual([{ user_id: ALICE, rating: 4 }]);
  });

  it('a household note is visible to members; a private one only to its author', async () => {
    await pg.actAs(BOB);
    await markCooked(as(BOB), R1, { servings: 2, rating: 5, note: 'Great with rice', notePrivate: false });
    const bob = await loadCooking(as(BOB), R1);
    if (!bob.ok) throw new Error('expected ok');
    expect(bob.cooking.cookedCount).toBe(2);
    expect(bob.cooking.history.map((h) => h.note?.text).sort()).toEqual(['Great with rice', undefined].sort());
    expect(bob.cooking.history.find((h) => !h.mine)?.cookedBy).toEqual(expect.any(String));
    await pg.actAs(ALICE);
    const alice = await loadCooking(as(ALICE), R1);
    if (!alice.ok) throw new Error('expected ok');
    expect(alice.cooking.history.map((h) => h.note?.text).sort()).toEqual(['Great with rice', 'less chilli next time']);
    // the household mean now counts both members
    const ratings = await pg.client.from('recipe_ratings').select('rating').eq('recipe_id', R1);
    expect((ratings.data as Array<{ rating: number }>).map((r) => r.rating).sort()).toEqual([4, 5]);
  });

  it('changing your rating on a later cook updates (not duplicates) your recipe rating', async () => {
    await pg.actAs(ALICE);
    await markCooked(as(ALICE), R1, { servings: 4, rating: 2 });
    const rows = await pg.client.from('recipe_ratings').select('rating').eq('recipe_id', R1).eq('user_id', ALICE);
    expect(rows.data).toEqual([{ rating: 2 }]);
  });

  it('summaries are household-wide and per recipe', async () => {
    await pg.actAs(ALICE);
    const s = await new SupabaseCookingStore(pg.client).summaries(HA);
    expect(s.get(R1)).toMatchObject({ cookedCount: 3 });
    expect(s.has(R2)).toBe(false);
    const cards = await withCooking(as(ALICE), [{ id: R1, rating: null }, { id: R2, rating: null }]);
    expect(cards[0]).toMatchObject({ cooked: { cookedCount: 3 } });
    expect(cards[1]).not.toHaveProperty('cooked');
  });

  it("don't suggest again is per member, visible to the household, and removable", async () => {
    await pg.actAs(ALICE);
    expect(await setDontSuggest(as(ALICE), R2, true)).toMatchObject({ ok: true, cooking: { dontSuggest: true, dontSuggestCount: 1 } });
    expect(await setDontSuggest(as(ALICE), R2, true)).toMatchObject({ ok: true, cooking: { dontSuggestCount: 1 } }); // idempotent
    await pg.actAs(BOB);
    expect(await loadCooking(as(BOB), R2)).toMatchObject({ ok: true, cooking: { dontSuggest: false, dontSuggestCount: 1 } });
    expect([...(await new SupabaseCookingStore(pg.client).dontSuggestIds(HA))]).toEqual([R2]);
    await pg.actAs(ALICE);
    expect(await setDontSuggest(as(ALICE), R2, false)).toMatchObject({ ok: true, cooking: { dontSuggest: false, dontSuggestCount: 0 } });
  });

  it('validates input and refuses bad values without writing', async () => {
    await pg.actAs(ALICE);
    expect(await markCooked(as(ALICE), R2, { servings: 0 })).toMatchObject({ ok: false, error: 'invalid_input', fieldErrors: { servings: expect.any(String) } });
    expect(await markCooked(as(ALICE), R2, { servings: 2, rating: 6 })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await markCooked(as(ALICE), R2, { servings: 2, note: 'x'.repeat(1001) })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await markCooked(as(ALICE), 'not-a-uuid', { servings: 2 })).toMatchObject({ ok: false, error: 'not_found' });
    expect((await loadCooking(as(ALICE), R2))).toMatchObject({ ok: true, cooking: { cookedCount: 0 } });
  });

  it("another household's recipe is not found, and writes are refused while read-only", async () => {
    await pg.actAs(ALICE);
    expect(await markCooked(as(ALICE), RC, { servings: 2 })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await markCooked(as(ALICE, HA, true), R2, { servings: 2 })).toEqual({ ok: false, error: 'read_only' });
    await pg.actAs(CAROL);
    expect(await loadCooking(as(CAROL, HC), RC)).toMatchObject({ ok: true, cooking: { cookedCount: 0 } });
    // Carol cannot see Alice's household history even by asking for it
    expect(await loadCooking(as(CAROL, HA), R1)).toMatchObject({ ok: true, cooking: { cookedCount: 0, history: [] } });
  });

  it('a member who leaves takes their history and notes with them', async () => {
    await pg.admin(`update public.household_members set status = 'left' where household_id = '${HA}' and user_id = '${BOB}'`);
    await pg.actAs(ALICE);
    const a = await loadCooking(as(ALICE), R1);
    if (!a.ok) throw new Error('expected ok');
    expect(a.cooking.history.every((h) => h.mine)).toBe(true);
    expect(a.cooking.history.map((h) => h.note?.text)).not.toContain('Great with rice');
  });
});
