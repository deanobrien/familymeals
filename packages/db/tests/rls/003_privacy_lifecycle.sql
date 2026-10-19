-- Privacy lifecycle (L24): consent gating for allergy data, member_leave, deletion grace + purge,
-- storage cleanup queue, and service-role-only queue/ledger.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001');
insert into public.household_members (household_id, user_id, role) values
  ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'member');
insert into public.ingredients (id, name, slug, category) values
  ('11000000-0000-4000-8000-000000000003', 'Peanut butter', 'peanut-butter', 'Spreads');
insert into public.ingredient_allergens (ingredient_id, allergen_group, source) values
  ('11000000-0000-4000-8000-000000000003', 'peanuts', 'test');

-- ---- consent gating ----
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ insert into public.household_exclusions (household_id, ingredient_id, kind, consent_recorded_at)
                      values ('aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000003', 'allergy', now()) $$,
                    '42501', 'allergy exclusion without consent record refused');
insert into public.consent_records (household_id, consent_type, wording_version)
values ('aa000000-0000-4000-8000-0000000000aa', 'allergy_data', 'v1');
insert into public.household_exclusions (household_id, ingredient_id, kind, consent_recorded_at)
values ('aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000003', 'allergy', now());
insert into public.household_exclusions (household_id, allergen_group, kind, consent_recorded_at)
values ('aa000000-0000-4000-8000-0000000000aa', 'sesame', 'allergy', now());
insert into public.household_exclusions (household_id, term, kind)
values ('aa000000-0000-4000-8000-0000000000aa', 'coriander', 'avoid');
select tests.throws($$ insert into public.household_exclusions (household_id, kind) values ('aa000000-0000-4000-8000-0000000000aa', 'avoid') $$,
                    '23514', 'exclusion needs ingredient, allergen group or term');
select tests.throws($$ update public.consent_records set wording_version = 'v2' $$, '23514', 'consent wording is immutable');

-- consent records are private to their owner, even within the household
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.consent_records), 0, 'owner cannot read another member''s consents');
select tests.is((select count(*) from public.household_exclusions), 3, 'exclusions are household-visible');
select tests.throws($$ insert into public.consent_records (household_id, user_id, consent_type, wording_version)
                      values ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'allergy_data', 'v1') $$,
                    '42501', 'cannot record consent on behalf of someone else');

-- service tables are invisible to end users
select tests.throws($$ select count(*) from public.storage_cleanup_queue $$, '42501', 'queue not readable by users');
select tests.throws($$ select count(*) from public.deletion_ledger $$, '42501', 'ledger not readable by users');
select tests.throws($$ select public.purge_household('aa000000-0000-4000-8000-0000000000aa') $$, '42501',
                    'users cannot call purge_household');

-- ---- member_leave ----
select tests.throws($$ select public.member_leave('aa000000-0000-4000-8000-0000000000aa') $$, '22023',
                    'sole owner must transfer before leaving');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
insert into public.person_profiles (household_id, user_id, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'Carol');
select public.member_leave('aa000000-0000-4000-8000-0000000000aa');
select tests.is((select count(*) from public.households), 0, 'leaver loses access immediately');
select tests.reset_actor();
select tests.is((select count(*) from public.person_profiles where user_id = 'c0000000-0000-4000-8000-000000000003'), 0,
                'leaver person profile deleted');
select tests.is((select count(*) from public.consent_records where user_id = 'c0000000-0000-4000-8000-000000000003'), 0,
                'leaver consents deleted');
select tests.is((select count(*) from public.household_exclusions), 3, 'shared household data stays');
select tests.ok((select status = 'left' from public.household_members where user_id = 'c0000000-0000-4000-8000-000000000003'),
                'membership marked left');

-- ---- storage cleanup on row delete ----
insert into public.recipes (id, household_id, title) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Satay');
insert into public.recipe_images (recipe_id, household_id, storage_path, mime_type) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   'aa000000-0000-4000-8000-0000000000aa/recipes/a1/1.jpg', 'image/jpeg');
insert into public.receipts (id, household_id, image_paths) values
  ('a8000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   array['aa000000-0000-4000-8000-0000000000aa/receipts/r1/1.jpg', 'aa000000-0000-4000-8000-0000000000aa/receipts/r1/2.jpg']);
select tests.act_as('a0000000-0000-4000-8000-000000000001');
delete from public.recipes where id = 'a1000000-0000-4000-8000-000000000001';
update public.receipts set image_paths = array['aa000000-0000-4000-8000-0000000000aa/receipts/r1/1.jpg']
 where id = 'a8000000-0000-4000-8000-000000000001';
select tests.reset_actor();
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'recipe_image_deleted'), 1,
                'recipe image enqueued on recipe delete (cascade)');
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'receipt_image_removed'), 1,
                'removed receipt image enqueued');

-- ---- deletion grace + purge ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.ok((select status = 'pending_deletion' and purge_after > now() + interval '13 days' from public.households),
                'household pending deletion with 14-day grace');
select public.cancel_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.ok((select status = 'active' from public.households), 'deletion cancelled');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');

select tests.reset_actor();
insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/recipes/x/9.jpg');
select set_config('role', 'service_role', true);
select public.purge_household('aa000000-0000-4000-8000-0000000000aa');
select tests.reset_actor();
select tests.is((select count(*) from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'household purged');
select tests.is((select count(*) from public.household_exclusions), 0, 'cascade removed exclusions');
select tests.is((select count(*) from public.receipts), 0, 'cascade removed receipts');
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'household_purged'), 1,
                'remaining storage objects enqueued by purge');
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'receipt_deleted'), 1,
                'receipt images enqueued by cascade delete');
select tests.is((select count(*) from public.deletion_ledger where subject_type = 'household' and purged_at is not null), 1,
                'ledger records the purge');
select tests.is((select count(*) from public.deletion_ledger where cancelled_at is not null), 1, 'ledger keeps the cancelled request');

rollback;
