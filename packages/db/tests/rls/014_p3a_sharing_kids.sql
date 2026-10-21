-- P3-A (D420-D429): share links between households (token + RLS isolation, no private data, revoke / expiry / deletion) and kids' mode.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol home', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'member', 'Bob');
update public.household_members set display_name = 'Alice' where user_id = 'a0000000-0000-4000-8000-000000000001';

insert into public.recipes (id, household_id, title, description, cover_image_path, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Chilli', 'Warming',
   'aa000000-0000-4000-8000-0000000000aa/cover/e1000000-0000-4000-8000-0000000000c1/cover.jpg', 'a0000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Pasta', null, null, 'a0000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Soup', null, null, 'a0000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'Curry', null, null, 'a0000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000cc', 'Carols stew', null, null, 'c0000000-0000-4000-8000-000000000003');
insert into public.recipe_ingredients (recipe_id, household_id, original_text, display_name, quantity_kind, quantity_value, unit, position) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '400 g beef mince', 'beef mince', 'exact', 400, 'g', 0);
insert into public.recipe_steps (recipe_id, household_id, step_number, instructions) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 1, 'Brown the mince.');
-- PRIVATE things that must never travel with a share
insert into public.recipe_favourites (recipe_id, user_id, household_id) values
  ('e1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa');
insert into public.recipe_ratings (recipe_id, user_id, household_id, rating) values
  ('e1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 5);
insert into storage.buckets (id, name, public) values ('recipe-images', 'recipe-images', false) on conflict do nothing;
insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/cover/e1000000-0000-4000-8000-0000000000c1/cover.jpg'),
  ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/cover/e1000000-0000-4000-8000-0000000000c2/cover.jpg');

-- ---- creating a share ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select * from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000001']::uuid[]) $$, '42501', 'an outsider cannot share another household''s recipe');
select tests.throws($$ insert into public.recipe_shares (household_id, scope, token_hash) values
  ('cc000000-0000-4000-8000-0000000000cc', 'recipe', repeat('a', 64)) $$, '42501', 'shares are only written through the RPC');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select * from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e2000000-0000-4000-8000-000000000001']::uuid[]) $$, '22023', 'cannot share a recipe of another household');
select tests.throws($$ select * from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002']::uuid[]) $$, '22023', 'a recipe share is exactly one recipe');
select tests.throws($$ select * from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'collection', 'Mix',
  array['e1000000-0000-4000-8000-000000000001']::uuid[], interval '400 days') $$, '22023', 'expiry is bounded');
select set_config('t.token', (select token from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000001']::uuid[], interval '7 days')), false);
select set_config('t.pub', (select token from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'collection', 'Weeknights',
  array['e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003']::uuid[], null, true)), false);
select tests.ok(current_setting('t.token') ~ '^[0-9a-f]{64}$', 'the token is 64 hex characters');
select tests.is((select count(*) from public.recipe_shares), 2, 'the household sees its shares');
select tests.ok(not exists (select 1 from public.recipe_shares where token_hash = current_setting('t.token')), 'only a hash is stored, never the token');

-- ---- another household reads through the token ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.recipe_shares), 0, 'the recipient cannot list the sharer''s shares');
select tests.is((select count(*) from public.recipes where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'the recipient cannot read the sharer''s recipes directly');
select tests.ok((select public.read_recipe_share(current_setting('t.token')) -> 'recipes' -> 0 ->> 'title') = 'Chilli', 'the token gives the chosen recipe');
select tests.ok((select public.read_recipe_share(current_setting('t.token')) ->> 'shared_by') = 'Alice', 'attribution is the sharer''s display name');
select tests.is((select jsonb_array_length(public.read_recipe_share(current_setting('t.token')) -> 'recipes')), 1, 'only the chosen recipe is in the share');
select tests.ok(not ((public.read_recipe_share(current_setting('t.token')) -> 'recipes' -> 0) ?| array['favourite', 'rating', 'household_id', 'created_by', 'cover_image_path', 'notes', 'cooked']),
  'no private field is in the shared view');
select tests.ok(public.read_recipe_share(current_setting('t.token'))::text !~* '(b0000000|a0000000|aa000000-0000-4000-8000-0000000000aa|rating)', 'no user id, household id or rating text appears anywhere');
select tests.ok(public.read_recipe_share(repeat('0', 64)) is null, 'an unknown token is NULL');
select tests.ok(public.read_recipe_share('not-a-token') is null, 'a malformed token is NULL');
select tests.is((select count(*) from public.recipe_share_recipients), 1, 'the recipient has a row of their own');

-- ---- images only through a live share the person opened ----
select tests.is((select count(*) from storage.objects where bucket_id = 'recipe-images'), 1, 'the opener can read the shared recipe''s cover and nothing else of the sharer''s');
select tests.ok(public.share_cover_ref(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000001') like 'aa000000-%/cover/%', 'the cover path is available to the recipient');
select tests.ok(public.share_cover_ref(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000002') is null, 'a recipe outside the share has no cover ref');
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.is((select count(*) from storage.objects where bucket_id = 'recipe-images'), 0, 'someone who never opened the share sees no image');

-- ---- signed out ----
select tests.act_as_anon();
select tests.ok((select public.read_recipe_share(current_setting('t.token')) ->> 'minimal') = 'true', 'signed out + public preview off = minimal');
select tests.ok(not (public.read_recipe_share(current_setting('t.token')) ? 'recipes'), 'the minimal preview has no recipes');
select tests.ok((select public.read_recipe_share(current_setting('t.pub')) ->> 'minimal') = 'false', 'public preview on = the recipes');
select tests.reset_actor();
select tests.is((select count(*) from public.recipe_share_recipients where user_id <> 'c0000000-0000-4000-8000-000000000003'), 0, 'anonymous visitors are not recorded');
select tests.act_as_anon();
select tests.throws($$ select * from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000001']::uuid[]) $$, '42501', 'anon cannot create shares');

-- ---- saving a copy records the source (the copy itself is made by the app through the normal repository) ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
insert into public.recipes (id, household_id, title, created_by) values
  ('e2000000-0000-4000-8000-000000000009', 'cc000000-0000-4000-8000-0000000000cc', 'Chilli', 'c0000000-0000-4000-8000-000000000003');
select tests.ok(public.record_share_save(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000009'), 'a save is recorded');
select tests.ok(not public.record_share_save(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'), 'cannot mark a recipe of another household as a save');
select tests.ok(not public.record_share_save(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000009'), 'a recipe outside the share cannot be saved');
select tests.is((select count(*) from public.recipes where source_share_id is not null), 1, 'the copy knows it came from a share');

-- ---- the sharer's household: counts, revoke ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.recipe_shares), 2, 'a member sees the household''s shares');
select tests.ok((select (public.list_recipe_shares('aa000000-0000-4000-8000-0000000000aa') -> 1 ->> 'saved')::int) >= 0, 'the list carries counts');
select tests.ok(not (public.list_recipe_shares('aa000000-0000-4000-8000-0000000000aa')::text ~* 'c0000000|carol'), 'the list never says who opened');
select tests.ok(public.revoke_recipe_share((select id from public.recipe_shares where scope = 'recipe')), 'any member can revoke');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(not public.revoke_recipe_share((select id from public.recipe_shares limit 1)), 'the recipient cannot revoke (and sees nothing to revoke)') ;
select tests.ok(public.read_recipe_share(current_setting('t.token')) is null, 'a revoked share answers NULL');
select tests.is((select count(*) from storage.objects where bucket_id = 'recipe-images'), 0, 'revoking closes image access at once');
select tests.ok(public.share_cover_ref(current_setting('t.token'), 'e1000000-0000-4000-8000-000000000001') is null, 'and the cover ref');

-- ---- expiry ----
select tests.reset_actor();
update public.recipe_shares set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where scope = 'collection';
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.read_recipe_share(current_setting('t.pub')) is null, 'an expired share answers NULL');

-- ---- deletion revokes ----
select tests.reset_actor();
update public.recipe_shares set expires_at = null, created_at = now() where scope = 'collection';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.live', (select token from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000004']::uuid[])), false);
select tests.ok(public.read_recipe_share(current_setting('t.live')) is not null, 'a live share reads');
select tests.reset_actor();
select tests.ok(public.read_recipe_share(current_setting('t.live')) is not null, 'still live (read as superuser)');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select set_config('t.bobs', (select token from public.create_recipe_share('aa000000-0000-4000-8000-0000000000aa', 'recipe', null,
  array['e1000000-0000-4000-8000-000000000003']::uuid[])), false);
select public.member_leave('aa000000-0000-4000-8000-0000000000aa');
select tests.reset_actor();
select tests.is((select count(*) from public.recipe_shares where revoked_at is null and created_by = 'b0000000-0000-4000-8000-000000000002'), 0, 'a member leaving revokes the shares they made');
select tests.is((select count(*) from public.recipe_shares where revoked_at is null and created_by = 'a0000000-0000-4000-8000-000000000001'), 2, 'other members'' shares stay');
update public.household_members set status = 'active', revoked_at = null where user_id = 'b0000000-0000-4000-8000-000000000002';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select * from public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.reset_actor();
select tests.is((select count(*) from public.recipe_shares where household_id = 'aa000000-0000-4000-8000-0000000000aa' and revoked_at is null), 0, 'a household pending deletion has no live share');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.read_recipe_share(current_setting('t.live')) is null, 'and reads answer NULL');

-- =========================== kids' mode ===========================
select tests.reset_actor();
insert into public.households (id, name, created_by) values ('dd000000-0000-4000-8000-0000000000dd', 'Dave home', 'd0000000-0000-4000-8000-000000000004');
insert into public.recipes (id, household_id, title) values
  ('e3000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-0000000000dd', 'Fish fingers'),
  ('e3000000-0000-4000-8000-000000000002', 'dd000000-0000-4000-8000-0000000000dd', 'Pizza'),
  ('e3000000-0000-4000-8000-000000000003', 'dd000000-0000-4000-8000-0000000000dd', 'Tacos'),
  ('e3000000-0000-4000-8000-000000000004', 'dd000000-0000-4000-8000-0000000000dd', 'Lasagne');
select tests.act_as('d0000000-0000-4000-8000-000000000004');
insert into public.kid_profiles (id, household_id, display_name, avatar, colour) values
  ('f0000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-0000000000dd', 'Mia', '🦊', 'blue');
select tests.throws($$ insert into public.kid_profiles (household_id, display_name, avatar, colour) values
  ('dd000000-0000-4000-8000-0000000000dd', 'Zed', '🦊', '#ff0000') $$, '23514', 'only the palette colours');
select tests.throws($$ insert into public.kid_profiles (household_id, display_name, avatar, colour) values
  ('dd000000-0000-4000-8000-0000000000dd', repeat('x', 25), '🦊', 'red') $$, '23514', 'short names only');
select tests.throws($$ select * from public.create_dinner_round('dd000000-0000-4000-8000-0000000000dd', '2026-10-22', 1, 'Tonight',
  array['e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002']::uuid[]) $$, '22023', 'a round needs 3 to 6 recipes');
select tests.throws($$ select * from public.create_dinner_round('dd000000-0000-4000-8000-0000000000dd', '2026-10-22', 1, 'Tonight',
  array['e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001']::uuid[]) $$, '22023', 'only this household''s recipes');
select set_config('t.round', public.create_dinner_round('dd000000-0000-4000-8000-0000000000dd', '2026-10-22', 1, 'Tonight',
  array['e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000003']::uuid[],
  now() + interval '1 day')::text, false);
select tests.ok(public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'heart'), 'a parent votes for a kid');
select tests.ok(public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'up'), 'changing the vote replaces it');
select tests.ok(public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000002', null, 'up'), 'a member votes as themselves');
select tests.ok(not public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000004', null, 'up'), 'only candidates can be voted on');
select tests.is((select count(*) from public.dinner_round_votes), 2, 'one vote per voter per recipe');
select tests.throws($$ insert into public.dinner_round_votes (round_id, recipe_id, household_id, voter_user_id, value) values
  (current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000003', 'dd000000-0000-4000-8000-0000000000dd', 'd0000000-0000-4000-8000-000000000004', 'up') $$, '42501', 'votes are only written through the RPC');

select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.kid_profiles), 0, 'another household cannot see the kid profiles');
select tests.is((select count(*) from public.dinner_rounds), 0, 'nor the rounds');
select tests.ok(not public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000001', null, 'up'), 'nor vote in them');

select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.ok(public.close_dinner_round(current_setting('t.round')::uuid), 'a parent closes the round');
select tests.throws($$ select public.cast_dinner_vote(current_setting('t.round')::uuid, 'e3000000-0000-4000-8000-000000000003', null, 'up') $$, '22023', 'a closed round takes no more votes');
select set_config('t.round2', public.create_dinner_round('dd000000-0000-4000-8000-0000000000dd', '2026-10-23', 1, null,
  array['e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000003']::uuid[],
  now() + interval '1 day')::text, false);
select tests.reset_actor();
update public.dinner_rounds set closes_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = current_setting('t.round2')::uuid;
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.throws($$ select public.cast_dinner_vote(current_setting('t.round2')::uuid, 'e3000000-0000-4000-8000-000000000003', null, 'up') $$, '22023', 'a round past its closing time takes no more votes');

rollback;
