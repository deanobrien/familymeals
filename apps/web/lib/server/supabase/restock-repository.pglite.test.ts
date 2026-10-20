// PR1 (D280-D289): the real SupabaseRestockRepository against the real migrations in PGlite, acting as `authenticated`
// members so RLS applies (member read/write, outsider nothing, read-only during the deletion grace period).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParLevel } from '../../pantry/engine';
import { defaultIngredientLookup } from '../pantry/ingredients';
import { createPantryService } from '../pantry/service';
import { InMemoryLeftoverSource, InMemoryPurchaseEventSource, InMemoryRecipeSummarySource } from '../pantry/sources';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { createRestockService } from '../restock/service';
import { InMemoryShoppingRepository } from '../shopping/repository';
import { SupabasePantryRepository } from './pantry-repository';
import { SupabaseRestockRepository, parFromRow, parToRow } from './restock-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const TOM = '11000000-0000-4000-8000-000000000001';

let pg: PgliteSupabase;
const repo = () => new SupabaseRestockRepository(pg.client);
const par = (over: Partial<ParLevel> = {}): ParLevel => ({
  id: randomUUID(), householdId: HA, ingredientId: TOM, name: 'Tinned tomatoes', unit: 'can', minValue: 6, enabled: true, ...over,
});
const freeText = (name: string, unit: ParLevel['unit'], minValue: number): ParLevel => {
  const p = par({ name, unit, minValue });
  delete p.ingredientId;
  return p;
};

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    insert into public.ingredients (id, name, slug, category, form) values ('${TOM}', 'Tinned tomatoes', 'tinned-tomatoes', 'Tins', 'canned');`);
  await pg.actAs(ALICE);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('SupabaseRestockRepository against the real schema', () => {
  it('saves, lists and round-trips every field (pack, restock-to, snooze)', async () => {
    const full = par({ restockToValue: 8, pack: { value: 1, unit: 'can' }, snoozedUntil: '2026-10-30' });
    const free = freeText('Birthday candles', 'item', 10);
    await repo().savePar(HA, full);
    await repo().savePar(HA, free);
    const back = await repo().listPars(HA);
    expect(back.map((p) => p.name)).toEqual(['Birthday candles', 'Tinned tomatoes']);
    expect(back.find((p) => p.name === 'Tinned tomatoes')).toEqual(full);
    expect(back.find((p) => p.name === 'Birthday candles')).toEqual(free);
    expect(parFromRow(parToRow(HA, full) as never)).toEqual(full);
  });

  it('upsert by id replaces (change the minimum, disable, clear the snooze)', async () => {
    const p = (await repo().listPars(HA)).find((x) => x.name === 'Tinned tomatoes')!;
    const { snoozedUntil: _snoozed, ...rest } = p;
    await repo().savePar(HA, { ...rest, minValue: 12, enabled: false });
    const again = (await repo().listPars(HA)).find((x) => x.id === p.id)!;
    expect(again).toMatchObject({ minValue: 12, enabled: false });
    expect(again.snoozedUntil).toBeUndefined();
    await repo().savePar(HA, { ...rest, minValue: 6, enabled: true });
  });

  it('a second minimum for the same ingredient is refused by the database', async () => {
    await expect(repo().savePar(HA, par())).rejects.toThrow(/23505|duplicate|unique/i);
  });

  it('another member of the household reads and edits; delete removes', async () => {
    await pg.actAs(BOB);
    expect(await repo().listPars(HA)).toHaveLength(2);
    const extra = freeText('Matches', 'pack', 2);
    await repo().savePar(HA, extra);
    await repo().deletePar(HA, extra.id);
    expect((await repo().listPars(HA)).map((p) => p.name)).not.toContain('Matches');
    await pg.actAs(ALICE);
  });

  it('settings default to suggestions-only and persist', async () => {
    expect(await repo().getSettings(HA)).toEqual({ autoAdd: false });
    await repo().saveSettings(HA, { autoAdd: true });
    expect(await repo().getSettings(HA)).toEqual({ autoAdd: true });
    await repo().saveSettings(HA, { autoAdd: false });
    expect(await repo().getSettings(HA)).toEqual({ autoAdd: false });
  });

  it('rejects ids that are not UUIDs before touching the database', async () => {
    await expect(repo().savePar(HA, par({ id: 'not-a-uuid' }))).rejects.toThrow(/UUID/);
    expect(await repo().listPars('demo-household')).toEqual([]);
  });

  it('an outsider sees nothing, cannot write into the household, and deletes nothing', async () => {
    const victim = (await repo().listPars(HA))[0]!;
    await pg.actAs(CAROL);
    expect(await repo().listPars(HA)).toEqual([]);
    expect(await repo().getSettings(HA)).toEqual({ autoAdd: false });
    await expect(repo().savePar(HA, freeText('Sneaky', 'item', 1))).rejects.toThrow();
    await repo().deletePar(HA, victim.id); // filtered to 0 rows by RLS
    // Carol has her own minimum for the same ingredient (uniqueness is per household)
    await repo().savePar(HC, par({ householdId: HC }));
    expect(await repo().listPars(HC)).toHaveLength(1);
    await pg.actAs(ALICE);
    expect(await repo().listPars(HA)).toHaveLength(2);
  });

  it('drives the restock service end to end over Supabase pantry + minimums (shopping in memory)', async () => {
    const ingredients = defaultIngredientLookup();
    const converter = getIngredientCatalogue().converter;
    const NOW = '2026-10-19T12:00:00.000Z';
    const tom = ingredients.findByName('tinned tomatoes')!;
    await pg.actAs(null);
    await pg.admin(`insert into public.ingredients (id, name, slug, category, form) values ('${tom.id}', 'Tinned tomatoes (catalogue)', 'tinned-tomatoes-cat', 'Tins', 'canned') on conflict do nothing`);
    await pg.actAs(ALICE);
    const pantry = createPantryService({
      repo: new SupabasePantryRepository(pg.client), recipes: new InMemoryRecipeSummarySource([]), purchases: new InMemoryPurchaseEventSource([]),
      leftovers: new InMemoryLeftoverSource(() => NOW), ingredients, converter, now: () => NOW,
    });
    expect((await pantry.addItem(HA, { ingredientId: tom.id, value: 2, unit: 'can' })).ok).toBe(true);
    const svc = createRestockService({ repo: repo(), pantry, shopping: new InMemoryShoppingRepository({ converter }), ingredients, converter, now: () => NOW });
    expect((await svc.setPar(HA, { ingredientId: tom.id, unit: 'can', min: 6 })).ok).toBe(true);
    const view = await svc.getView(HA);
    expect(view.suggestions[0]).toMatchObject({ name: tom.name, quantity: 4 });
    expect((await svc.addToList(HA, ALICE)).ok).toBe(true);
    expect((await svc.getView(HA)).suggestions).toEqual([]);
  });

  it('is read-only while the household is pending deletion', async () => {
    await pg.actAs(ALICE);
    await pg.db.query(`select public.request_household_deletion('${HA}')`);
    const before = await repo().listPars(HA);
    expect(before.length).toBeGreaterThan(0); // still readable
    await expect(repo().savePar(HA, freeText('Late add', 'item', 1))).rejects.toThrow();
    await expect(repo().saveSettings(HA, { autoAdd: true })).rejects.toThrow();
    await repo().deletePar(HA, before[0]!.id); // RLS filters the delete to 0 rows
    expect(await repo().listPars(HA)).toHaveLength(before.length);
    await pg.db.query(`select public.cancel_household_deletion('${HA}')`);
  });
});
