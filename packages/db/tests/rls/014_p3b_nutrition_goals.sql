-- P3-B (D430-D434): nutrition goals are special category data. Own rows only (not other members, not the owner), writes need an
-- ACTIVE nutrition_goals consent, withdrawal deletes the data, leaving deletes it, the planner sees only anonymous goal ids and
-- only from members who opted in, the household is read-only during the deletion grace period, constraints hold.
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

-- ---- no consent: nothing can be stored, however it is attempted ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre'], 1, false, true) $$,
  '42501', 'the function refuses without consent');
select tests.throws($$ insert into public.nutrition_goal_profiles (household_id, adult_confirmed_at)
  values ('aa000000-0000-4000-8000-0000000000aa', now()) $$, '42501', 'a direct profile insert is refused without consent');
select tests.is((select count(*) from public.nutrition_goal_profiles), 0, 'nothing stored');
select tests.is((select count(*) from public.nutrition_goals), 0, 'no goals stored');

-- ---- consent, then goals ----
insert into public.consent_records (household_id, consent_type, wording_version)
  values ('aa000000-0000-4000-8000-0000000000aa', 'nutrition_goals', 'g1');
select tests.is(public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre', 'less_salt', 'more_fibre', ''], 0.5, true, true), 2,
  'two distinct goals stored');
select tests.is((select count(*) from public.nutrition_goals), 2, 'bob sees two goals');
select tests.ok((select portion_share = 0.5 and nudge_plan from public.nutrition_goal_profiles), 'profile saved');
-- replacing is complete
select tests.is(public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['less_sugar'], 1, false, false), 1, 'replaced (adult already confirmed)');
select tests.is((select count(*) from public.nutrition_goals where goal = 'less_sugar'), 1, 'the new goal is there');
select tests.is((select count(*) from public.nutrition_goals), 1, 'and only it');

-- ---- constraints ----
select tests.throws($$ insert into public.nutrition_goals (household_id, user_id, goal)
  values ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'lose_weight') $$, '23514', 'unknown goal rejected (no weight-loss goals exist)');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre'], 3, false, false) $$,
  '23514', 'portion share out of range rejected');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa',
  array['more_fibre','less_salt','less_sugar','more_fruit_veg','more_oily_fish','less_red_processed_meat','x'], 1, false, false) $$,
  '22023', 'more than six goals rejected');
select tests.is((select count(*) from public.nutrition_goals), 1, 'a rejected replace leaves the goals as they were');

-- ---- nobody else can see or touch them: not another member, not the household owner ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.nutrition_goals), 0, 'the owner sees no goals');
select tests.is((select count(*) from public.nutrition_goal_profiles), 0, 'the owner sees no profile');
delete from public.nutrition_goals;
update public.nutrition_goal_profiles set nudge_plan = true;
select tests.reset_actor();
select tests.is((select count(*) from public.nutrition_goals), 1, 'owner delete touched nothing');
select tests.ok((select not nudge_plan from public.nutrition_goal_profiles), 'owner update touched nothing');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.nutrition_goals), 0, 'an outsider sees nothing');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre'], 1, false, true) $$,
  '42501', 'an outsider cannot write into the household');

-- ---- the planner sees only anonymous ids, only from members who opted in and consented ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok(public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa') = '{}', 'no opt-in: nothing for the planner');
select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['less_sugar', 'more_fibre'], 1, true, false);
select tests.ok(public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa') = array['less_sugar', 'more_fibre']::text[] or
                public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa') = array['more_fibre', 'less_sugar']::text[], 'opted in: goal ids only');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok(cardinality(public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa')) = 2, 'another member planning gets the ids');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa') $$, '42501', 'an outsider cannot ask');

-- ---- withdrawing the consent deletes the stored goals ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
update public.consent_records set withdrawn_at = now() where consent_type = 'nutrition_goals';
select tests.is((select count(*) from public.nutrition_goals), 0, 'withdrawal deleted the goals');
select tests.is((select count(*) from public.nutrition_goal_profiles), 0, 'and the profile');
select tests.ok(public.planner_goal_nudge('aa000000-0000-4000-8000-0000000000aa') = '{}', 'and the planner sees nothing');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre'], 1, false, true) $$,
  '42501', 'writing is refused again after withdrawal');

-- ---- consent again, then leaving the household deletes the goals ----
insert into public.consent_records (household_id, consent_type, wording_version)
  values ('aa000000-0000-4000-8000-0000000000aa', 'nutrition_goals', 'g1');
select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fruit_veg'], 1, false, true);
select tests.is((select count(*) from public.nutrition_goals), 1, 'goals again');
select public.member_leave('aa000000-0000-4000-8000-0000000000aa');
select tests.reset_actor();
select tests.is((select count(*) from public.nutrition_goals), 0, 'leaving deleted the goals');
select tests.is((select count(*) from public.nutrition_goal_profiles), 0, 'and the profile');

-- ---- read-only while the household is pending deletion ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.consent_records (household_id, consent_type, wording_version)
  values ('aa000000-0000-4000-8000-0000000000aa', 'nutrition_goals', 'g1');
select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['less_salt'], 1, false, true);
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.throws($$ select public.set_nutrition_goals('aa000000-0000-4000-8000-0000000000aa', array['more_fibre'], 1, false, true) $$,
  '42501', 'no writes in the grace period');
select tests.is((select count(*) from public.nutrition_goals), 1, 'but your own goals stay readable (export)');

select tests.reset_actor();
rollback;
