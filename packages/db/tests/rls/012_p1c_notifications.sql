-- P1-C (D380-D389): notification devices, settings, preferences, the in-app centre / outbox and the derived activity feed.
-- Own rows only for everything personal; household isolation for the feed; service-only job tables and helpers.
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

-- ---------- devices ----------
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok(public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'android', 'expo', 'ExponentPushToken[shared-phone]', null, 'Pixel') is not null, 'alice registers her phone');
select tests.ok(public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'web', 'webpush', 'https://push.example.test/sub/alice-1',
  '{"p256dh":"BPk","auth":"x1"}'::jsonb, 'Firefox') is not null, 'alice registers a browser');
-- re-registering is an upsert, not a duplicate
select public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'android', 'expo', 'ExponentPushToken[shared-phone]', null, 'Pixel 8');
select tests.is((select count(*) from public.notification_devices), 2, 'alice sees her two devices');
select tests.ok((select label from public.notification_devices where token = 'ExponentPushToken[shared-phone]') = 'Pixel 8', 'upsert refreshed the label');
select tests.throws($$ insert into public.notification_devices (user_id, household_id, platform, channel, token)
  values ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'android', 'expo', 'ExponentPushToken[direct]') $$,
  '42501', 'devices are written through the RPC only');
select tests.throws($$ select public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'web', 'webpush', 'https://push.example.test/nokeys', null, null) $$,
  '23514', 'a web push subscription needs its keys');
select tests.throws($$ select public.register_push_device('cc000000-0000-4000-8000-0000000000cc', 'android', 'expo', 'ExponentPushToken[elsewhere]', null, null) $$,
  '42501', 'cannot register for a household you are not in');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.notification_devices), 0, 'bob cannot see alice''s devices');
-- bob signs in on the same phone: the token moves to bob, alice stops receiving its pushes
select public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'android', 'expo', 'ExponentPushToken[shared-phone]', null, null);
select tests.is((select count(*) from public.notification_devices), 1, 'bob now owns the phone token');
select tests.is(tests.affected($$ delete from public.notification_devices where token like 'https://push.example.test/%' $$), 0, 'bob cannot delete alice''s browser');
select tests.reset_actor();
select tests.is((select count(*) from public.notification_devices where user_id = 'a0000000-0000-4000-8000-000000000001'), 1, 'alice keeps only her browser');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select public.unregister_push_device('https://push.example.test/sub/alice-1')::bigint), 1, 'alice unregisters her browser');
select public.register_push_device('aa000000-0000-4000-8000-0000000000aa', 'web', 'webpush', 'https://push.example.test/sub/alice-2', '{"p256dh":"BPk","auth":"x2"}'::jsonb, null);

-- ---------- settings and preferences ----------
insert into public.notification_settings (household_id, user_id, quiet_start, quiet_end, time_zone)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', '22:00', '07:00', 'Europe/London');
insert into public.notification_preferences (household_id, user_id, type, in_app, push) values
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'expiry', true, false),
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'recipe_added', true, true);
update public.notification_preferences set push = true where type = 'expiry';
select tests.throws($$ insert into public.notification_preferences (household_id, user_id, type, in_app, push)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'plan_approved', false, true) $$, '23514', 'push implies in-app');
select tests.throws($$ insert into public.notification_preferences (household_id, user_id, type, in_app, push)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'test', true, true) $$, '23514', 'the test type has no preference');
select tests.throws($$ insert into public.notification_preferences (household_id, user_id, type, in_app, push)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'bogus', true, false) $$, '23514', 'unknown type refused');
select tests.throws($$ insert into public.notification_preferences (household_id, user_id, type, in_app, push)
  values ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'expiry', false, false) $$, '42501', 'cannot write another member''s preferences');
select tests.throws($$ insert into public.notification_settings (household_id, user_id, morning_hour)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 3) $$, null, 'morning hour range (and one row per member)');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.notification_preferences), 0, 'bob cannot read alice''s preferences');
select tests.is((select count(*) from public.notification_settings), 0, 'bob cannot read alice''s settings');
select tests.is(tests.affected($$ update public.notification_preferences set push = false $$), 0, 'bob cannot change alice''s preferences');

-- ---------- notifications (centre + outbox) ----------
select tests.reset_actor();
insert into public.notifications (id, household_id, user_id, type, title, push_title, link, dedupe_key, push_status) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'expiry',
   'Chicken: use by tomorrow', 'Use soon', '/pantry', 'expiry:x:2026-10-21', 'pending'),
  ('e1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'recipe_added',
   'Alice added Soup', 'Household update', '/recipes', 'activity:recipe:1', 'not_requested');
select tests.throws($$ insert into public.notifications (household_id, user_id, type, title, push_title, link, dedupe_key) values
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'expiry', 'dup', 'dup', '/pantry', 'expiry:x:2026-10-21') $$, '23505', 'dedupe key is unique per recipient');
select tests.throws($$ insert into public.notifications (household_id, user_id, type, title, push_title, link, dedupe_key) values
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'expiry', 't', 't', 'https://evil.example/', 'k1') $$, '23514', 'links are in-app paths only');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.notifications), 1, 'alice sees only her own notifications');
select tests.is(tests.affected($$ update public.notifications set read_at = now() where id = 'e1000000-0000-4000-8000-000000000001' $$), 1, 'alice marks hers read');
select tests.is(tests.affected($$ update public.notifications set read_at = now() where id = 'e1000000-0000-4000-8000-000000000002' $$), 0, 'alice cannot mark bob''s');
select tests.throws($$ update public.notifications set title = 'changed' $$, '42501', 'only read_at is writable');
select tests.throws($$ insert into public.notifications (household_id, user_id, type, title, push_title, dedupe_key)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'test', 't', 't', 'k2') $$, '42501', 'users cannot insert notifications directly');

-- test notification RPC: own row, rate limited, completes only own
select tests.ok(public.request_test_notification('aa000000-0000-4000-8000-0000000000aa') is not null, 'test notification created');
select tests.ok((select push_status from public.notifications where type = 'test') = 'pending', 'pending push because alice has a device');
select tests.throws($$ select public.request_test_notification('aa000000-0000-4000-8000-0000000000aa') $$, 'P0001', 'rate limited to one per 30 seconds');
select public.complete_test_push((select id from public.notifications where type = 'test'), true,
  array[(select id from public.notification_devices where token = 'https://push.example.test/sub/alice-2')]);
select tests.ok((select push_status from public.notifications where type = 'test') = 'sent', 'test push recorded as sent');
select tests.ok((select disabled_at is not null from public.notification_devices where token = 'https://push.example.test/sub/alice-2'), 'invalid device disabled');
select tests.throws($$ select public.complete_test_push((select id from public.notifications where type = 'test'), true, '{}') $$, 'P0002', 'cannot complete twice');

select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.request_test_notification('aa000000-0000-4000-8000-0000000000aa') $$, '42501', 'outsider cannot create a test notification');
select tests.is((select count(*) from public.notifications), 0, 'outsider sees no notifications');

-- ---------- activity feed (derived) ----------
select tests.reset_actor();
insert into public.shopping_lists (id, household_id, name, created_by) values
  ('5a000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Weekly shop', 'a0000000-0000-4000-8000-000000000001');
insert into public.shopping_command_log (command_id, household_id, shopping_list_id, command_type, command, status, result, created_by) values
  (gen_random_uuid(), 'aa000000-0000-4000-8000-0000000000aa', '5a000000-0000-4000-8000-000000000001', 'add',
   '{"type":"add_item","itemId":"not-a-uuid","displayName":"Milk"}', 'applied', '{}', 'b0000000-0000-4000-8000-000000000002');
insert into public.recipes (household_id, title, created_by) values ('aa000000-0000-4000-8000-0000000000aa', 'Soup', 'a0000000-0000-4000-8000-000000000001');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok((select count(*) from public.activity_events('aa000000-0000-4000-8000-0000000000aa', now() - interval '1 day', now() + interval '1 minute', 50)
                  where type = 'item_added' and subject = 'Milk' and actor_name = 'Bob') = 1, 'item added by Bob, bad itemId tolerated');
select tests.ok((select count(*) from public.activity_events('aa000000-0000-4000-8000-0000000000aa', now() - interval '1 day', now() + interval '1 minute', 50)
                  where type = 'recipe_added' and subject = 'Soup') = 1, 'recipe added');
select tests.ok((select count(*) from public.activity_events('aa000000-0000-4000-8000-0000000000aa', now() - interval '1 day', now() + interval '1 minute', 50)
                  where type = 'member_joined') >= 1, 'member joined');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.activity_events('aa000000-0000-4000-8000-0000000000aa', now() - interval '1 day', now() + interval '1 minute', 50)), 0, 'outsider sees no activity');
select tests.is((select count(*) from public.activity_events(null, now() - interval '1 day', now() + interval '1 minute', 50) where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'null household still RLS-scoped');

-- ---------- service-only ----------
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select * from public.notification_delivery_attempts $$, '42501', 'attempts are service-only');
select tests.throws($$ select * from public.notification_job_state $$, '42501', 'job state is service-only');
select tests.throws($$ select * from public.jobs_notification_recipients() $$, '42501', 'recipients helper is service-only');
select tests.throws($$ select * from public.jobs_expiry_candidates(current_date) $$, '42501', 'expiry helper is service-only');
select tests.throws($$ select * from public.jobs_recent_shoppers(now()) $$, '42501', 'shoppers helper is service-only');
select tests.act_as_anon();
select tests.throws($$ select * from public.notifications $$, '42501', 'anon has no access');

-- service role sees everything the job needs
select tests.reset_actor();
set local role service_role;
select tests.ok((select count(*) from public.jobs_notification_recipients() where household_id = 'aa000000-0000-4000-8000-0000000000aa') = 2, 'two recipients in HA');
select tests.ok((select prefs -> 'expiry' ->> 'push' from public.jobs_notification_recipients() where user_id = 'a0000000-0000-4000-8000-000000000001') = 'true', 'prefs aggregated');
reset role;

-- ---------- grace period ----------
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into public.notification_preferences (household_id, user_id, type, in_app, push)
  values ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'member_joined', true, false) $$, '42501', 'read-only household: no preference writes');
select tests.is(tests.affected($$ update public.notifications set read_at = null where id = 'e1000000-0000-4000-8000-000000000001' $$), 1, 'read state still changes in the grace period');
set local role service_role;
select tests.is((select count(*) from public.jobs_notification_recipients() where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 0, 'no notifications for a household pending deletion');
reset role;

rollback;
