-- P2-A (D390-D399): store_locations. Household members read; members of a writable household write; nobody else; one row per
-- store; coordinates and radius are range-checked; the row follows the store; no table can hold a live position.
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

-- a non-owner member saves a location for a store
select tests.act_as('b0000000-0000-4000-8000-000000000002');
insert into public.stores (id, household_id, name) values
  ('51000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tesco Extra'),
  ('51000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'ALDI');
insert into public.store_locations (store_id, household_id, lat, lng, radius_m, source) values
  ('51000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 54.97, -1.61, 150, 'device');
insert into public.store_locations (store_id, household_id, lat, lng, source, postcode) values
  ('51000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 55.0, -1.62, 'postcode', 'NE3 1AA');
select tests.is((select count(*) from public.store_locations), 2, 'member sees both locations');
select tests.is((select radius_m from public.store_locations where source = 'postcode'), 150, 'radius defaults to 150 m');

-- constraints
select tests.throws($$ insert into public.store_locations (store_id, household_id, lat, lng, source)
  values ('51000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 54.0, -1.0, 'device') $$, '23505', 'one location per store');
select tests.throws($$ update public.store_locations set lat = 91 where source = 'device' $$, '23514', 'latitude range');
select tests.throws($$ update public.store_locations set lng = -181 where source = 'device' $$, '23514', 'longitude range');
select tests.throws($$ update public.store_locations set radius_m = 10 where source = 'device' $$, '23514', 'radius lower bound');
select tests.throws($$ update public.store_locations set radius_m = 5000 where source = 'device' $$, '23514', 'radius upper bound');
select tests.throws($$ update public.store_locations set source = 'gps' where source = 'device' $$, '23514', 'source constrained');
select tests.throws($$ update public.store_locations set postcode = 'NE3 1AA' where source = 'device' $$, '23514', 'a device location has no postcode');
select tests.throws($$ update public.store_locations set postcode = null where source = 'postcode' $$, '23514', 'a postcode location names its postcode');

-- the location follows its store: a different household id cannot be attached (composite FK)
select tests.throws($$ insert into public.store_locations (store_id, household_id, lat, lng, source)
  values ('51000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000cc', 1, 1, 'device') $$, null, 'location cannot name another household');

-- isolation
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.store_locations), 0, 'non-member sees no locations');
select tests.throws($$ insert into public.store_locations (store_id, household_id, lat, lng, source)
  values ('51000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 1, 1, 'device') $$, null, 'non-member cannot write a location into our household');
update public.store_locations set lat = 0 where true;
delete from public.store_locations where true;
select tests.reset_actor();
select tests.is((select count(*) from public.store_locations), 2, 'non-member update/delete touched nothing');
select tests.ok((select lat from public.store_locations where source = 'device') = 54.97, 'latitude unchanged');
select tests.act_as_anon();
select tests.throws($$ select * from public.store_locations $$, '42501', 'anon has no access');
select tests.reset_actor();

-- a member can clear a location; deleting a store removes its location
select tests.act_as('b0000000-0000-4000-8000-000000000002');
delete from public.store_locations where source = 'postcode';
select tests.is((select count(*) from public.store_locations), 1, 'member can clear a location');
delete from public.stores where id = '51000000-0000-4000-8000-000000000001';
select tests.is((select count(*) from public.store_locations), 0, 'deleting the store deletes its location');

-- read-only (pending deletion) households cannot change locations
select tests.reset_actor();
insert into public.stores (id, household_id, name) values ('51000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Lidl');
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days' where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ insert into public.store_locations (store_id, household_id, lat, lng, source)
  values ('51000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 1, 1, 'device') $$, '42501', 'no location writes while pending deletion');
select tests.reset_actor();

-- the near_store notification type is valid (so the member's choice can be saved), unknown types still are not
select tests.ok(public.notification_type_is_valid('near_store'), 'near_store is a valid notification type');
select tests.ok(not public.notification_type_is_valid('live_position'), 'unknown types are rejected');

rollback;
