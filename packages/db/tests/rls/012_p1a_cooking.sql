-- P1-A (D360-D369): cooked history, private/household cook notes, "don't suggest again". Household members read history,
-- authors alone write their rows, private notes are invisible to everyone else, a leaving member takes their rows with them.
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
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Chilli'),
  ('e2000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000cc', 'Carol soup');

-- Alice cooks twice (one rated, with a private note); Bob cooks once with a household note
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.recipe_cooked (id, household_id, recipe_id, servings, rating, cooked_at) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 4, 4, now() - interval '3 days'),
  ('c1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 6, null, now() - interval '1 day');
insert into public.recipe_cook_notes (cooked_id, household_id, note, is_private) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'less chilli next time', true);
insert into public.recipe_dont_suggest (recipe_id, household_id) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
insert into public.recipe_cooked (id, household_id, recipe_id, servings, rating) values
  ('c1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 2, 5);
insert into public.recipe_cook_notes (cooked_id, household_id, note, is_private) values
  ('c1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Great with rice', false);

select tests.is((select count(*) from public.recipe_cooked), 3, 'members see everyone''s cooked history');
select tests.is((select count(*) from public.recipe_dont_suggest), 1, 'members see the household flags');
select tests.is((select count(*) from public.recipe_cook_notes), 1, 'Bob sees his own household note but not Alice''s private one');
select tests.is((select (jsonb_array_elt) ->> 'cookedCount' from (select jsonb_array_elements(public.recipe_cook_summaries('aa000000-0000-4000-8000-0000000000aa')) as jsonb_array_elt) s)::bigint, 3, 'summary counts all cooks');

-- the other way round: Alice sees Bob's household note and her own private one
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.recipe_cook_notes), 2, 'Alice sees her private note and Bob''s household note');

-- authorship: nobody writes as someone else, or onto someone else's cooked event
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, user_id, servings)
  values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 2) $$, '42501', 'cannot record a cook as someone else');
select tests.throws($$ insert into public.recipe_cook_notes (cooked_id, household_id, note)
  values ('c1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'sneaky') $$, '42501', 'cannot note someone else''s cook');
update public.recipe_cooked set servings = 99 where id = 'c1000000-0000-4000-8000-000000000001';
delete from public.recipe_cooked where id = 'c1000000-0000-4000-8000-000000000001';
select tests.reset_actor();
select tests.is((select servings from public.recipe_cooked where id = 'c1000000-0000-4000-8000-000000000001'), 4, 'another member''s cook cannot be edited or deleted');

-- value checks
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, servings, rating)
  values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 2, 6) $$, '23514', 'rating 1-5');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, servings)
  values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 0) $$, '23514', 'servings 1-100');

-- isolation: another household sees nothing and cannot write into ours; a recipe of another household is refused
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.recipe_cooked), 0, 'outsider sees no history');
select tests.is((select count(*) from public.recipe_cook_notes), 0, 'outsider sees no notes');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, servings)
  values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 2) $$, '42501', 'outsider cannot record a cook in our household');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, servings)
  values ('cc000000-0000-4000-8000-0000000000cc', 'e1000000-0000-4000-8000-000000000001', 2) $$, '23503', 'composite FK rejects a recipe from another household');
select tests.act_as_anon();
select tests.throws($$ select * from public.recipe_cooked $$, '42501', 'anon has no access');

-- deleting a recipe removes its history, notes and flags
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.recipes (id, household_id, title) values ('e1000000-0000-4000-8000-000000000009', 'aa000000-0000-4000-8000-0000000000aa', 'Temp');
insert into public.recipe_cooked (id, household_id, recipe_id, servings) values
  ('c1000000-0000-4000-8000-000000000009', 'aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000009', 2);
delete from public.recipes where id = 'e1000000-0000-4000-8000-000000000009';
select tests.is((select count(*) from public.recipe_cooked where recipe_id = 'e1000000-0000-4000-8000-000000000009'), 0, 'recipe delete cascades its history');

-- a member who leaves takes their cooking rows with them (private note, history, flag); others' rows stay
select tests.reset_actor();
update public.household_members set status = 'left' where household_id = 'aa000000-0000-4000-8000-0000000000aa' and user_id = 'b0000000-0000-4000-8000-000000000002';
select tests.is((select count(*) from public.recipe_cooked where user_id = 'b0000000-0000-4000-8000-000000000002'), 0, 'leaver''s history removed');
select tests.is((select count(*) from public.recipe_cook_notes where user_id = 'b0000000-0000-4000-8000-000000000002'), 0, 'leaver''s notes removed');
select tests.is((select count(*) from public.recipe_cooked where user_id = 'a0000000-0000-4000-8000-000000000001'), 2, 'other members'' history stays');

-- grace period: read-only
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.recipe_cooked (household_id, recipe_id, servings)
  values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 2) $$, '42501', 'read-only household: no cooked writes');
select tests.is((select count(*) from public.recipe_cooked), 2, 'read-only: reads still work');

rollback;
