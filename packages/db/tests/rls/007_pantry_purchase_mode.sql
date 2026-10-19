-- pantry_settings.purchase_mode is the source of truth; households.pantry_deduct_on_purchase is a derived mirror (D104).
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test');

-- A legacy row (flag set before this migration existed): the pin trigger would normalise it, so bypass it for the fixture.
alter table public.households disable trigger households_pin_pantry_deduct;
insert into public.households (id, name, created_by, pantry_deduct_on_purchase) values
  ('bb000000-0000-4000-8000-0000000000bb', 'Legacy home', 'b0000000-0000-4000-8000-000000000002', true);
alter table public.households enable trigger households_pin_pantry_deduct;

insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001');

-- backfill: the legacy flag with no settings row becomes mode 'auto'; households without the flag get no row
select tests.is(public.backfill_pantry_purchase_mode(), 1, 'backfill creates one settings row');
select tests.ok((select purchase_mode = 'auto' from public.pantry_settings where household_id = 'bb000000-0000-4000-8000-0000000000bb'), 'legacy flag -> auto');
select tests.is((select count(*) from public.pantry_settings where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'unflagged household untouched');
select tests.is(public.backfill_pantry_purchase_mode(), 0, 'backfill is idempotent');
select tests.ok((select pantry_deduct_on_purchase from public.households where id = 'bb000000-0000-4000-8000-0000000000bb'), 'legacy mirror stays true');

-- a new household mirrors "no setting" as false
select tests.ok(not (select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'new household: false');

-- the member writes the SETTING; the mirror follows
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.pantry_settings (household_id, purchase_mode) values ('aa000000-0000-4000-8000-0000000000aa', 'auto');
select tests.ok((select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'auto -> true');
update public.pantry_settings set purchase_mode = 'suggest' where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok(not (select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'suggest -> false');
update public.pantry_settings set purchase_mode = 'auto' where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok((select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'auto again -> true');
update public.pantry_settings set purchase_mode = 'off' where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok(not (select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'off -> false');

-- a direct write to the legacy column cannot drift from the setting (superuser and member alike)
select tests.reset_actor();
update public.households set pantry_deduct_on_purchase = true where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok(not (select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'direct write ignored (setting is off)');
update public.pantry_settings set purchase_mode = 'auto' where household_id = 'aa000000-0000-4000-8000-0000000000aa';
update public.households set pantry_deduct_on_purchase = false where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok((select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'direct write ignored (setting is auto)');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
update public.households set name = 'Alice home 2' where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok((select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'unrelated household update keeps the mirror');

-- removing the setting row resets the mirror
select tests.reset_actor();
delete from public.pantry_settings where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.ok(not (select pantry_deduct_on_purchase from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 'deleted setting -> false');

-- the backfill function is not callable by app roles
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.backfill_pantry_purchase_mode() $$, '42501', 'authenticated cannot run the backfill');

rollback;
