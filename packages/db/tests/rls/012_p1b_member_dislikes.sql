-- P1-B (D378): member_dislikes (soft, per-person) + set_member_dislikes(). Members read the whole household's list; each member
-- edits their own; the owner edits anyone's; outsiders see and change nothing; read-only during the deletion grace period;
-- constraints (lower-case trimmed terms, unique per member, <= 30); removing a member removes their dislikes; the function
-- replaces a list atomically and runs as the caller (RLS is the authority).
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol home', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'member', 'Bob'),
  ('aa000000-0000-4000-8000-0000000000aa', 'd0000000-0000-4000-8000-000000000004', 'member', 'Dave');

-- ---- a member sets their own list; terms are normalised and de-duplicated ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is(public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002',
                array['Mushrooms', ' mushrooms ', 'olives', '']), 2, 'two distinct normalised terms stored');
select tests.is((select count(*) from public.member_dislikes where member_user_id = 'b0000000-0000-4000-8000-000000000002'), 2, 'bob has two');
select tests.ok((select bool_and(term = lower(btrim(term))) from public.member_dislikes), 'terms are stored lower-case and trimmed');
select tests.ok((select bool_and(created_by = 'b0000000-0000-4000-8000-000000000002') from public.member_dislikes), 'created_by is the editor');

-- replacing the list is atomic and complete
select tests.is(public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', array['coriander']), 1, 'replaced');
select tests.is((select count(*) from public.member_dislikes where member_user_id = 'b0000000-0000-4000-8000-000000000002'), 1, 'only the new term remains');

-- ---- every member can READ the household's dislikes (so the planner chips can show them) ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.member_dislikes), 1, 'owner reads bob''s list');

-- ---- a plain member cannot edit another member's list ----
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.is((select count(*) from public.member_dislikes), 1, 'dave reads it too');
select tests.throws($$ select public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', array['x']) $$,
  '42501', 'a member cannot rewrite another member''s list');
select tests.throws($$ insert into public.member_dislikes (household_id, member_user_id, term)
  values ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'sneaky') $$, '42501', 'nor insert into it');
delete from public.member_dislikes where member_user_id = 'b0000000-0000-4000-8000-000000000002';
update public.member_dislikes set term = 'hacked' where member_user_id = 'b0000000-0000-4000-8000-000000000002';
select tests.reset_actor();
select tests.is((select count(*) from public.member_dislikes where term = 'coriander'), 1, 'delete/update by another member touched nothing');

-- ---- the owner can edit anyone's list ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is(public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'd0000000-0000-4000-8000-000000000004', array['liver', 'fish']), 2,
                'owner sets dave''s list');
select tests.is((select count(*) from public.member_dislikes where member_user_id = 'd0000000-0000-4000-8000-000000000004'), 2, 'dave has two');

-- ---- you can only dislike things as a member of the household ----
select tests.throws($$ select public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', array['x']) $$,
  '23503', 'a non-member id violates the membership foreign key');

-- ---- constraints ----
select tests.throws($$ insert into public.member_dislikes (household_id, member_user_id, term)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'Olives') $$, '23514', 'upper-case term rejected');
select tests.throws($$ insert into public.member_dislikes (household_id, member_user_id, term)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', ' ') $$, '23514', 'blank term rejected');
select tests.throws($$ insert into public.member_dislikes (household_id, member_user_id, term)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', repeat('a', 61)) $$, '23514', 'over-long term rejected');
insert into public.member_dislikes (household_id, member_user_id, term) values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'celery');
select tests.throws($$ insert into public.member_dislikes (household_id, member_user_id, term)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'celery') $$, '23505', 'duplicate term for the same member rejected');
select tests.throws($$ select public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
  (select array_agg('t' || g) from generate_series(1, 31) g)) $$, '22023', 'more than 30 terms rejected');
select tests.is((select count(*) from public.member_dislikes where member_user_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'a rejected replace leaves the list as it was');

-- ---- the list is not health data: no consent needed, and it is separate from exclusions ----
select tests.is((select count(*) from public.household_exclusions), 0, 'dislikes never create exclusions');

-- ---- outsiders see and change nothing ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.member_dislikes), 0, 'outsider sees no dislikes');
select tests.throws($$ select public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', array['x']) $$,
  '42501', 'outsider cannot set a household member''s list');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is(public.set_member_dislikes('cc000000-0000-4000-8000-0000000000cc', 'c0000000-0000-4000-8000-000000000003', array['beetroot']), 1,
                'carol has her own household');

-- ---- removing a member removes their dislikes ----
select tests.reset_actor();
delete from public.household_members where household_id = 'aa000000-0000-4000-8000-0000000000aa' and user_id = 'd0000000-0000-4000-8000-000000000004';
select tests.is((select count(*) from public.member_dislikes where member_user_id = 'd0000000-0000-4000-8000-000000000004'), 0, 'dave''s dislikes went with his membership');

-- ---- read-only during the deletion grace period ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.throws($$ select public.set_member_dislikes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', array['x']) $$,
  '42501', 'no writes while the household is pending deletion');
select tests.is((select count(*) from public.member_dislikes where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 2, 'reads still work (celery + coriander)');

rollback;
