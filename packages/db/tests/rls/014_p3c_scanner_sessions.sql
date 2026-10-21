-- P3-C (D447-D449): phone-as-scanner sessions. Capability tokens (hashed), RLS (creator only), single scanner, expiry,
-- revocation, rate and size caps, anon can only use scanner_connect / scanner_push.
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

-- The app sends a 43-char url-safe token; the table holds only its SHA-256.
create or replace function tests.h(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
grant execute on function tests.h(text) to anon, authenticated, service_role;

-- ---- create (desktop user) ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.s1', (public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', tests.h('token-one-0123456789abcdefghij'), 600)->>'id'), true);
select tests.ok(current_setting('t.s1') <> '', 'a member can start a session');
select tests.ok((public.scanner_session_create('cc000000-0000-4000-8000-0000000000cc', 'pantry', tests.h('x'), 600)->>'error') = 'forbidden', 'cannot start a session for a household you are not in');
select tests.ok((public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'garden', tests.h('x'), 600)->>'error') = 'invalid_input', 'purpose is checked');
select tests.ok((public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', 'not-a-hash', 600)->>'error') = 'invalid_input', 'only a sha-256 hash is accepted');
select tests.is((select count(*) from public.scanner_sessions), 1, 'the creator sees the session');
select tests.ok((select expires_at <= now() + interval '10 minutes 5 seconds' from public.scanner_sessions), 'a session lives at most 10 minutes');
select tests.ok((select token_hash = tests.h('token-one-0123456789abcdefghij') from public.scanner_sessions), 'only the hash is stored');

-- ---- RLS: nobody else reads it ----
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.scanner_sessions), 0, 'another member of the household cannot see my session');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.scanner_sessions), 0, 'an outsider cannot see it');
select tests.throws($$ insert into public.scanner_sessions (household_id, user_id, purpose, token_hash, expires_at)
  values ('aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'pantry', repeat('a', 64), now() + interval '5 minutes') $$, '42501', 'no direct insert');
select tests.throws($$ update public.scanner_sessions set expires_at = now() + interval '5 minutes' $$, '42501', 'no direct update');
select tests.throws($$ select public.scanner_validate(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', true) $$, '42501', 'the validator is internal');

-- ---- anon: no table access, no desktop functions ----
select tests.act_as_anon();
select tests.throws($$ select count(*) from public.scanner_sessions $$, '42501', 'anon cannot read sessions');
select tests.throws($$ select count(*) from public.scanner_items $$, '42501', 'anon cannot read items');
select tests.throws($$ select public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', repeat('a', 64), 600) $$, '42501', 'anon cannot start sessions');
select tests.throws($$ select public.scanner_session_revoke(current_setting('t.s1')::uuid) $$, '42501', 'anon cannot revoke');
select tests.throws($$ select public.scanner_photo(gen_random_uuid()) $$, '42501', 'anon cannot read photos');

-- ---- phone: connect / single scanner ----
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789')->>'ok')::boolean, 'the right token connects');
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789')->>'ok')::boolean, 'the same phone can reconnect');
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-two-0123456789')->>'error') = 'scanner_in_use', 'a second phone is refused');
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'WRONG-token-0123456789abcdefgh', 'device-one-0123456789')->>'error') = 'invalid', 'a wrong token is refused');
select tests.ok((public.scanner_connect(gen_random_uuid(), 'token-one-0123456789abcdefghij', 'device-one-0123456789')->>'error') = 'invalid', 'an unknown session looks the same as a wrong token');
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'short', 'device-one-0123456789')->>'error') = 'invalid', 'a short token is refused');

-- ---- push: barcodes ----
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-id-0001', 'barcode', '5000157024671', 1)->>'ok')::boolean, 'a barcode is accepted');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-id-0001', 'barcode', '5000157024671', 1)->>'duplicate')::boolean, 'a retried push is acknowledged, not duplicated');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-id-0002', 'barcode', '12345', 1)->>'error') = 'invalid_input', 'only 8 or 13 digit codes');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-id-0003', 'barcode', '5000157024671', 100)->>'error') = 'invalid_input', 'count is bounded');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-two-0123456789', 'client-id-0004', 'barcode', '5000157024671', 1)->>'error') = 'scanner_in_use', 'the other phone cannot push either');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'WRONG-token-0123456789abcdefgh', 'device-one-0123456789', 'client-id-0005', 'barcode', '5000157024671', 1)->>'error') = 'invalid', 'a wrong token cannot push');

-- ---- push: photos ----
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-photo-01', 'photo', null, 1, encode('jpegbytes'::bytea, 'base64'), 'image/jpeg')->>'ok')::boolean, 'a photo is accepted');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-photo-02', 'photo', null, 1, encode('x'::bytea, 'base64'), 'application/pdf')->>'error') = 'invalid_input', 'photos must be images');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-photo-03', 'photo', null, 1, '@@@not base64@@@', 'image/jpeg')->>'error') = 'invalid_input', 'bad base64 is refused');
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789', 'client-photo-04', 'photo', null, 1, encode(decode(repeat('ab', 1600000), 'hex'), 'base64'), 'image/jpeg')->>'error') in ('photo_too_large', 'invalid_input'), 'a photo over 1.5 MB is refused');

-- ---- desktop reads; others cannot ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.scanner_items), 2, 'the creator sees the pushed items');
select tests.is((select sum(count) from public.scanner_items where kind = 'barcode'), 1, 'one barcode, counted once');
select set_config('t.photo', (select id::text from public.scanner_items where kind = 'photo'), true);
select tests.ok((public.scanner_photo(current_setting('t.photo')::uuid)->>'base64') = encode('jpegbytes'::bytea, 'base64'), 'the creator reads the photo');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.scanner_items), 0, 'another member sees no items');
select tests.is((select count(*) from public.scanner_photos), 0, 'another member sees no photos');
select tests.ok(public.scanner_photo(current_setting('t.photo')::uuid) = 'null'::jsonb, 'scanner_photo respects RLS');
select tests.ok((public.scanner_session_revoke(current_setting('t.s1')::uuid)->>'error') = 'not_found', 'only the creator can revoke');
select tests.ok((public.scanner_session_release(current_setting('t.s1')::uuid)->>'error') = 'not_found', 'only the creator can release the phone');

-- ---- release lets another phone take over ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok((public.scanner_session_release(current_setting('t.s1')::uuid)->>'ok')::boolean, 'the creator releases the phone');
select tests.act_as_anon();
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-two-0123456789')->>'ok')::boolean, 'a different phone can now connect');
select tests.ok((public.scanner_connect(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-one-0123456789')->>'error') = 'scanner_in_use', 'and the first is now the one refused');

-- ---- revoke ends it and deletes what was sent ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok((public.scanner_session_revoke(current_setting('t.s1')::uuid)->>'ok')::boolean, 'the creator revokes');
select tests.is((select count(*) from public.scanner_items), 0, 'items are deleted on revoke');
select tests.reset_actor();
select tests.is((select count(*) from public.scanner_photos), 0, 'photos are deleted on revoke');
select tests.act_as_anon();
select tests.ok((public.scanner_push(current_setting('t.s1')::uuid, 'token-one-0123456789abcdefghij', 'device-two-0123456789', 'client-id-0009', 'barcode', '5000157024671', 1)->>'error') = 'revoked', 'a revoked session accepts nothing');

-- ---- a new session revokes the previous one (single active session) ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.s2', (public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'receipt', tests.h('token-two-0123456789abcdefghij'), 600)->>'id'), true);
select set_config('t.s3', (public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', tests.h('token-three-0123456789abcdefgh'), 600)->>'id'), true);
select tests.ok((select revoked_at is not null from public.scanner_sessions where id = current_setting('t.s2')::uuid), 'starting another session revokes the earlier one');
select tests.ok((select revoked_at is null from public.scanner_sessions where id = current_setting('t.s3')::uuid), 'the newest stays active');

-- ---- expiry ----
select tests.reset_actor();
update public.scanner_sessions set expires_at = now() - interval '1 second' where id = current_setting('t.s3')::uuid;
select tests.act_as_anon();
select tests.ok((public.scanner_connect(current_setting('t.s3')::uuid, 'token-three-0123456789abcdefgh', 'device-one-0123456789')->>'error') = 'expired', 'an expired session cannot connect');
select tests.ok((public.scanner_push(current_setting('t.s3')::uuid, 'token-three-0123456789abcdefgh', 'device-one-0123456789', 'client-id-0010', 'barcode', '5000157024671', 1)->>'error') = 'expired', 'an expired session accepts nothing');

-- ---- ten wrong tokens revoke the session ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.s4', (public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', tests.h('token-four-0123456789abcdefghi'), 600)->>'id'), true);
select tests.act_as_anon();
do $$
begin
  for i in 1..10 loop
    perform public.scanner_connect(current_setting('t.s4')::uuid, 'guess-' || i || '-0123456789abcdefghij', 'device-one-0123456789');
  end loop;
end $$;
select tests.ok((public.scanner_connect(current_setting('t.s4')::uuid, 'token-four-0123456789abcdefghi', 'device-one-0123456789')->>'error') = 'revoked', 'ten wrong tokens revoke the session, even for the right one afterwards');

-- ---- caps: rate, session size, photo count ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.s5', (public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', tests.h('token-five-0123456789abcdefghi'), 600)->>'id'), true);
select tests.act_as_anon();
do $$
declare r jsonb; ok_n int := 0; limited boolean := false;
begin
  for i in 1..125 loop
    r := public.scanner_push(current_setting('t.s5')::uuid, 'token-five-0123456789abcdefghi', 'device-one-0123456789', 'rate-client-' || lpad(i::text, 4, '0'), 'barcode', '5000157024671', 1);
    if (r->>'ok')::boolean then ok_n := ok_n + 1; elsif r->>'error' = 'rate_limited' then limited := true; end if;
  end loop;
  if ok_n <> 120 or not limited then raise exception 'ASSERTION FAILED: rate limit (accepted %, limited %)', ok_n, limited; end if;
end $$;
select tests.reset_actor();
update public.scanner_sessions set item_count = 300 where id = current_setting('t.s5')::uuid;
delete from public.scanner_items where session_id = current_setting('t.s5')::uuid; -- so the per-minute window is clear
select tests.act_as_anon();
select tests.ok((public.scanner_push(current_setting('t.s5')::uuid, 'token-five-0123456789abcdefghi', 'device-one-0123456789', 'full-client-0001', 'barcode', '5000157024671', 1)->>'error') = 'session_full', 'a session holds at most 300 items');
select tests.reset_actor();
update public.scanner_sessions set item_count = 0, photo_count = 10 where id = current_setting('t.s5')::uuid;
select tests.act_as_anon();
select tests.ok((public.scanner_push(current_setting('t.s5')::uuid, 'token-five-0123456789abcdefghi', 'device-one-0123456789', 'photo-client-0001', 'photo', null, 1, encode('jpegbytes'::bytea, 'base64'), 'image/jpeg')->>'error') = 'too_many_photos', 'at most 10 photos per session');

-- ---- 20 sessions per user per hour ----
select tests.reset_actor();
insert into public.scanner_sessions (household_id, user_id, purpose, token_hash, expires_at, revoked_at)
  select 'aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'pantry', tests.h('bulk' || g), now() + interval '1 minute', now() from generate_series(1, 20) g;
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.ok((public.scanner_session_create('aa000000-0000-4000-8000-0000000000aa', 'pantry', tests.h('one-too-many'), 600)->>'error') = 'rate_limited', 'session creation is rate limited per user');

-- ---- a household pending deletion, or a removed member, cannot scan ----
select tests.reset_actor();
delete from public.scanner_sessions where user_id = 'a0000000-0000-4000-8000-000000000001' and revoked_at is not null;
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select set_config('t.c1', (public.scanner_session_create('cc000000-0000-4000-8000-0000000000cc', 'pantry', tests.h('token-carol-0123456789abcdefg'), 600)->>'id'), true);
select tests.reset_actor();
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days' where id = 'cc000000-0000-4000-8000-0000000000cc';
select tests.act_as_anon();
select tests.ok((public.scanner_connect(current_setting('t.c1')::uuid, 'token-carol-0123456789abcdefg', 'device-one-0123456789')->>'error') = 'revoked', 'a household pending deletion stops its scanner sessions');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok((public.scanner_session_create('cc000000-0000-4000-8000-0000000000cc', 'pantry', tests.h('another-carol-token'), 600)->>'error') = 'forbidden', 'and cannot start a new one');

-- ---- purge ----
select tests.reset_actor();
update public.scanner_sessions set expires_at = now() - interval '2 hours', created_at = now() - interval '2 hours 5 minutes' where id = current_setting('t.s3')::uuid;
select tests.ok(public.scanner_purge_expired() >= 1, 'expired sessions are purged an hour after they expire');
select tests.is((select count(*) from public.scanner_sessions where id = current_setting('t.s3')::uuid), 0, 'the old session is gone');

rollback;
