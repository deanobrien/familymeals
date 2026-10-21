-- P2-C (D410-D419): derived busy flags, private ICS feed address, leftover batches + ledger, leftover plan slots.
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
insert into public.recipes (id, household_id, title) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Chilli');

-- ---- busy flags ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.plan_busy_days (household_id, day, source, minutes_available) values
  ('aa000000-0000-4000-8000-0000000000aa', '2026-10-21', 'device', 45),
  ('aa000000-0000-4000-8000-0000000000aa', '2026-10-22', 'manual', null);
insert into public.member_calendar_feeds (household_id, url_encrypted, host_hint) values
  ('aa000000-0000-4000-8000-0000000000aa', 'v1.aaaaaaaaaaaa.bbbbbbbbbbbbbbbb.cccccccccccccccc', 'calendar.google.com');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.plan_busy_days), 2, 'members see the household busy flags');
select tests.is((select count(*) from public.member_calendar_feeds), 0, 'a feed address is visible to its owner only');
select tests.throws($$ insert into public.plan_busy_days (household_id, day, source, user_id)
  values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-23', 'device', 'a0000000-0000-4000-8000-000000000001') $$, '42501', 'cannot write a flag as someone else');
delete from public.plan_busy_days where source = 'device';  -- another member's device flag: not deletable
delete from public.plan_busy_days where source = 'manual';  -- a manual toggle: anyone may clear it
select tests.reset_actor();
select tests.is((select count(*) from public.plan_busy_days where source = 'device'), 1, 'device flags survive another member');
select tests.is((select count(*) from public.plan_busy_days where source = 'manual'), 0, 'a manual toggle can be cleared by any member');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.plan_busy_days (household_id, day, source, minutes_available)
  values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-24', 'ics', 5000) $$, '23514', 'minutes are bounded');

select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.plan_busy_days), 0, 'outsider sees no flags');
select tests.throws($$ insert into public.plan_busy_days (household_id, day, source)
  values ('aa000000-0000-4000-8000-0000000000aa', '2026-10-24', 'manual') $$, '42501', 'outsider cannot write flags');

-- ---- leftovers ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.leftover_batches (id, household_id, recipe_id, title, portions_made, stored_in, cooked_on, use_by, source_key) values
  ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 'Chilli', 4, 'freezer', '2026-10-21', '2027-01-21', 'cooked:1');
select tests.throws($$ insert into public.leftover_batches (household_id, title, portions_made, stored_in, cooked_on, use_by, source_key)
  values ('aa000000-0000-4000-8000-0000000000aa', 'Chilli again', 4, 'fridge', '2026-10-21', '2026-10-23', 'cooked:1') $$, '23505', 'one batch per cooked event');
select tests.throws($$ insert into public.leftover_batches (household_id, title, portions_made, stored_in, cooked_on, use_by)
  values ('aa000000-0000-4000-8000-0000000000aa', 'Soup', 2, 'shelf', '2026-10-21', '2026-10-23') $$, '23514', 'fridge or freezer only');

insert into public.leftover_consumptions (batch_id, household_id, consume_key, portions) values
  ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'plan:p1|2026-10-22|dinner', 2);
select tests.throws($$ insert into public.leftover_consumptions (batch_id, household_id, consume_key, portions)
  values ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'plan:p1|2026-10-22|dinner', 2) $$, '23505', 'the same key cannot take portions twice');
select tests.throws($$ insert into public.leftover_consumptions (batch_id, household_id, consume_key, portions)
  values ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'plan:p1|2026-10-23|dinner', 3) $$, '23514', 'cannot take more than is left');
insert into public.leftover_consumptions (batch_id, household_id, consume_key, portions, kind) values
  ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'plan:p1|2026-10-23|dinner', 2, 'eaten');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.leftover_batches), 1, 'members see household leftovers');
select tests.is((select count(*) from public.leftover_consumptions), 2, 'members see the ledger');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.leftover_batches), 0, 'outsider sees no leftovers');
select tests.throws($$ insert into public.leftover_consumptions (batch_id, household_id, consume_key, portions)
  values ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'x', 1) $$, '42501', 'outsider cannot touch the ledger');
select tests.act_as_anon();
select tests.throws($$ select * from public.leftover_batches $$, '42501', 'anon has no access');

-- ---- a plan slot that points at a batch keeps it (save_meal_plan / select_meal_plans) ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.save_meal_plan('aa000000-0000-4000-8000-0000000000aa', null, jsonb_build_object(
  'id', 'd1000000-0000-4000-8000-000000000001', 'weekStart', '2026-10-19', 'status', 'draft', 'mealTypes', jsonb_build_array('dinner'),
  'entries', jsonb_build_object(
    '2026-10-24|dinner', jsonb_build_object('kind', 'leftovers', 'batchId', 'f1000000-0000-4000-8000-000000000001', 'portions', 2),
    '2026-10-25|dinner', jsonb_build_object('kind', 'leftovers'))));
select tests.is((select count(*) from public.planned_meals where leftover_batch_id = 'f1000000-0000-4000-8000-000000000001' and servings = 2), 1, 'leftover slot stores batch and portions');
select tests.is((select count(*) from public.planned_meals where kind = 'leftovers' and leftover_batch_id is null), 1, 'a generic leftovers slot still works');
select tests.is((select jsonb_array_length(public.select_meal_plans('aa000000-0000-4000-8000-0000000000aa') -> 0 -> 'meals')), 2, 'plan reads back');

-- deleting the batch degrades the slot, never deletes the plan
delete from public.leftover_batches where id = 'f1000000-0000-4000-8000-000000000001';
select tests.is((select count(*) from public.planned_meals where kind = 'leftovers' and leftover_batch_id is null), 2, 'slot survives a deleted batch');

-- ---- a leaving member takes their feed and device flags, not the household's manual flags or food ----
select tests.reset_actor();
insert into public.plan_busy_days (household_id, day, source, user_id) values
  ('aa000000-0000-4000-8000-0000000000aa', '2026-10-26', 'device', 'b0000000-0000-4000-8000-000000000002');
update public.household_members set status = 'left' where household_id = 'aa000000-0000-4000-8000-0000000000aa' and user_id = 'b0000000-0000-4000-8000-000000000002';
select tests.is((select count(*) from public.plan_busy_days where user_id = 'b0000000-0000-4000-8000-000000000002' and source = 'device'), 0, 'leaver device flags removed');

rollback;
