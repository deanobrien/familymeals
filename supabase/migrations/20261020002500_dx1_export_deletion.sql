-- PRJ-018 DX1 — data export + deletion lifecycle (docs/security/DATA-EXPORT-DELETION.md; decisions D250-D259).
--   data_export_requests      audit + rate limit for exports (1 per user, household and scope per 24 h; link 1 h)
--   begin/record_data_export  RPCs (authenticated): the archive itself is built by the app AS THE USER (RLS) and
--                             streamed; nothing is stored (D250)
--   request_household_deletion: end users can no longer shorten the 14-day grace period (D252)
--   request/cancel_account_deletion + my_account_deletion (authenticated): leave every shared household now,
--                             schedule sole-member households for deletion, ledger an 'account' subject (D253)
--   purchase_events           append-only trigger also allows the account-purge anonymisation shape (D254)
--   storage_cleanup_queue     + 'local-uploads' pseudo-bucket (legacy local photo store) + last_attempt_at backoff;
--                             recipe_versions delete enqueues local upload folders (D255)
--   jobs_* RPCs (service_role ONLY, called by /api/jobs/purge): due household purges + deletion-ledger replay,
--                             account purges, storage cleanup claim/complete/fail, status (D256, D257)

-- New enum value: only referenced inside plpgsql bodies (resolved at run time), never in this file's DML.
alter type public.deletion_subject add value if not exists 'account';

-- ---------------------------------------------------------------------------
-- data_export_requests
-- ---------------------------------------------------------------------------
create table public.data_export_requests (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope               text not null check (scope in ('member', 'household')),
  status              text not null default 'ready' check (status in ('ready', 'downloaded', 'failed')),
  requested_at        timestamptz not null default now(),
  expires_at          timestamptz not null,
  download_count      integer not null default 0 check (download_count between 0 and 5),
  last_downloaded_at  timestamptz,
  bytes               bigint check (bytes is null or bytes >= 0),
  counts              jsonb check (counts is null or jsonb_typeof(counts) = 'object'),
  error               text check (error is null or char_length(error) <= 200),
  check (expires_at > requested_at)
);
create index data_export_requests_user_idx on public.data_export_requests (user_id, household_id, scope, requested_at desc);
create index data_export_requests_household_idx on public.data_export_requests (household_id);

alter table public.data_export_requests enable row level security;
-- Own rows only (an owner cannot see what other members exported). Writes only through the RPCs below.
create policy data_export_requests_self_select on public.data_export_requests for select to authenticated
  using (user_id = auth.uid());
revoke all on public.data_export_requests from anon, authenticated;
grant select on public.data_export_requests to authenticated;

-- Starts an export. Members may export their own subset ('member'); only owners the whole household. Allowed during
-- the deletion grace period (read access is kept so people can take their data with them).
-- Rate limit: one non-failed export per (user, household, scope) per 24 hours.
create or replace function public.begin_data_export(p_household_id uuid, p_scope text)
returns table (export_id uuid, expires_at timestamptz, allowed boolean, retry_after timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_id uuid;
  v_exp timestamptz := now() + interval '1 hour';
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if p_scope not in ('member', 'household') then
    raise exception 'scope must be member or household' using errcode = 'invalid_parameter_value';
  end if;
  -- Lock the caller's membership row: serialises concurrent requests (rate limit cannot be raced).
  perform 1 from public.household_members m
   where m.household_id = p_household_id and m.user_id = v_uid and m.status = 'active'
     and (p_scope = 'member' or m.role = 'owner')
   for update;
  if not found then
    raise exception 'not allowed to export this household' using errcode = 'insufficient_privilege';
  end if;
  select max(r.requested_at) into v_last from public.data_export_requests r
   where r.user_id = v_uid and r.household_id = p_household_id and r.scope = p_scope
     and r.status <> 'failed' and r.requested_at > now() - interval '24 hours';
  if v_last is not null then
    return query select null::uuid, null::timestamptz, false, v_last + interval '24 hours';
    return;
  end if;
  insert into public.data_export_requests (household_id, user_id, scope, expires_at)
  values (p_household_id, v_uid, p_scope, v_exp)
  returning id into v_id;
  return query select v_id, v_exp, true, null::timestamptz;
end
$$;

-- Records the outcome of one download of an export (own, unexpired rows only). A failed build frees the rate limit.
create or replace function public.record_data_export_download(
  p_export_id uuid, p_ok boolean, p_bytes bigint default null, p_counts jsonb default null, p_error text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.data_export_requests r
     set status = case when p_ok then 'downloaded' else 'failed' end,
         download_count = least(r.download_count + 1, 5),
         last_downloaded_at = now(),
         bytes = coalesce(p_bytes, r.bytes),
         counts = coalesce(p_counts, r.counts),
         error = case when p_ok then null else left(coalesce(p_error, 'failed'), 200) end
   where r.id = p_export_id and r.user_id = auth.uid() and r.expires_at > now() and r.status <> 'failed';
  if not found then
    raise exception 'export not found or expired' using errcode = 'invalid_parameter_value';
  end if;
end
$$;

revoke all on function public.begin_data_export(uuid, text) from public, anon;
revoke all on function public.record_data_export_download(uuid, boolean, bigint, jsonb, text) from public, anon;
grant execute on function public.begin_data_export(uuid, text) to authenticated;
grant execute on function public.record_data_export_download(uuid, boolean, bigint, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- request_household_deletion: end users always get the full 14-day grace (p_grace can only lengthen it).
-- Service role / maintenance (auth.uid() null) may still pass a shorter grace.
-- ---------------------------------------------------------------------------
create or replace function public.request_household_deletion(p_household_id uuid, p_grace interval default interval '14 days')
returns timestamptz -- purge_after
language plpgsql security definer
set search_path = ''
as $$
declare
  v_grace interval := greatest(coalesce(p_grace, interval '14 days'), interval '0');
  v_purge timestamptz;
begin
  if auth.uid() is not null then
    v_grace := greatest(v_grace, interval '14 days');
  end if;
  v_purge := now() + v_grace;
  if not public.is_household_owner(p_household_id) then
    raise exception 'only household owners can delete a household' using errcode = 'insufficient_privilege';
  end if;
  update public.households
     set status = 'pending_deletion', deletion_requested_at = now(), purge_after = v_purge
   where id = p_household_id and status = 'active';
  if not found then
    raise exception 'household already pending deletion' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.deletion_ledger (subject_type, subject_id, requested_by, scheduled_purge_at)
  values ('household', p_household_id, auth.uid(), v_purge);
  return v_purge;
end
$$;
revoke all on function public.request_household_deletion(uuid, interval) from public, anon;
grant execute on function public.request_household_deletion(uuid, interval) to authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion (end user). Runs everything that can happen at once, as the user:
--   * households where the user is the ONLY active member: scheduled for deletion (14-day grace) like an owner request
--   * other households: the user leaves now (same effects as member_leave); refused if they are the sole owner there
--   * an 'account' ledger row; the purge job deletes the auth user once scheduled_purge_at has passed
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion()
returns timestamptz -- when the account itself will be deleted
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sched timestamptz := now();
  m record;
  v_others int;
  v_other_owners int;
  v_purge timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.deletion_ledger l
              where l.subject_type = 'account' and l.subject_id = v_uid and l.purged_at is null and l.cancelled_at is null) then
    raise exception 'account deletion already requested' using errcode = 'invalid_parameter_value';
  end if;
  for m in
    select hm.id, hm.household_id, hm.role from public.household_members hm
     where hm.user_id = v_uid and hm.status = 'active'
     order by hm.joined_at
     for update
  loop
    perform 1 from public.households h where h.id = m.household_id for update;
    select count(*) filter (where o.user_id <> v_uid),
           count(*) filter (where o.user_id <> v_uid and o.role = 'owner')
      into v_others, v_other_owners
      from public.household_members o where o.household_id = m.household_id and o.status = 'active';
    if v_others = 0 then
      select h.purge_after into v_purge from public.households h where h.id = m.household_id and h.status = 'pending_deletion';
      if v_purge is null then
        v_purge := now() + interval '14 days';
        update public.households
           set status = 'pending_deletion', deletion_requested_at = now(), purge_after = v_purge
         where id = m.household_id;
        insert into public.deletion_ledger (subject_type, subject_id, requested_by, scheduled_purge_at)
        values ('household', m.household_id, v_uid, v_purge);
      end if;
      v_sched := greatest(v_sched, v_purge);
    elsif m.role = 'owner' and v_other_owners = 0 then
      raise exception 'transfer ownership of every shared household before deleting your account'
        using errcode = 'invalid_parameter_value';
    else
      update public.household_members set status = 'left', display_name = null where id = m.id;
      delete from public.person_profiles where household_id = m.household_id and user_id = v_uid;
      delete from public.consent_records where household_id = m.household_id and user_id = v_uid;
      delete from public.recipe_favourites where household_id = m.household_id and user_id = v_uid;
      insert into public.deletion_ledger (subject_type, subject_id, household_id, requested_by, scheduled_purge_at, purged_at)
      values ('member', v_uid, m.household_id, v_uid, now(), now());
    end if;
  end loop;
  insert into public.deletion_ledger (subject_type, subject_id, requested_by, scheduled_purge_at)
  values ('account', v_uid, v_uid, v_sched);
  return v_sched;
end
$$;

-- Cancels a pending account deletion. Households already left stay left; households scheduled for deletion stay
-- scheduled (the owner cancels those separately with cancel_household_deletion).
create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.deletion_ledger set cancelled_at = now()
   where subject_type = 'account' and subject_id = auth.uid() and purged_at is null and cancelled_at is null;
  return found;
end
$$;

create or replace function public.my_account_deletion()
returns timestamptz -- scheduled time, or null when none is pending
language plpgsql stable security definer
set search_path = ''
as $$
declare v timestamptz;
begin
  select l.scheduled_purge_at into v from public.deletion_ledger l
   where l.subject_type = 'account' and l.subject_id = auth.uid() and l.purged_at is null and l.cancelled_at is null
   order by l.requested_at desc limit 1;
  return v;
end
$$;

revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
revoke all on function public.my_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.my_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------
-- purchase_events append-only: + the account-purge anonymisation shape (actor columns to NULL and, only when it was
-- NULL, a display-name snapshot filled in). End users have no UPDATE grant; only the service-role job reaches it.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'purchase_events are append-only; void instead of delete' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  -- UPDATE (a): anonymisation — actor columns may only go to NULL; the display-name snapshot may only be filled
  if (to_jsonb(new) - 'created_by' - 'voided_by' - 'created_by_display_name')
       = (to_jsonb(old) - 'created_by' - 'voided_by' - 'created_by_display_name')
     and (new.created_by is null or new.created_by is not distinct from old.created_by)
     and (new.voided_by is null or new.voided_by is not distinct from old.voided_by)
     and (new.created_by_display_name is not distinct from old.created_by_display_name
          or (old.created_by_display_name is null and new.created_by is null)) then
    return new;
  end if;
  -- UPDATE (b): a single void transition
  if old.voided_at is not null
     or new.voided_at is null
     or (to_jsonb(new) - 'voided_by' - 'voided_at') <> (to_jsonb(old) - 'voided_by' - 'voided_at') then
    raise exception 'purchase_events are append-only; only a one-time void is permitted' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- storage_cleanup_queue: legacy local photo store + retry backoff
-- ---------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select k.conname from pg_constraint k
            where k.conrelid = 'public.storage_cleanup_queue'::regclass and k.contype = 'c'
              and pg_get_constraintdef(k.oid) ilike '%bucket%recipe-images%'
  loop
    execute format('alter table public.storage_cleanup_queue drop constraint %I', c);
  end loop;
end
$$;
alter table public.storage_cleanup_queue
  add constraint storage_cleanup_queue_bucket_chk check (bucket in ('recipe-images', 'receipt-images', 'local-uploads')),
  add column last_attempt_at timestamptz;

-- Upload ids of the legacy local photo store ('/api/uploads/<uuid>/<file>') referenced by a recipe version.
create or replace function public.recipe_version_local_uploads(p_corrected jsonb, p_paths text[])
returns setof text
language sql immutable
set search_path = ''
as $$
  select distinct (regexp_match(x, '^/api/uploads/([0-9a-fA-F-]{36})/'))[1]
    from unnest(array_append(coalesce(p_paths, '{}'), p_corrected ->> 'imageUrl')) x
   where x ~ '^/api/uploads/[0-9a-fA-F-]{36}/'
$$;
revoke all on function public.recipe_version_local_uploads(jsonb, text[]) from public, anon;

create or replace function public.recipe_versions_enqueue_local_cleanup()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare u text;
begin
  for u in select public.recipe_version_local_uploads(old.corrected, old.source_image_paths) loop
    -- another surviving version may still use the same upload (e.g. after duplicate): keep it then
    if not exists (select 1 from public.recipe_versions v
                    where v.household_id = old.household_id and v.id <> old.id and u in (select public.recipe_version_local_uploads(v.corrected, v.source_image_paths))) then
      perform public.enqueue_storage_cleanup('local-uploads', u, old.household_id, 'recipe_version_deleted');
    end if;
  end loop;
  return null;
end
$$;
create trigger recipe_versions_enqueue_local_cleanup after delete on public.recipe_versions
  for each row execute function public.recipe_versions_enqueue_local_cleanup();

-- ---------------------------------------------------------------------------
-- Job RPCs: service role ONLY (the /api/jobs/purge route, behind JOBS_SECRET).
-- ---------------------------------------------------------------------------

-- Purges due households and replays the deletion ledger (households the ledger says were purged but that exist
-- again, e.g. after a backup restore). Idempotent.
create or replace function public.jobs_purge_due(p_limit integer default 25)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_purged int := 0;
  v_replayed int := 0;
begin
  for r in
    select distinct h.id from public.households h
      join public.deletion_ledger l on l.subject_type = 'household' and l.subject_id = h.id and l.purged_at is not null
     limit greatest(p_limit, 1)
  loop
    perform public.purge_household(r.id);
    v_replayed := v_replayed + 1;
  end loop;
  for r in
    select h.id from public.households h
     where h.status = 'pending_deletion' and h.purge_after <= now()
     order by h.purge_after
     limit greatest(p_limit, 1)
     for update skip locked
  loop
    perform public.purge_household(r.id);
    v_purged := v_purged + 1;
  end loop;
  return jsonb_build_object('purged', v_purged, 'replayed', v_replayed);
end
$$;

-- Accounts whose deletion is due, plus accounts the ledger says were deleted but exist again (replay after restore).
create or replace function public.jobs_due_account_deletions(p_limit integer default 25)
returns table (user_id uuid, replay boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return query
  select d.subject_id, d.replay from (
    select distinct on (l.subject_id) l.subject_id, (l.purged_at is not null) as replay, l.scheduled_purge_at
      from public.deletion_ledger l
     where l.subject_type = 'account' and l.cancelled_at is null
       and ((l.purged_at is null and l.scheduled_purge_at <= now())
            or (l.purged_at is not null and exists (select 1 from auth.users u where u.id = l.subject_id)))
     order by l.subject_id, l.purged_at nulls first
  ) d
  order by d.scheduled_purge_at
  limit greatest(p_limit, 1);
end
$$;

-- Prepares one account for auth-user deletion. Returns 'ready', or 'blocked_owner' (still the only owner of a
-- household with other members) / 'blocked_household' (still the only member of a household that is not being
-- purged, e.g. its deletion was cancelled). On 'ready': remaining memberships are left, person profiles removed and
-- purchase history anonymised (actor ids nulled, display-name snapshot kept or set to 'Former member').
create or replace function public.jobs_prepare_account_purge(p_user_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare m record;
begin
  if exists (
    select 1 from public.household_members hm
     where hm.user_id = p_user_id and hm.status = 'active' and hm.role = 'owner'
       and exists (select 1 from public.household_members o
                    where o.household_id = hm.household_id and o.status = 'active' and o.user_id <> p_user_id)
       and not exists (select 1 from public.household_members o
                        where o.household_id = hm.household_id and o.status = 'active' and o.role = 'owner'
                          and o.user_id <> p_user_id)) then
    return 'blocked_owner';
  end if;
  if exists (
    select 1 from public.household_members hm
     where hm.user_id = p_user_id and hm.status = 'active'
       and not exists (select 1 from public.household_members o
                        where o.household_id = hm.household_id and o.status = 'active' and o.user_id <> p_user_id)) then
    return 'blocked_household';
  end if;
  for m in select hm.id, hm.household_id from public.household_members hm
            where hm.user_id = p_user_id and hm.status = 'active' loop
    update public.household_members set status = 'left', display_name = null where id = m.id;
    delete from public.consent_records where household_id = m.household_id and user_id = p_user_id;
    delete from public.recipe_favourites where household_id = m.household_id and user_id = p_user_id;
  end loop;
  delete from public.person_profiles where user_id = p_user_id;
  update public.purchase_events
     set created_by = null, created_by_display_name = coalesce(created_by_display_name, 'Former member')
   where created_by = p_user_id;
  update public.purchase_events set voided_by = null where voided_by = p_user_id;
  return 'ready';
end
$$;

create or replace function public.jobs_complete_account_purge(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.deletion_ledger set purged_at = now()
   where subject_type = 'account' and subject_id = p_user_id and purged_at is null and cancelled_at is null;
end
$$;

-- Claims up to p_limit pending cleanup rows (attempt counter bumped; exponential-ish backoff by attempts).
create or replace function public.jobs_claim_storage_cleanup(p_limit integer default 100, p_max_attempts integer default 8)
returns table (id uuid, bucket text, object_path text, attempts integer)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  update public.storage_cleanup_queue q
     set attempts = q.attempts + 1, last_attempt_at = now()
   where q.id in (
     select c.id from public.storage_cleanup_queue c
      where c.processed_at is null and c.attempts < p_max_attempts
        and (c.last_attempt_at is null or c.last_attempt_at < now() - make_interval(mins => 5 * c.attempts * c.attempts))
      order by c.enqueued_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning q.id, q.bucket, q.object_path, q.attempts;
end
$$;

create or replace function public.jobs_complete_storage_cleanup(p_ids uuid[])
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  update public.storage_cleanup_queue set processed_at = now(), last_error = null
   where id = any (p_ids) and processed_at is null;
  get diagnostics n = row_count;
  return n;
end
$$;

create or replace function public.jobs_fail_storage_cleanup(p_id uuid, p_error text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.storage_cleanup_queue set last_error = left(coalesce(p_error, 'failed'), 1000)
   where id = p_id and processed_at is null;
end
$$;

-- Counts for monitoring/alerting (no ids, no paths).
create or replace function public.jobs_status(p_max_attempts integer default 8)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'cleanupPending', (select count(*) from public.storage_cleanup_queue where processed_at is null and attempts < p_max_attempts),
    'cleanupStuck', (select count(*) from public.storage_cleanup_queue where processed_at is null and attempts >= p_max_attempts),
    'cleanupOldestMinutes', (select coalesce(floor(extract(epoch from now() - min(enqueued_at)) / 60), 0)::int
                               from public.storage_cleanup_queue where processed_at is null),
    'householdsPendingDeletion', (select count(*) from public.households where status = 'pending_deletion'),
    'accountsPendingDeletion', (select count(*) from public.deletion_ledger
                                 where subject_type = 'account' and purged_at is null and cancelled_at is null)
  ) into v;
  return v;
end
$$;

revoke all on function public.jobs_purge_due(integer) from public, anon, authenticated;
revoke all on function public.jobs_due_account_deletions(integer) from public, anon, authenticated;
revoke all on function public.jobs_prepare_account_purge(uuid) from public, anon, authenticated;
revoke all on function public.jobs_complete_account_purge(uuid) from public, anon, authenticated;
revoke all on function public.jobs_claim_storage_cleanup(integer, integer) from public, anon, authenticated;
revoke all on function public.jobs_complete_storage_cleanup(uuid[]) from public, anon, authenticated;
revoke all on function public.jobs_fail_storage_cleanup(uuid, text) from public, anon, authenticated;
revoke all on function public.jobs_status(integer) from public, anon, authenticated;
revoke all on function public.recipe_versions_enqueue_local_cleanup() from public, anon, authenticated;
grant execute on function public.jobs_purge_due(integer) to service_role;
grant execute on function public.jobs_due_account_deletions(integer) to service_role;
grant execute on function public.jobs_prepare_account_purge(uuid) to service_role;
grant execute on function public.jobs_complete_account_purge(uuid) to service_role;
grant execute on function public.jobs_claim_storage_cleanup(integer, integer) to service_role;
grant execute on function public.jobs_complete_storage_cleanup(uuid[]) to service_role;
grant execute on function public.jobs_fail_storage_cleanup(uuid, text) to service_role;
grant execute on function public.jobs_status(integer) to service_role;
