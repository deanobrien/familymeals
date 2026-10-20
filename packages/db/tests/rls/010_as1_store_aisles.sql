-- AS1 (D290-D293): stores, aisles and placements. Household members read/write; nobody else; composite FKs keep rows in one household.
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

-- a (non-owner) member builds a store with two aisles and placements
select tests.act_as('b0000000-0000-4000-8000-000000000002');
insert into public.stores (id, household_id, name, chain) values
  ('51000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'ALDI Gosforth', 'ALDI'),
  ('51000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'LIDL High St', 'LIDL');
insert into public.store_aisles (id, household_id, store_id, label, sort_order) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', '1', 10),
  ('a1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', '5', 50),
  ('a2000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000002', 'Fruit', 10);
insert into public.store_placements (household_id, store_id, aisle_id, target_type, target_key) values
  ('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'ingredient', '11000000-0000-4000-8000-000000000001'),
  ('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'category', 'Dairy & eggs');
select tests.is((select jsonb_array_length(public.household_store_book('aa000000-0000-4000-8000-0000000000aa') -> 'stores')), 2, 'book lists both stores');
select tests.is((select jsonb_array_length(public.household_store_book('aa000000-0000-4000-8000-0000000000aa') -> 'placements')), 2, 'book lists placements');

-- one aisle per (store, target); a placement cannot point at another store's aisle
select tests.throws($$ insert into public.store_placements (household_id, store_id, aisle_id, target_type, target_key)
  values ('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'ingredient', '11000000-0000-4000-8000-000000000001') $$, '23505', 'one placement per store target');
select tests.throws($$ insert into public.store_placements (household_id, store_id, aisle_id, target_type, target_key)
  values ('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'category', 'Frozen') $$, '23503', 'aisle must belong to the same store');
select tests.throws($$ insert into public.stores (household_id, name) values ('aa000000-0000-4000-8000-0000000000aa', 'aldi gosforth') $$, '23505', 'store names unique per household (case-insensitive)');
select tests.throws($$ insert into public.store_placements (household_id, store_id, aisle_id, target_type, target_key)
  values ('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'bogus', 'x') $$, '23514', 'target_type constrained');

-- copy a layout: new aisle ids, placements follow, target replaced wholesale
select tests.is((select public.copy_store_layout('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002')::bigint), 2, 'copied two aisles');
select tests.is((select count(*) from public.store_aisles where store_id = '51000000-0000-4000-8000-000000000002'), 2, 'target has the copied aisles only');
select tests.is((select count(*) from public.store_placements where store_id = '51000000-0000-4000-8000-000000000002'), 2, 'placements copied');
select tests.is((select count(*) from public.store_placements p join public.store_aisles a on a.id = p.aisle_id and a.store_id = p.store_id
                  where p.store_id = '51000000-0000-4000-8000-000000000002'), 2, 'copied placements point at the target store aisles');
select tests.throws($$ select public.copy_store_layout('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001') $$, '22023', 'cannot copy onto itself');

-- isolation: another household sees nothing and cannot write into ours
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.stores), 0, 'non-member sees no stores');
select tests.is((select count(*) from public.store_placements), 0, 'non-member sees no placements');
select tests.throws($$ insert into public.stores (household_id, name) values ('aa000000-0000-4000-8000-0000000000aa', 'Sneaky') $$, '42501', 'non-member cannot create a store in our household');
select tests.throws($$ select public.copy_store_layout('aa000000-0000-4000-8000-0000000000aa', '51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002') $$, null, 'non-member cannot copy');
select tests.is((select jsonb_array_length(public.household_store_book('aa000000-0000-4000-8000-0000000000aa') -> 'stores')), 0, 'book is empty for a non-member');
update public.stores set name = 'Hacked' where id = '51000000-0000-4000-8000-000000000001';
delete from public.stores where id = '51000000-0000-4000-8000-000000000001';
select tests.reset_actor();
select tests.ok((select name from public.stores where id = '51000000-0000-4000-8000-000000000001') = 'ALDI Gosforth', 'non-member update/delete touched nothing');
select tests.act_as_anon();
select tests.throws($$ select * from public.stores $$, '42501', 'anon has no access');

-- a placement cannot use another household as its household_id
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ insert into public.store_aisles (household_id, store_id, label) values
  ('cc000000-0000-4000-8000-0000000000cc', '51000000-0000-4000-8000-000000000001', 'x') $$, '23503', 'composite FK rejects a store from another household');

-- deleting an aisle removes its placements; deleting a store removes everything under it
select tests.act_as('b0000000-0000-4000-8000-000000000002');
delete from public.store_aisles where id = 'a1000000-0000-4000-8000-000000000002';
select tests.is((select count(*) from public.store_placements where store_id = '51000000-0000-4000-8000-000000000001'), 1, 'aisle delete cascades its placements');
delete from public.stores where id = '51000000-0000-4000-8000-000000000001';
select tests.is((select count(*) from public.store_aisles where store_id = '51000000-0000-4000-8000-000000000001'), 0, 'store delete cascades aisles');

-- grace period: read-only
select tests.reset_actor();
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.stores (household_id, name) values ('aa000000-0000-4000-8000-0000000000aa', 'Late') $$, '42501', 'read-only household: no store writes');
select tests.is((select count(*) from public.stores), 1, 'read-only: reads still work');

rollback;
