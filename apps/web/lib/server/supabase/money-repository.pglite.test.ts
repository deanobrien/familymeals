// P2-B (D400): the real SupabaseMoneyRepository against the real migration in PGlite, as `authenticated` members (RLS applies).
// Same contract as the in-memory repository, plus isolation, the spend-receipts RPC and the grace period. NOT covered:
// PostgREST argument typing (see D128); the local-Supabase live run covers the real PostgREST.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moneyRepositoryContract } from '../money/contract';
import { InMemoryMoneyRepository } from '../money/repository';
import { SupabaseMoneyRepository } from './money-repository';
import { SupabaseReceiptRepository } from './receipt-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const STORE = '51000000-0000-4000-8000-000000000001';
const STORE_C = '52000000-0000-4000-8000-000000000002';

let pg: PgliteSupabase;
const repoFor = (user: string) => new SupabaseMoneyRepository(pg.client, user);

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    insert into public.stores (id, household_id, name) values ('${STORE}', '${HA}', 'Tesco'), ('${STORE_C}', '${HC}', 'Carol shop');`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

moneyRepositoryContract('in memory', async () => {
  const repo = new InMemoryMoneyRepository(undefined, (h, id) => id === STORE && h === HA);
  return { repo, household: HA, storeId: STORE };
});

moneyRepositoryContract('Supabase (PGlite)', async () => {
  await pg.admin('delete from public.spend_entries; delete from public.store_retailer_links');
  await pg.actAs(BOB); // a plain member, not the owner
  return { repo: repoFor(BOB), household: HA, storeId: STORE };
});

describe('SupabaseMoneyRepository: isolation, receipts feed, grace period', () => {
  it('another household cannot read or change ours', async () => {
    await pg.admin('delete from public.spend_entries; delete from public.store_retailer_links');
    await pg.actAs(ALICE);
    const e = await repoFor(ALICE).addSpend(HA, { date: '2026-10-12', amountPence: 500 });
    await repoFor(ALICE).setLink(HA, 'tesco', STORE);
    await pg.actAs(CAROL);
    const carol = repoFor(CAROL);
    expect(await carol.listSpend(HA, '2000-01-01', '2100-01-01')).toEqual([]);
    expect(await carol.links(HA)).toEqual({});
    await expect(carol.addSpend(HA, { date: '2026-10-12', amountPence: 1 })).rejects.toBeTruthy();
    await expect(carol.updateSpend(HA, e.id, { date: '2026-10-12', amountPence: 1 })).rejects.toBeTruthy(); // hidden by RLS: not found
    await carol.deleteSpend(HA, e.id); // RLS: deletes nothing
    await expect(carol.addSpend(HC, { date: '2026-10-12', amountPence: 1, storeId: STORE })).rejects.toBeTruthy(); // our store, their household
    await pg.actAs(ALICE);
    expect((await repoFor(ALICE).listSpend(HA, '2000-01-01', '2100-01-01')).map((x) => x.amountPence)).toEqual([500]);
  });

  it('reads reconciled receipts (and only those) for the spend feed through the receipts repository', async () => {
    await pg.admin(`
      delete from public.receipts;
      insert into public.receipts (id, household_id, retailer, purchased_on, total_pence, status, reconciled_at, review_state, created_at) values
        ('a5000000-0000-4000-8000-000000000001', '${HA}', 'ALDI', '2026-10-10', 2000, 'reconciled', now(), '{"computedPence": 1990, "createdAt": "2026-10-10T12:00:00Z"}', '2026-10-10 12:00+00'),
        ('a5000000-0000-4000-8000-000000000002', '${HA}', 'LIDL', '2026-10-11', 900, 'parsed', null, null, '2026-10-11 12:00+00'),
        ('a5000000-0000-4000-8000-000000000003', '${HA}', 'Co-op', null, 700, 'reconciled', now(), null, '2026-06-07 23:30+00');`);
    await pg.actAs(BOB);
    const receipts = new SupabaseReceiptRepository(pg.client, HA);
    const oct = await receipts.reconciledBetween(HA, '2026-10-01', '2026-10-31');
    expect(oct.map((r) => [r.retailer, r.totalPence, r.status])).toEqual([['ALDI', 2000, 'reconciled']]);
    // undated receipt scanned 23:30 UTC on a BST Sunday counts on the London Monday
    expect((await receipts.reconciledBetween(HA, '2026-06-08', '2026-06-08')).map((r) => r.retailer)).toEqual(['Co-op']);
    expect(await receipts.reconciledBetween(HA, '2026-06-07', '2026-06-07')).toEqual([]);
  });

  it('a read-only household (pending deletion) can read but not write', async () => {
    await pg.admin('delete from public.spend_entries');
    await pg.actAs(ALICE);
    await repoFor(ALICE).addSpend(HA, { date: '2026-10-12', amountPence: 100 });
    await pg.admin(`update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days' where id = '${HA}'`);
    try {
      await pg.actAs(ALICE);
      await expect(repoFor(ALICE).addSpend(HA, { date: '2026-10-12', amountPence: 200 })).rejects.toBeTruthy();
      expect(await repoFor(ALICE).listSpend(HA, '2000-01-01', '2100-01-01')).toHaveLength(1);
    } finally {
      await pg.admin(`update public.households set status = 'active', deletion_requested_at = null, purge_after = null where id = '${HA}'`);
    }
  });
});
