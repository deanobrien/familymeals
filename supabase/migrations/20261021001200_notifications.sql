-- PRJ-018 P1-C (D380-D389): notification platform. Additive only.
--
--   notification_devices          push endpoints per user + household + platform (Expo push token on Android, Web Push
--                                 subscription on the web). Own rows only; written through register_push_device().
--   notification_settings         per member: quiet hours, time zone, expiry morning hour and lead days.
--   notification_preferences      per member per type: in_app ("show it in my notification centre") and push
--                                 ("also send it to my devices"; implies in_app).
--   notifications                 the in-app centre AND the push outbox: one row per recipient, unique dedupe key, push
--                                 status + attempt count, read state. Users read their own rows and may set read_at only.
--   notification_delivery_attempts / notification_job_state   service-only (the /api/jobs/notify job).
--
-- The activity feed is DERIVED from existing tables (shopping_command_log, meal_plans, recipes, household_members) by
-- activity_events(): nothing is written twice. Push text is stored separately (push_title / push_body) and is always
-- generic: allergy details, receipt contents and item names never leave in a push payload (D384).

-- ---------------------------------------------------------------------------------------------------------------
-- Types (text + CHECK, not an enum: easier to extend in later migrations)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.notification_type_is_valid(p_type text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_type in ('expiry', 'list_changed_while_shopping', 'purchase_by_other', 'item_added', 'plan_approved',
                    'recipe_added', 'member_joined', 'restock', 'test')
$$;
grant execute on function public.notification_type_is_valid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------------------------------------------
create table public.notification_devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  household_id    uuid not null references public.households (id) on delete cascade,
  platform        text not null check (platform in ('web', 'android')),
  channel         text not null check (channel in ('expo', 'webpush')),
  -- Expo: "ExponentPushToken[...]"; Web Push: the subscription endpoint URL.
  token           text not null check (char_length(token) between 10 and 2000),
  -- Web Push only: { p256dh, auth } (public key material of the browser subscription).
  keys            jsonb check (keys is null or jsonb_typeof(keys) = 'object'),
  label           text check (label is null or char_length(label) <= 80),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) <= 60),
  failure_count   integer not null default 0 check (failure_count >= 0),
  unique (channel, token, household_id),
  check ((channel = 'webpush') = (keys is not null)),
  check ((channel = 'expo') <= (platform = 'android'))
);
create index notification_devices_user_idx on public.notification_devices (user_id, household_id) where disabled_at is null;

alter table public.notification_devices enable row level security;
revoke all on public.notification_devices from anon, authenticated;
grant select, delete on public.notification_devices to authenticated;
create policy notification_devices_own_select on public.notification_devices for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_devices_own_delete on public.notification_devices for delete to authenticated
  using (user_id = (select auth.uid()));

-- Register (or refresh) this device for the caller in one household. A token that belonged to ANOTHER user (shared
-- phone, someone else signed in before) is taken over: their rows for it are removed so they stop receiving pushes
-- meant for whoever is signed in now. At most 10 active devices per user + household (oldest dropped).
create or replace function public.register_push_device(
  p_household_id uuid, p_platform text, p_channel text, p_token text, p_keys jsonb default null, p_label text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  delete from public.notification_devices
   where channel = p_channel and token = p_token and user_id <> v_uid;
  insert into public.notification_devices (user_id, household_id, platform, channel, token, keys, label)
  values (v_uid, p_household_id, p_platform, p_channel, p_token, p_keys, nullif(btrim(coalesce(p_label, '')), ''))
  on conflict (channel, token, household_id) do update
     set user_id = excluded.user_id, platform = excluded.platform, keys = excluded.keys, label = excluded.label,
         last_seen_at = now(), disabled_at = null, disabled_reason = null, failure_count = 0
  returning id into v_id;
  delete from public.notification_devices d
   where d.user_id = v_uid and d.household_id = p_household_id and d.id in (
     select x.id from public.notification_devices x
      where x.user_id = v_uid and x.household_id = p_household_id
      order by x.last_seen_at desc, x.id offset 10);
  return v_id;
end
$$;
revoke all on function public.register_push_device(uuid, text, text, text, jsonb, text) from public;
grant execute on function public.register_push_device(uuid, text, text, text, jsonb, text) to authenticated;

-- Remove the caller's registrations of a token (every household): "turn off on this device" / sign-out.
create or replace function public.unregister_push_device(p_token text)
returns integer
language sql security definer
set search_path = ''
as $$
  with d as (delete from public.notification_devices where token = p_token and user_id = auth.uid() returning 1)
  select count(*)::integer from d
$$;
revoke all on function public.unregister_push_device(text) from public;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Per-member settings and per-type preferences
-- ---------------------------------------------------------------------------------------------------------------
create table public.notification_settings (
  household_id     uuid not null references public.households (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  quiet_enabled    boolean not null default true,
  quiet_start      time not null default '21:30',
  quiet_end        time not null default '07:30',
  time_zone        text not null default 'Europe/London' check (char_length(time_zone) between 1 and 64),
  morning_hour     smallint not null default 8 check (morning_hour between 5 and 12),
  expiry_lead_days smallint not null default 1 check (expiry_lead_days between 0 and 3),
  updated_at       timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.notification_preferences (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         text not null check (public.notification_type_is_valid(type) and type <> 'test'),
  in_app       boolean not null,
  push         boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, user_id, type),
  check (in_app or not push)
);

alter table public.notification_settings enable row level security;
alter table public.notification_preferences enable row level security;
revoke all on public.notification_settings, public.notification_preferences from anon;
grant select, insert, update, delete on public.notification_settings, public.notification_preferences to authenticated;

do $$
declare t text;
begin
  foreach t in array array['notification_settings', 'notification_preferences'] loop
    execute format($f$create policy %1$s_own_select on public.%1$I for select to authenticated
                     using (user_id = (select auth.uid()) and public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_own_insert on public.%1$I for insert to authenticated
                     with check (user_id = (select auth.uid()) and public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_own_update on public.%1$I for update to authenticated
                     using (user_id = (select auth.uid()) and public.is_household_writable(household_id))
                     with check (user_id = (select auth.uid()) and public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_own_delete on public.%1$I for delete to authenticated
                     using (user_id = (select auth.uid()) and public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Notifications: in-app centre + push outbox
-- ---------------------------------------------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  type            text not null check (public.notification_type_is_valid(type)),
  title           text not null check (char_length(btrim(title)) between 1 and 140),
  body            text not null default '' check (char_length(body) <= 400),
  -- What a push may show on a lock screen: generic by construction (D384).
  push_title      text not null check (char_length(btrim(push_title)) between 1 and 80),
  push_body       text not null default '' check (char_length(push_body) <= 160),
  -- In-app path only (no scheme, no host): the deep link the web opens and the Android app maps to a screen.
  link            text not null default '/' check (char_length(link) <= 300 and link ~ '^/[A-Za-z0-9/_.?=&%-]*$'),
  dedupe_key      text not null check (char_length(dedupe_key) between 1 and 200),
  data            jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at      timestamptz not null default now(),
  deliver_after   timestamptz not null default now(),
  push_status     text not null default 'not_requested'
                    check (push_status in ('not_requested', 'pending', 'sent', 'failed', 'no_devices', 'expired')),
  push_attempts   smallint not null default 0 check (push_attempts between 0 and 50),
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  read_at         timestamptz,
  unique (user_id, household_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, household_id, created_at desc);
create index notifications_pending_idx on public.notifications (deliver_after) where push_status = 'pending';
create index notifications_created_idx on public.notifications (created_at);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and public.is_household_member(household_id));
-- Marking as read is allowed during the deletion grace period too (it changes nothing but the reader's own state).
create policy notifications_own_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.notification_delivery_attempts (
  id                 bigint generated always as identity primary key,
  notification_id    uuid not null references public.notifications (id) on delete cascade,
  device_id          uuid references public.notification_devices (id) on delete set null,
  channel            text not null check (channel in ('expo', 'webpush')),
  attempted_at       timestamptz not null default now(),
  outcome            text not null check (outcome in ('sent', 'invalid_token', 'retry', 'error')),
  error_code         text check (error_code is null or char_length(error_code) <= 60),
  provider_ref       text check (provider_ref is null or char_length(provider_ref) <= 200),
  receipt_checked_at timestamptz
);
create index notification_attempts_notification_idx on public.notification_delivery_attempts (notification_id);
create index notification_attempts_receipts_idx on public.notification_delivery_attempts (attempted_at)
  where channel = 'expo' and outcome = 'sent' and receipt_checked_at is null and provider_ref is not null;

create table public.notification_job_state (
  key        text primary key check (char_length(key) between 1 and 60),
  value      timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.notification_delivery_attempts enable row level security;
alter table public.notification_job_state enable row level security;
revoke all on public.notification_delivery_attempts, public.notification_job_state from anon, authenticated;

-- "Send a test notification": one in-app row for the caller (+ a push when they have a device). At most one per 30 s.
create or replace function public.request_test_notification(p_household_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_has_device boolean;
begin
  if v_uid is null or not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if exists (select 1 from public.notifications
              where user_id = v_uid and household_id = p_household_id and type = 'test'
                and created_at > now() - interval '30 seconds') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.notification_devices
                  where user_id = v_uid and household_id = p_household_id and disabled_at is null)
    into v_has_device;
  insert into public.notifications (household_id, user_id, type, title, body, push_title, push_body, link, dedupe_key,
                                    push_status)
  values (p_household_id, v_uid, 'test', 'Test notification',
          'Notifications are working. You can change what you get in Settings > Notifications.',
          'Family Recipes', 'Test notification: notifications are working.', '/notifications',
          'test:' || gen_random_uuid()::text, case when v_has_device then 'pending' else 'no_devices' end)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.request_test_notification(uuid) from public;
grant execute on function public.request_test_notification(uuid) to authenticated;

-- The test route sends the test push straight away AS THE USER (their own device rows are readable under RLS; the
-- service role stays off the request path, D100) and records the outcome here: only the caller's own pending test
-- notification, and only the caller's own devices can be disabled.
create or replace function public.complete_test_push(p_notification_id uuid, p_sent boolean, p_invalid_device_ids uuid[] default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  update public.notifications
     set push_status = case when p_sent then 'sent' else 'failed' end,
         push_attempts = push_attempts + 1, last_attempt_at = now(), sent_at = case when p_sent then now() end
   where id = p_notification_id and user_id = v_uid and type = 'test' and push_status = 'pending';
  if not found then
    raise exception 'test notification not found' using errcode = 'P0002';
  end if;
  update public.notification_devices
     set disabled_at = now(), disabled_reason = 'invalid_token'
   where user_id = v_uid and id = any (coalesce(p_invalid_device_ids, '{}'::uuid[])) and disabled_at is null;
end
$$;
revoke all on function public.complete_test_push(uuid, boolean, uuid[]) from public;
grant execute on function public.complete_test_push(uuid, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Activity feed, derived from existing tables (no extra writes). SECURITY INVOKER: RLS applies to every source table,
-- so a member only ever sees their own households' events. The job calls it as service_role for every household.
-- ---------------------------------------------------------------------------------------------------------------
create index if not exists shopping_command_log_household_created_idx on public.shopping_command_log (household_id, created_at);
create index if not exists recipes_household_created_idx on public.recipes (household_id, created_at);

create or replace function public.activity_events(
  p_household_id uuid, p_since timestamptz, p_until timestamptz, p_limit integer default 50)
returns table (id text, household_id uuid, type text, actor_id uuid, actor_name text, subject text, list_id uuid,
               ref_id uuid, at timestamptz)
language sql stable
set search_path = ''
as $$
  with ev as (
    select 'scl:' || c.seq::text as id, c.household_id,
           case when c.command_type in ('tick', 'purchase') then 'purchase_by_other' else 'item_added' end as type,
           c.created_by as actor_id,
           coalesce(i.display_name, c.command ->> 'displayName') as subject,
           c.shopping_list_id as list_id, i.id as ref_id, c.created_at as at
      from public.shopping_command_log c
      left join public.shopping_list_items i
        on i.household_id = c.household_id
       and (c.command ->> 'itemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and i.id = (c.command ->> 'itemId')::uuid
     where c.status = 'applied' and c.command_type in ('tick', 'purchase', 'add')
       and (p_household_id is null or c.household_id = p_household_id)
       and c.created_at > p_since and c.created_at <= p_until
    union all
    select 'plan:' || p.id::text || ':' || floor(extract(epoch from p.approved_at))::bigint::text, p.household_id,
           'plan_approved', p.approved_by, to_char(p.start_date, 'YYYY-MM-DD'), null::uuid, p.id, p.approved_at
      from public.meal_plans p
     where p.status = 'approved' and p.approved_at is not null
       and (p_household_id is null or p.household_id = p_household_id)
       and p.approved_at > p_since and p.approved_at <= p_until
    union all
    select 'recipe:' || r.id::text, r.household_id, 'recipe_added', r.created_by, r.title, null::uuid, r.id, r.created_at
      from public.recipes r
     where r.status <> 'archived'
       and (p_household_id is null or r.household_id = p_household_id)
       and r.created_at > p_since and r.created_at <= p_until
    union all
    select 'member:' || m.id::text, m.household_id, 'member_joined', m.user_id, null::text, null::uuid, null::uuid, m.joined_at
      from public.household_members m
     where m.status = 'active'
       and (p_household_id is null or m.household_id = p_household_id)
       and m.joined_at > p_since and m.joined_at <= p_until
  )
  select ev.id, ev.household_id, ev.type, ev.actor_id,
         coalesce((select hm.display_name from public.household_members hm
                    where hm.household_id = ev.household_id and hm.user_id = ev.actor_id), 'A member') as actor_name,
         ev.subject, ev.list_id, ev.ref_id, ev.at
    from ev
   order by ev.at desc, ev.id desc
   limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;
revoke all on function public.activity_events(uuid, timestamptz, timestamptz, integer) from public;
grant execute on function public.activity_events(uuid, timestamptz, timestamptz, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Job helpers (service_role only)
-- ---------------------------------------------------------------------------------------------------------------
-- Pantry items with a date from yesterday up to p_until, in active households, with the reference category (used to
-- choose "use by" or the softer "best before" wording, D383).
create or replace function public.jobs_expiry_candidates(p_until date)
returns table (household_id uuid, item_id uuid, display_name text, expires_on date, category text, source text)
language sql stable
set search_path = ''
as $$
  select p.household_id, p.id, p.display_name, p.expires_on, i.category, p.source::text
    from public.pantry_items p
    join public.households h on h.id = p.household_id and h.status = 'active'
    left join public.ingredients i on i.id = p.ingredient_id
   where p.expires_on is not null and p.expires_on >= current_date - 1 and p.expires_on <= p_until
   order by p.household_id, p.expires_on, p.id
   limit 20000
$$;

-- Active members of active households with their settings (nulls = defaults) and per-type preferences.
create or replace function public.jobs_notification_recipients()
returns table (household_id uuid, user_id uuid, quiet_enabled boolean, quiet_start time, quiet_end time, time_zone text,
               morning_hour smallint, expiry_lead_days smallint, prefs jsonb)
language sql stable
set search_path = ''
as $$
  select m.household_id, m.user_id, s.quiet_enabled, s.quiet_start, s.quiet_end, s.time_zone, s.morning_hour,
         s.expiry_lead_days,
         coalesce((select jsonb_object_agg(p.type, jsonb_build_object('inApp', p.in_app, 'push', p.push))
                     from public.notification_preferences p
                    where p.household_id = m.household_id and p.user_id = m.user_id), '{}'::jsonb)
    from public.household_members m
    join public.households h on h.id = m.household_id and h.status = 'active'
    left join public.notification_settings s on s.household_id = m.household_id and s.user_id = m.user_id
   where m.status = 'active'
$$;

-- Who ticked something on which list recently: "shopping now" for the list-changed alert (D385).
create or replace function public.jobs_recent_shoppers(p_since timestamptz)
returns table (household_id uuid, list_id uuid, user_id uuid, last_at timestamptz)
language sql stable
set search_path = ''
as $$
  select c.household_id, c.shopping_list_id, c.created_by, max(c.created_at)
    from public.shopping_command_log c
   where c.status = 'applied' and c.command_type in ('tick', 'purchase') and c.created_by is not null
     and c.created_at > p_since
   group by 1, 2, 3
$$;

revoke all on function public.jobs_expiry_candidates(date) from public;
revoke all on function public.jobs_notification_recipients() from public;
revoke all on function public.jobs_recent_shoppers(timestamptz) from public;
grant execute on function public.jobs_expiry_candidates(date) to service_role;
grant execute on function public.jobs_notification_recipients() to service_role;
grant execute on function public.jobs_recent_shoppers(timestamptz) to service_role;
