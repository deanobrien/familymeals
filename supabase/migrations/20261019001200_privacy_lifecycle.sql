-- PRJ-018 schema v1 — 0012 privacy lifecycle (requested by L24 security/privacy; see
-- docs/security/DATA-EXPORT-DELETION.md and docs/security/PRIVACY.md):
--   consent_records          explicit consent for special-category data (allergies / dietary restrictions)
--   storage_cleanup_queue    objects to delete from Storage after row deletion (Storage never cascades)
--   deletion_ledger          purge requests/completions; replayed after any backup restore
--   households.status        'active' | 'pending_deletion' (+ purge_after, 14-day grace)
--   RPCs                     request/cancel household deletion, member_leave, purge_household (service role)
-- Naming: L1 uses plural table names (consent_records) except queue/ledger nouns; mapping noted in SCHEMA.md.

create type public.consent_type as enum ('allergy_data', 'dietary_restrictions');
create type public.household_status as enum ('active', 'pending_deletion');
create type public.deletion_subject as enum ('household', 'member');

-- ---------------------------------------------------------------------------
-- households: soft-delete with grace period
-- ---------------------------------------------------------------------------
alter table public.households
  add column status public.household_status not null default 'active',
  add column deletion_requested_at timestamptz,
  add column purge_after timestamptz,
  add constraint households_deletion_state_chk check (
    (status = 'active' and deletion_requested_at is null and purge_after is null)
    or (status = 'pending_deletion' and deletion_requested_at is not null and purge_after is not null
        and purge_after >= deletion_requested_at)
  );
create index households_purge_due_idx on public.households (purge_after) where status = 'pending_deletion';

-- ---------------------------------------------------------------------------
-- consent_records: own rows only. Withdrawal is an UPDATE setting withdrawn_at (history retained
-- until the member leaves / account deletion, when the rows are deleted).
-- ---------------------------------------------------------------------------
create table public.consent_records (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consent_type     public.consent_type not null,
  wording_version  text not null check (char_length(wording_version) between 1 and 40),
  granted_at       timestamptz not null default now(),
  withdrawn_at     timestamptz,
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create unique index consent_records_active_uq on public.consent_records (household_id, user_id, consent_type)
  where withdrawn_at is null;
create index consent_records_user_idx on public.consent_records (user_id);

alter table public.consent_records enable row level security;
create policy consent_records_self_select on public.consent_records for select to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id));
create policy consent_records_self_insert on public.consent_records for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id) and withdrawn_at is null);
create policy consent_records_self_withdraw on public.consent_records for update to authenticated
  using (user_id = auth.uid() and withdrawn_at is null)
  with check (user_id = auth.uid() and withdrawn_at is not null);
grant select, insert, update on public.consent_records to authenticated;

-- Only withdrawn_at may change on a consent record.
create or replace function public.consent_records_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'withdrawn_at') <> (to_jsonb(old) - 'withdrawn_at') then
    raise exception 'consent records are immutable except withdrawn_at' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger consent_records_immutable before update on public.consent_records
  for each row execute function public.consent_records_immutable();

-- Allergy/intolerance exclusions require an active consent from the person recording them
-- (complements the existing consent_recorded_at CHECK on household_exclusions).
create or replace function public.household_exclusions_require_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('allergy', 'intolerance') and auth.uid() is not null and not exists (
    select 1 from public.consent_records c
     where c.household_id = new.household_id and c.user_id = auth.uid()
       and c.consent_type in ('allergy_data', 'dietary_restrictions') and c.withdrawn_at is null
  ) then
    raise exception 'recording allergy/intolerance data requires active consent' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger household_exclusions_require_consent before insert or update on public.household_exclusions
  for each row execute function public.household_exclusions_require_consent();

-- ---------------------------------------------------------------------------
-- storage_cleanup_queue / deletion_ledger: service role only (RLS on, no policies, no grants).
-- household_id deliberately has NO FK so rows survive the household purge they describe.
-- ---------------------------------------------------------------------------
create table public.storage_cleanup_queue (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null check (bucket in ('recipe-images', 'receipt-images')),
  object_path   text not null check (char_length(object_path) between 1 and 1024),
  household_id  uuid,
  reason        text not null default 'row_deleted' check (char_length(reason) <= 60),
  enqueued_at   timestamptz not null default now(),
  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text check (last_error is null or char_length(last_error) <= 1000),
  processed_at  timestamptz
);
create unique index storage_cleanup_queue_pending_uq on public.storage_cleanup_queue (bucket, object_path)
  where processed_at is null;
create index storage_cleanup_queue_due_idx on public.storage_cleanup_queue (enqueued_at) where processed_at is null;

create table public.deletion_ledger (
  id                  uuid primary key default gen_random_uuid(),
  subject_type        public.deletion_subject not null,
  subject_id          uuid not null,             -- household id, or user id for member/account deletion
  household_id        uuid,                      -- context for member deletions; NO FK (survives purge)
  requested_by        uuid,                      -- NO FK (survives account deletion)
  requested_at        timestamptz not null default now(),
  scheduled_purge_at  timestamptz not null default now() + interval '14 days',
  cancelled_at        timestamptz,
  purged_at           timestamptz,
  check (scheduled_purge_at >= requested_at),
  check (not (cancelled_at is not null and purged_at is not null))
);
create index deletion_ledger_subject_idx on public.deletion_ledger (subject_type, subject_id);
create index deletion_ledger_due_idx on public.deletion_ledger (scheduled_purge_at)
  where purged_at is null and cancelled_at is null;

alter table public.storage_cleanup_queue enable row level security;
alter table public.deletion_ledger enable row level security;
revoke all on public.storage_cleanup_queue, public.deletion_ledger from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue storage objects when the rows that own them are deleted.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_storage_cleanup(p_bucket text, p_path text, p_household_id uuid, p_reason text)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.storage_cleanup_queue (bucket, object_path, household_id, reason)
  select p_bucket, p_path, p_household_id, p_reason
   where p_path is not null and p_path <> ''
  on conflict (bucket, object_path) where processed_at is null do nothing
$$;
revoke all on function public.enqueue_storage_cleanup(text, text, uuid, text) from public;

create or replace function public.recipe_images_enqueue_cleanup()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.enqueue_storage_cleanup('recipe-images', old.storage_path, old.household_id, 'recipe_image_deleted');
  return null;
end
$$;
create trigger recipe_images_enqueue_cleanup after delete on public.recipe_images
  for each row execute function public.recipe_images_enqueue_cleanup();

create or replace function public.recipes_enqueue_cover_cleanup()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('recipe-images', old.cover_image_path, old.household_id, 'recipe_deleted');
  elsif old.cover_image_path is distinct from new.cover_image_path
        and not exists (select 1 from public.recipe_images i where i.storage_path = old.cover_image_path) then
    perform public.enqueue_storage_cleanup('recipe-images', old.cover_image_path, old.household_id, 'cover_replaced');
  end if;
  return null;
end
$$;
create trigger recipes_enqueue_cover_cleanup after update of cover_image_path or delete on public.recipes
  for each row execute function public.recipes_enqueue_cover_cleanup();

create or replace function public.receipts_enqueue_cleanup()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare p text;
begin
  if tg_op = 'DELETE' then
    foreach p in array old.image_paths loop
      perform public.enqueue_storage_cleanup('receipt-images', p, old.household_id, 'receipt_deleted');
    end loop;
  else
    -- PRIVACY.md: receipt images are deleted N days after confirmation by clearing image_paths
    for p in select x from unnest(old.image_paths) x except select y from unnest(new.image_paths) y loop
      perform public.enqueue_storage_cleanup('receipt-images', p, old.household_id, 'receipt_image_removed');
    end loop;
  end if;
  return null;
end
$$;
create trigger receipts_enqueue_cleanup after update of image_paths or delete on public.receipts
  for each row execute function public.receipts_enqueue_cleanup();

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs
-- ---------------------------------------------------------------------------
create or replace function public.request_household_deletion(p_household_id uuid, p_grace interval default interval '14 days')
returns timestamptz -- purge_after
language plpgsql security definer
set search_path = ''
as $$
declare v_purge timestamptz := now() + greatest(p_grace, interval '0');
begin
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

create or replace function public.cancel_household_deletion(p_household_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_household_owner(p_household_id) then
    raise exception 'only household owners can cancel deletion' using errcode = 'insufficient_privilege';
  end if;
  update public.households
     set status = 'active', deletion_requested_at = null, purge_after = null
   where id = p_household_id and status = 'pending_deletion';
  update public.deletion_ledger set cancelled_at = now()
   where subject_type = 'household' and subject_id = p_household_id and purged_at is null and cancelled_at is null;
end
$$;

-- Leave a household: access revoked immediately; the member's personal data for that household
-- (person profile, consents, display name) is deleted; shared content they created stays.
create or replace function public.member_leave(p_household_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.household_members%rowtype;
  v_others int;
  v_other_owners int;
begin
  select * into v_me from public.household_members
   where household_id = p_household_id and user_id = v_uid and status = 'active' for update;
  if not found then
    raise exception 'not an active member' using errcode = 'insufficient_privilege';
  end if;
  select count(*) filter (where m.user_id <> v_uid),
         count(*) filter (where m.user_id <> v_uid and m.role = 'owner')
    into v_others, v_other_owners
    from public.household_members m where m.household_id = p_household_id and m.status = 'active';
  if v_others = 0 then
    raise exception 'last member: use request_household_deletion instead' using errcode = 'invalid_parameter_value';
  end if;
  if v_me.role = 'owner' and v_other_owners = 0 then
    raise exception 'transfer ownership before leaving' using errcode = 'invalid_parameter_value';
  end if;
  update public.household_members set status = 'left', display_name = null where id = v_me.id;
  delete from public.person_profiles where household_id = p_household_id and user_id = v_uid;
  delete from public.consent_records where household_id = p_household_id and user_id = v_uid;
  delete from public.recipe_favourites where household_id = p_household_id and user_id = v_uid;
  insert into public.deletion_ledger (subject_type, subject_id, household_id, requested_by, scheduled_purge_at, purged_at)
  values ('member', v_uid, p_household_id, v_uid, now(), now());
end
$$;

-- Hard purge (service role / cron only). Queues storage objects BEFORE rows vanish, then cascades.
create or replace function public.purge_household(p_household_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.storage_cleanup_queue (bucket, object_path, household_id, reason)
  select o.bucket_id, o.name, p_household_id, 'household_purged'
    from storage.objects o
   where o.bucket_id in ('recipe-images', 'receipt-images')
     and (storage.foldername(o.name))[1] = p_household_id::text
  on conflict (bucket, object_path) where processed_at is null do nothing;
  delete from public.households where id = p_household_id; -- ON DELETE CASCADE does the rest
  update public.deletion_ledger set purged_at = now()
   where subject_type = 'household' and subject_id = p_household_id and purged_at is null and cancelled_at is null;
  if not found then
    insert into public.deletion_ledger (subject_type, subject_id, scheduled_purge_at, purged_at)
    values ('household', p_household_id, now(), now());
  end if;
end
$$;

revoke all on function public.request_household_deletion(uuid, interval) from public;
revoke all on function public.cancel_household_deletion(uuid) from public;
revoke all on function public.member_leave(uuid) from public;
revoke all on function public.purge_household(uuid) from public, anon, authenticated;
grant execute on function public.request_household_deletion(uuid, interval) to authenticated;
grant execute on function public.cancel_household_deletion(uuid) to authenticated;
grant execute on function public.member_leave(uuid) to authenticated;
grant execute on function public.purge_household(uuid) to service_role;

-- Re-run the RLS safety net for tables added here.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS not enabled on: %', missing;
  end if;
end
$$;
