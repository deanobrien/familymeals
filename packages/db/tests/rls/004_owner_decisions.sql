-- Owner decisions (0014):
--   (a) purchase history survives account deletion (created_by nullable + display-name snapshot)
--   (d) household is READ-ONLY for members during the 14-day deletion grace period
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'member', 'Carol C'),
  ('aa000000-0000-4000-8000-0000000000aa', 'd0000000-0000-4000-8000-000000000004', 'member', 'Dave D');
insert into public.recipes (id, household_id, title) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Biryani');
insert into public.shopping_lists (id, household_id, name) values
  ('a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'This week');
insert into public.shopping_list_items (id, shopping_list_id, household_id, display_name, quantity_kind, quantity_value, unit) values
  ('a7000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   'Onions', 'exact', 10, 'item');

-- ===================== (a) purchases survive account deletion =====================
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":2,"unit":"item","originalText":"2 onions"}', 30) ->> 'status' = 'applied',
                'carol records a purchase');
select tests.ok((select created_by_display_name = 'Carol C' and created_by = 'c0000000-0000-4000-8000-000000000003'
                   from public.purchase_events where id = 'ae000000-0000-4000-8000-000000000001'),
                'display name snapshotted at insert');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok(public.void_purchase('af000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001') ->> 'status' = 'applied',
                'alice voids carol''s purchase');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select public.record_purchase('ae000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":3,"unit":"item","originalText":"3 onions"}', 45);

select tests.reset_actor();
delete from auth.users where id = 'c0000000-0000-4000-8000-000000000003';
select tests.is((select count(*) from public.purchase_events), 2, 'purchase history survives account deletion');
select tests.ok((select created_by is null and created_by_display_name = 'Carol C'
                   from public.purchase_events where id = 'ae000000-0000-4000-8000-000000000002'),
                'created_by nulled, display name kept');
select tests.ok((select voided_at is not null and voided_by = 'a0000000-0000-4000-8000-000000000001'
                   from public.purchase_events where id = 'ae000000-0000-4000-8000-000000000001'),
                'void by a surviving account is untouched');
select tests.throws($$ update public.purchase_events set quantity_value = 9 where id = 'ae000000-0000-4000-8000-000000000002' $$,
                    '23514', 'append-only still enforced for other updates');
select tests.throws($$ update public.purchase_events set created_by = 'd0000000-0000-4000-8000-000000000004'
                      where id = 'ae000000-0000-4000-8000-000000000002' $$,
                    '23514', 'actor cannot be re-pointed (only anonymised)');

-- ===================== (d) read-only grace period =====================
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is(tests.affected($$ update public.recipes set title = 'Biryani v2' $$), 1, 'writes work while active');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');

-- reads still work
select tests.is((select count(*) from public.recipes), 1, 'owner can still read during grace');
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.is((select count(*) from public.recipes), 1, 'member can still read during grace');
select tests.is((select count(*) from public.shopping_list_items), 1, 'member can still read items during grace');

-- member writes are refused
select tests.throws($$ insert into public.recipes (household_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'New') $$,
                    '42501', 'member cannot insert during grace (RLS)');
select tests.is(tests.affected($$ update public.recipes set title = 'Hacked' $$), 0, 'member cannot update during grace');
select tests.is(tests.affected($$ delete from public.recipes $$), 0, 'member cannot delete during grace');
select tests.throws($$ insert into public.pantry_items (household_id, display_name, quantity_kind, quantity_value, unit)
                      values ('aa000000-0000-4000-8000-0000000000aa', 'Rice', 'exact', 1, 'kg') $$,
                    '42501', 'member cannot add pantry items during grace');
select tests.throws($$ select public.record_purchase('ae000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'tick') $$,
                    '42501', 'record_purchase refused during grace');
select tests.throws($$ select public.void_purchase('af000000-0000-4000-8000-000000000009', 'ae000000-0000-4000-8000-000000000002') $$,
                    '42501', 'void_purchase refused during grace');

-- owner is read-only too, except lifecycle controls
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.recipes (household_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'New') $$,
                    '42501', 'owner cannot insert during grace');
select tests.is(tests.affected($$ update public.households set name = 'Renamed' $$), 0, 'owner cannot rename during grace');
select tests.throws($$ select public.create_invitation('aa000000-0000-4000-8000-0000000000aa') $$,
                    '42501', 'owner cannot invite during grace');

-- leaving still works during the grace period
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select public.member_leave('aa000000-0000-4000-8000-0000000000aa');
select tests.is((select count(*) from public.recipes), 0, 'dave left and lost access');

-- cancel restores write access
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.cancel_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.ok((select status = 'active' from public.households), 'owner can cancel deletion during grace');
select tests.is(tests.affected($$ update public.recipes set title = 'Biryani v3' $$), 1, 'writes work again after cancel');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000001', 'tick') ->> 'status' = 'applied',
                'purchases work again after cancel');

rollback;
