-- PR1 (D280-D289): pantry_par_levels + restock_settings. Members read/write; outsiders see nothing; read-only during the
-- deletion grace period; constraints; one minimum per ingredient / free-text name; survives deleting the pantry row.
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
insert into public.ingredients (id, name, slug, category, form) values
  ('11000000-0000-4000-8000-000000000001', 'Tinned tomatoes', 'tinned-tomatoes', 'Tins', 'canned'),
  ('11000000-0000-4000-8000-000000000002', 'Pasta', 'pasta', 'Grains', 'dried');

-- ---- a member creates a minimum with a pack size and restock-to ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.pantry_par_levels (id, household_id, ingredient_id, display_name, unit, min_value, restock_to_value, pack_value, pack_unit)
values ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000001',
        'Tinned tomatoes', 'can', 6, 8, 1, 'can');
insert into public.pantry_par_levels (id, household_id, display_name, unit, min_value)
values ('f1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Birthday candles', 'item', 10);
select tests.is((select count(*) from public.pantry_par_levels), 2, 'member sees both minimums');
select tests.ok((select created_by = 'a0000000-0000-4000-8000-000000000001' from public.pantry_par_levels where display_name = 'Birthday candles'),
                'created_by defaults to the member');
select tests.ok((select not enabled is false and snoozed_until is null from public.pantry_par_levels where display_name = 'Birthday candles'),
                'enabled by default, not snoozed');

-- a second member reads and edits (snooze + disable)
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.pantry_par_levels), 2, 'second member sees them');
update public.pantry_par_levels set snoozed_until = current_date + 7 where id = 'f1000000-0000-4000-8000-000000000001';
select tests.ok((select snoozed_until = current_date + 7 from public.pantry_par_levels where id = 'f1000000-0000-4000-8000-000000000001'), 'member snoozes');
insert into public.restock_settings (household_id, auto_add) values ('aa000000-0000-4000-8000-0000000000aa', true);
select tests.ok((select auto_add from public.restock_settings), 'member saves the auto-add setting');

-- ---- uniqueness: one per ingredient, one per normalised free-text name ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.pantry_par_levels (household_id, ingredient_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000001', 'Tomatoes again', 'can', 3) $$,
  '23505', 'second minimum for the same ingredient rejected');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', '  BIRTHDAY candles ', 'item', 3) $$,
  '23505', 'same free-text name (case/space-insensitive) rejected');

-- ---- check constraints ----
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', 'zero', 'item', 0) $$, '23514', 'min must be positive');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value, restock_to_value)
  values ('aa000000-0000-4000-8000-0000000000aa', 'low top-up', 'item', 5, 2) $$, '23514', 'restock-to cannot be below the minimum');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value, pack_value)
  values ('aa000000-0000-4000-8000-0000000000aa', 'half pack', 'item', 5, 2) $$, '23514', 'pack value needs a pack unit');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value, pack_value, pack_unit)
  values ('aa000000-0000-4000-8000-0000000000aa', 'neg pack', 'g', 500, -1, 'g') $$, '23514', 'pack must be positive');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', '   ', 'item', 1) $$, '23514', 'blank name rejected');

-- ---- a minimum survives the pantry row going away ----
select tests.reset_actor();
insert into public.pantry_items (id, household_id, ingredient_id, display_name, quantity_kind, quantity_value, unit, source)
values ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000001',
        'Tinned tomatoes', 'exact', 2, 'can', 'manual');
delete from public.pantry_items where id = 'e1000000-0000-4000-8000-000000000001';
select tests.is((select count(*) from public.pantry_par_levels where ingredient_id = '11000000-0000-4000-8000-000000000001'), 1,
                'minimum remains after the stock row is deleted');

-- ---- outsiders see and change nothing ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.pantry_par_levels), 0, 'outsider sees no minimums');
select tests.is((select count(*) from public.restock_settings), 0, 'outsider sees no settings');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', 'sneaky', 'item', 1) $$, '42501', 'outsider cannot insert into another household');
update public.pantry_par_levels set min_value = 99 where household_id = 'aa000000-0000-4000-8000-0000000000aa';
delete from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.reset_actor();
select tests.is((select count(*) from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa' and min_value = 6), 1,
                'outsider update/delete touched nothing');
select tests.is((select count(*) from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 2, 'both rows intact');

-- Carol can have the same ingredient in her own household (uniqueness is per household)
select tests.act_as('c0000000-0000-4000-8000-000000000003');
insert into public.pantry_par_levels (household_id, ingredient_id, display_name, unit, min_value)
values ('cc000000-0000-4000-8000-0000000000cc', '11000000-0000-4000-8000-000000000001', 'Tinned tomatoes', 'can', 4);
select tests.is((select count(*) from public.pantry_par_levels), 1, 'carol has her own');

-- ---- read-only during the deletion grace period ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.is((select count(*) from public.pantry_par_levels), 2, 'still readable while pending deletion');
select tests.throws($$ insert into public.pantry_par_levels (household_id, display_name, unit, min_value)
  values ('aa000000-0000-4000-8000-0000000000aa', 'late add', 'item', 1) $$, '42501', 'insert refused while pending deletion');
update public.pantry_par_levels set min_value = 99 where id = 'f1000000-0000-4000-8000-000000000001';
delete from public.pantry_par_levels where id = 'f1000000-0000-4000-8000-000000000002';
update public.restock_settings set auto_add = false where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.reset_actor();
select tests.is((select count(*) from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa' and min_value = 6), 1,
                'update refused while pending deletion (0 rows)');
select tests.is((select count(*) from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 2, 'delete refused while pending deletion');
select tests.ok((select auto_add from public.restock_settings where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 'settings write refused while pending deletion');

-- ---- the household purge cascades ----
delete from public.households where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.is((select count(*) from public.pantry_par_levels where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'purge cascades to minimums');
select tests.is((select count(*) from public.restock_settings where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'purge cascades to settings');

rollback;
