-- DX1 (migration 20261020002500): export audit/rate limit, account deletion, grace clamp, purge job RPCs,
-- deletion-ledger replay after a restore, storage cleanup claim/complete/fail, local-upload enqueue.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-0000000000bb', 'Bob home', 'b0000000-0000-4000-8000-000000000002'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol flat', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'member', 'Carol C');

-- ===================== export: scope, rate limit, audit =====================
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select * from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'household') $$,
                    '42501', 'a member cannot export the whole household');
select tests.ok((select allowed and export_id is not null and expires_at <= now() + interval '1 hour'
                   from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'member')),
                'a member can export their own data');
select tests.ok((select not allowed and export_id is null and retry_after > now() + interval '23 hours'
                   from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'member')),
                'second export within 24 h is rate limited');
select tests.throws($$ select * from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'everything') $$,
                    '22023', 'unknown scope refused');
select tests.throws($$ insert into public.data_export_requests (household_id, scope, expires_at)
                      values ('aa000000-0000-4000-8000-0000000000aa', 'member', now() + interval '1 hour') $$,
                    '42501', 'no direct inserts');
select public.record_data_export_download((select id from public.data_export_requests), false, null, null, 'stream failed');
select tests.ok((select status = 'failed' and error = 'stream failed' from public.data_export_requests), 'failure recorded');
select tests.ok((select allowed from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'member')),
                'a failed export frees the rate limit');
select public.record_data_export_download((select id from public.data_export_requests where status = 'ready'), true, 1234,
                                          '{"recipes": 1}'::jsonb);
select tests.ok((select status = 'downloaded' and download_count = 1 and bytes = 1234
                   from public.data_export_requests where error is null), 'download recorded');
select tests.throws($$ select public.record_data_export_download((select id from public.data_export_requests where status = 'failed'), true) $$,
                    '22023', 'failed exports cannot be reused');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select * from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'member') $$,
                    '42501', 'outsiders cannot export');
select tests.is((select count(*) from public.data_export_requests), 0, 'outsiders see no export rows');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.data_export_requests), 0, 'owner cannot see a member''s export audit');
select tests.ok((select allowed from public.begin_data_export('aa000000-0000-4000-8000-0000000000aa', 'household')),
                'owner can export the household');
select tests.throws($$ select public.record_data_export_download('00000000-0000-4000-8000-000000000000', true) $$,
                    '22023', 'unknown export id refused');

-- ===================== grace period cannot be shortened by end users =====================
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok(public.request_household_deletion('bb000000-0000-4000-8000-0000000000bb', interval '0') > now() + interval '13 days',
                'end user grace clamped to 14 days');

-- ===================== jobs RPCs are service-role only =====================
select tests.throws($$ select public.jobs_purge_due() $$, '42501', 'users cannot run the purge job');
select tests.throws($$ select * from public.jobs_due_account_deletions() $$, '42501', 'users cannot list account deletions');
select tests.throws($$ select public.jobs_prepare_account_purge('c0000000-0000-4000-8000-000000000003') $$, '42501',
                    'users cannot prepare account purges');
select tests.throws($$ select * from public.jobs_claim_storage_cleanup() $$, '42501', 'users cannot claim cleanup rows');
select tests.throws($$ select public.jobs_status() $$, '42501', 'users cannot read job status');

-- ===================== account deletion =====================
-- Alice is the only owner of a household that has another member: refused until she transfers ownership.
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.request_account_deletion() $$, '22023', 'sole owner of a shared household is refused');

-- Carol: member of Alice home (shared) and sole member of Carol flat.
select tests.reset_actor();
insert into public.shopping_lists (id, household_id, name) values
  ('a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'This week');
insert into public.shopping_list_items (id, shopping_list_id, household_id, display_name, quantity_kind, quantity_value, unit) values
  ('a7000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   'Onions', 'exact', 10, 'item');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select public.record_purchase('ae000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":2,"unit":"item","originalText":"2 onions"}', 30);
insert into public.person_profiles (household_id, user_id, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'Carol');
select tests.ok(public.request_account_deletion() > now() + interval '13 days',
                'account deletion waits for the sole-member household grace period');
select tests.ok(public.my_account_deletion() > now() + interval '13 days', 'pending account deletion visible to the user');
select tests.throws($$ select public.request_account_deletion() $$, '22023', 'cannot request twice');
select tests.is((select count(*) from public.households), 1, 'carol left the shared household immediately');
select tests.ok((select status = 'pending_deletion' from public.households where id = 'cc000000-0000-4000-8000-0000000000cc'),
                'sole-member household scheduled for deletion');
select tests.ok(public.cancel_account_deletion(), 'account deletion can be cancelled');
select tests.ok(public.my_account_deletion() is null, 'nothing pending after cancel');
select tests.ok(not public.cancel_account_deletion(), 'cancel is idempotent');
select tests.ok(public.request_account_deletion() > now() + interval '13 days', 're-request keeps the household purge time');

select tests.reset_actor();
select tests.is((select count(*) from public.person_profiles where user_id = 'c0000000-0000-4000-8000-000000000003'), 0,
                'profile in the left household removed');
select tests.ok((select created_by = 'c0000000-0000-4000-8000-000000000003' from public.purchase_events),
                'purchase not anonymised until the job runs');

-- ===================== purge job (service role) =====================
select set_config('role', 'service_role', true);
select tests.ok((public.jobs_purge_due() ->> 'purged')::int = 0, 'nothing due yet');
select tests.is((select count(*) from public.jobs_due_account_deletions()), 0, 'account not due yet');
select tests.reset_actor();
update public.households set deletion_requested_at = now() - interval '15 days', purge_after = now() - interval '1 day'
 where id = 'cc000000-0000-4000-8000-0000000000cc';
update public.deletion_ledger set requested_at = now() - interval '15 days', scheduled_purge_at = now() - interval '1 day'
 where subject_type::text = 'account' and purged_at is null and cancelled_at is null;
insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'cc000000-0000-4000-8000-0000000000cc/recipes/x/1.jpg');
insert into public.recipes (id, household_id, title) values
  ('c1000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000cc', 'Soup');
insert into public.recipe_versions (recipe_id, household_id, version_no, corrected) values
  ('c1000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000cc', 1,
   '{"imageUrl": "/api/uploads/12345678-1234-4123-8123-123456789abc/cover.jpg"}');

select set_config('role', 'service_role', true);
select tests.ok((public.jobs_purge_due() ->> 'purged')::int = 1, 'due household purged');
select tests.is((select count(*) from public.households where id = 'cc000000-0000-4000-8000-0000000000cc'), 0, 'household gone');
select tests.is((select count(*) from public.storage_cleanup_queue
                  where bucket = 'local-uploads' and object_path = '12345678-1234-4123-8123-123456789abc'), 1,
                'legacy local upload enqueued when the recipe version is deleted');
select tests.is((select count(*) from public.storage_cleanup_queue
                  where bucket = 'recipe-images' and reason = 'household_purged'), 1, 'storage object enqueued');
select tests.ok((public.jobs_purge_due() ->> 'purged')::int = 0, 'purge is idempotent');

select tests.ok((select user_id = 'c0000000-0000-4000-8000-000000000003' and not replay from public.jobs_due_account_deletions()),
                'account now due');
select tests.ok(public.jobs_prepare_account_purge('c0000000-0000-4000-8000-000000000003') = 'ready', 'account ready');
select tests.ok((select created_by is null and created_by_display_name = 'Carol C' from public.purchase_events),
                'purchase anonymised, display-name snapshot kept');
select tests.reset_actor();
delete from auth.users where id = 'c0000000-0000-4000-8000-000000000003'; -- what auth.admin.deleteUser does
select set_config('role', 'service_role', true);
select public.jobs_complete_account_purge('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.jobs_due_account_deletions()), 0, 'no accounts due after completion');
select tests.is((select count(*) from public.purchase_events), 1, 'purchase history survives');

-- blocked cases
select tests.ok(public.jobs_prepare_account_purge('a0000000-0000-4000-8000-000000000001') = 'blocked_household',
                'sole member of a live household is blocked');

-- ===================== deletion-ledger replay after a backup restore =====================
select tests.reset_actor();
insert into public.households (id, name, created_by) values
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol flat (restored)', null);
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
select set_config('role', 'service_role', true);
select tests.ok((public.jobs_purge_due() ->> 'replayed')::int = 1, 'restored household purged again');
select tests.is((select count(*) from public.households where id = 'cc000000-0000-4000-8000-0000000000cc'), 0, 'replay removed it');
select tests.ok((select replay from public.jobs_due_account_deletions()
                  where user_id = 'c0000000-0000-4000-8000-000000000003'), 'restored account listed for re-deletion');

-- ===================== storage cleanup claim / complete / fail =====================
select tests.is((select count(*) from public.jobs_claim_storage_cleanup(1)), 1, 'claims one row');
select tests.ok((select count(*) from public.jobs_claim_storage_cleanup(100)) >= 1, 'claims the rest');
select tests.is((select count(*) from public.jobs_claim_storage_cleanup(100)), 0, 'claimed rows back off');
select public.jobs_fail_storage_cleanup((select id from public.storage_cleanup_queue where bucket = 'local-uploads'), 'boom');
select tests.is(public.jobs_complete_storage_cleanup(array(select id from public.storage_cleanup_queue where bucket <> 'local-uploads')),
                (select count(*) from public.storage_cleanup_queue where bucket <> 'local-uploads'), 'rows completed');
select tests.ok((public.jobs_status() ->> 'cleanupPending')::int = 1, 'one row still pending (failed once)');
select tests.ok((select last_error = 'boom' and attempts = 1 from public.storage_cleanup_queue where bucket = 'local-uploads'),
                'failure recorded');

-- purchase_events anonymisation shape: the display name can only be filled while the actor is nulled
select tests.reset_actor();
select tests.throws($$ update public.purchase_events set created_by_display_name = 'Someone else' $$, '23514',
                    'snapshot cannot be rewritten');

rollback;
