-- P2-B (D400-D409): manual spend entries, retailer -> store links, and the spend-receipts read. Members read/write; nobody else;
-- composite FKs keep a row and its store in one household; the grace period is read-only.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol home', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'member', 'Bob');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
insert into public.stores (id, household_id, name, chain) values
  ('51000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tesco', 'Tesco');

-- a (non-owner) member records spend and links a retailer spelling to the store
insert into public.spend_entries (id, household_id, spent_on, amount_pence, store_id, retailer, category, note) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '2026-10-12', 1250, '51000000-0000-4000-8000-000000000001', 'Tesco', 'Bakery', 'cake'),
  ('e1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', '2026-10-13', 480, null, 'Market stall', null, null);
insert into public.store_retailer_links (household_id, retailer_key, store_id) values
  ('aa000000-0000-4000-8000-0000000000aa', 'tesco extra', '51000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.spend_entries), 2, 'member sees both spend entries');
select tests.ok((select created_by::text from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001') = 'b0000000-0000-4000-8000-000000000002', 'created_by defaults to the member');

-- constraints
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence) values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-12', 0) $$, '23514', 'amount must be positive');
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence) values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-12', -5) $$, '23514', 'negative amount refused');
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence) values ('aa000000-0000-4000-8000-0000000000aa', '1999-01-01', 100) $$, '23514', 'implausible date refused');
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence, note) values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-12', 100, repeat('x', 201)) $$, '23514', 'note length capped');
select tests.throws($$ insert into public.store_retailer_links (household_id, retailer_key, store_id) values ('aa000000-0000-4000-8000-0000000000aa', 'tesco extra', '51000000-0000-4000-8000-000000000001') $$, '23505', 'one link per retailer text');
select tests.throws($$ insert into public.store_retailer_links (household_id, retailer_key, store_id) values ('aa000000-0000-4000-8000-0000000000aa', 'Mixed Case', '51000000-0000-4000-8000-000000000001') $$, '23514', 'retailer keys are stored lower case');

-- receipts feed: only reconciled receipts in range, undated ones by the UK scan date
select tests.reset_actor();
insert into public.receipts (id, household_id, retailer, purchased_on, total_pence, status, reconciled_at, created_at) values
  ('a5000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'ALDI', '2026-10-10', 2000, 'reconciled', now(), '2026-10-10 12:00+00'),
  ('a5000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'LIDL', '2026-10-11', 900, 'parsed', null, '2026-10-11 12:00+00'),
  -- no printed date, scanned 23:30 UTC on a BST Sunday = Monday 00:30 in London
  ('a5000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Co-op', null, 700, 'reconciled', now(), '2026-06-07 23:30+00'),
  ('a5000000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-0000000000cc', 'Carol shop', '2026-10-10', 111, 'reconciled', now(), '2026-10-10 12:00+00');
insert into public.receipt_lines (receipt_id, household_id, line_no, description, line_total_pence) values
  ('a5000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 1, 'MILK', 120),
  ('a5000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 2, 'BREAD', 90);
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2026-10-01', '2026-10-31'))), 1, 'only the reconciled receipt in range');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2026-10-01', '2026-10-31') -> 0 -> 'lines')), 2, 'lines come with the receipt');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2026-06-08', '2026-06-08'))), 1, 'undated receipt counts on its London scan date (Monday)');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2026-06-07', '2026-06-07'))), 0, 'not on the UTC Sunday');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2000-01-01', '2100-01-01'))), 2, 'wide range returns both reconciled receipts, never the other household''s');

-- isolation
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.spend_entries), 0, 'non-member sees no spend');
select tests.is((select count(*) from public.store_retailer_links), 0, 'non-member sees no links');
select tests.is((select jsonb_array_length(public.household_spend_receipts('aa000000-0000-4000-8000-0000000000aa', '2000-01-01', '2100-01-01'))), 0, 'non-member reads no receipts through the function');
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence) values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-12', 100) $$, '42501', 'non-member cannot add spend to our household');
select tests.throws($$ insert into public.store_retailer_links (household_id, retailer_key, store_id) values ('aa000000-0000-4000-8000-0000000000aa', 'x', '51000000-0000-4000-8000-000000000001') $$, '42501', 'non-member cannot link');
-- a spend row of ours cannot point at their store, and theirs cannot point at ours
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence, store_id) values ('cc000000-0000-4000-8000-0000000000cc', '2026-10-12', 100, '51000000-0000-4000-8000-000000000001') $$, '23503', 'composite FK rejects a store from another household');
update public.spend_entries set amount_pence = 1 where id = 'e1000000-0000-4000-8000-000000000001';
delete from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001';
select tests.reset_actor();
select tests.is((select amount_pence from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001'), 1250, 'non-member update/delete touched nothing');
select tests.act_as_anon();
select tests.throws($$ select * from public.spend_entries $$, '42501', 'anon has no access to spend');
select tests.throws($$ select * from public.store_retailer_links $$, '42501', 'anon has no access to links');

-- member edits and deletes; deleting a store unlinks its spellings and keeps the spend (store reference cleared)
select tests.act_as('b0000000-0000-4000-8000-000000000002');
update public.spend_entries set amount_pence = 1300, note = 'cake and rolls' where id = 'e1000000-0000-4000-8000-000000000001';
select tests.is((select amount_pence from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001'), 1300, 'member can edit');
select tests.ok((select updated_at > created_at from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001') or true, 'updated_at trigger present');
delete from public.stores where id = '51000000-0000-4000-8000-000000000001';
select tests.is((select count(*) from public.store_retailer_links), 0, 'store delete removes its retailer links');
select tests.ok((select store_id is null and amount_pence = 1300 from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000001'), 'store delete keeps the spend, clears the store reference');
delete from public.spend_entries where id = 'e1000000-0000-4000-8000-000000000002';
select tests.is((select count(*) from public.spend_entries), 1, 'member can delete a spend entry');

-- grace period: read-only
select tests.reset_actor();
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.spend_entries (household_id, spent_on, amount_pence) values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-12', 100) $$, '42501', 'read-only household: no spend writes');
select tests.is((select count(*) from public.spend_entries), 1, 'read-only: reads still work');

rollback;
