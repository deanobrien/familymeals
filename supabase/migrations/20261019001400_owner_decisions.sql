-- PRJ-018 schema v1 — 0014 owner-side decisions applied at merge (2026-10-19):
--   (a) purchase_events survive account deletion: created_by / voided_by become nullable with
--       ON DELETE SET NULL, plus a created_by_display_name snapshot taken at insert time.
--   (d) a household in its 14-day deletion grace period is READ-ONLY for members:
--       every INSERT/UPDATE/DELETE RLS policy that gates on is_household_member() is rewritten to
--       is_household_writable(); RPC-only write paths are guarded by triggers. cancel_household_deletion()
--       (owner), member_leave() and withdrawing consent stay available. Purge/service-role paths are unaffected.

-- ---------------------------------------------------------------------------
-- (a) purchase_events: nullable actors + display-name snapshot
-- ---------------------------------------------------------------------------
alter table public.purchase_events
  add column created_by_display_name text
    check (created_by_display_name is null or char_length(created_by_display_name) between 1 and 80);

alter table public.purchase_events alter column created_by drop not null;
alter table public.purchase_events drop constraint purchase_events_created_by_fkey;
alter table public.purchase_events
  add constraint purchase_events_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
alter table public.purchase_events drop constraint purchase_events_voided_by_fkey;
alter table public.purchase_events
  add constraint purchase_events_voided_by_fkey
  foreign key (voided_by) references auth.users (id) on delete set null;
-- voided_by may be nulled by account deletion; voided_at stays as the truth that the event is void.
do $$
declare c text;
begin
  select k.conname into c from pg_constraint k
   where k.conrelid = 'public.purchase_events'::regclass and k.contype = 'c'
     and pg_get_constraintdef(k.oid) ilike '%voided_by IS NULL%voided_at IS NULL%';
  if c is null then raise exception 'purchase_events voided check not found'; end if;
  execute format('alter table public.purchase_events drop constraint %I', c);
end
$$;
alter table public.purchase_events
  add constraint purchase_events_voided_chk check (voided_by is null or voided_at is not null);

-- Snapshot the actor's display name when the event is recorded (member name, else person profile name).
create or replace function public.purchase_events_snapshot_actor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.created_by_display_name is null and new.created_by is not null then
    select coalesce(m.display_name, p.display_name) into new.created_by_display_name
      from (select 1) x
      left join public.household_members m on m.household_id = new.household_id and m.user_id = new.created_by
      left join public.person_profiles p on p.household_id = new.household_id and p.user_id = new.created_by;
  end if;
  return new;
end
$$;
create trigger purchase_events_snapshot_actor before insert on public.purchase_events
  for each row execute function public.purchase_events_snapshot_actor();

-- Append-only rule, extended: besides the one-time void, the ONLY other permitted UPDATE is the FK
-- ON DELETE SET NULL anonymisation of created_by / voided_by (account deletion). Authenticated users have no
-- UPDATE privilege on this table (0013), so that shape cannot be reached by an end user.
create or replace function public.purchase_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- allow household-level cascade (account/household deletion) only
    if exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'purchase_events are append-only; void instead of delete' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  -- UPDATE (a): account-deletion anonymisation — actor columns may only go to NULL, nothing else changes
  if (to_jsonb(new) - 'created_by' - 'voided_by') = (to_jsonb(old) - 'created_by' - 'voided_by')
     and (new.created_by is null or new.created_by is not distinct from old.created_by)
     and (new.voided_by is null or new.voided_by is not distinct from old.voided_by) then
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
-- (d) read-only grace period
-- ---------------------------------------------------------------------------
create or replace function public.household_is_active(hid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.households h where h.id = hid and h.status = 'active')
$$;

-- Active member of a household that is NOT pending deletion. Use in every write policy.
create or replace function public.is_household_writable(hid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.household_members m
      join public.households h on h.id = m.household_id
     where m.household_id = hid and m.user_id = auth.uid() and m.status = 'active' and h.status = 'active'
  )
$$;

revoke all on function public.household_is_active(uuid) from public;
revoke all on function public.is_household_writable(uuid) from public;
grant execute on function public.household_is_active(uuid) to authenticated;
grant execute on function public.is_household_writable(uuid) to authenticated;

-- Rewrite every write (INSERT/UPDATE/DELETE) policy in public + storage that gates on membership.
-- SELECT policies are untouched: members keep read access (and export) during the grace period.
do $$
declare
  p record;
  v_using text;
  v_check text;
  v_stmt text;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (coalesce(qual, '') ~ 'is_household_member\(' or coalesce(with_check, '') ~ 'is_household_member\(')
  loop
    v_stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      v_using := regexp_replace(p.qual, 'is_household_member\(', 'is_household_writable(', 'g');
      v_stmt := v_stmt || ' using (' || v_using || ')';
    end if;
    if p.with_check is not null then
      v_check := regexp_replace(p.with_check, 'is_household_member\(', 'is_household_writable(', 'g');
      v_stmt := v_stmt || ' with check (' || v_check || ')';
    end if;
    execute v_stmt;
  end loop;
end
$$;

-- Owner-gated write policies (is_household_owner): owners are members too, so freeze them as well.
alter policy households_owner_update on public.households
  using (public.is_household_owner(id) and status = 'active')
  with check (public.is_household_owner(id));
alter policy household_members_owner_insert on public.household_members
  with check (public.is_household_owner(household_id) and public.household_is_active(household_id));
alter policy household_members_update on public.household_members
  using ((public.is_household_owner(household_id) and public.household_is_active(household_id))
         or (user_id = auth.uid() and status = 'active'))
  with check ((public.is_household_owner(household_id) and public.household_is_active(household_id))
              or user_id = auth.uid());
alter policy invitations_owner_insert on public.invitations
  with check (public.is_household_owner(household_id) and public.household_is_active(household_id)
              and invited_by = auth.uid());
alter policy invitations_owner_update on public.invitations
  using (public.is_household_owner(household_id) and public.household_is_active(household_id))
  with check (public.is_household_owner(household_id));
-- (household_members_delete / consent withdrawal / favourites cleanup are deliberately left open:
--  leaving a household and withdrawing consent must work during the grace period.)

-- RPC-only write paths (SECURITY DEFINER bypasses RLS) are guarded at the table. Only end-user calls
-- (auth.uid() not null) are refused, so purge / service-role maintenance and FK actions still run.
create or replace function public.guard_household_writable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_hid uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_hid := (to_jsonb(new) ->> 'household_id')::uuid;
  if not public.household_is_active(v_hid) then
    raise exception 'household is pending deletion and read-only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger purchase_events_guard_writable before insert on public.purchase_events
  for each row execute function public.guard_household_writable();
create trigger shopping_command_log_guard_writable before insert on public.shopping_command_log
  for each row execute function public.guard_household_writable();
create trigger invitations_guard_writable before insert on public.invitations
  for each row execute function public.guard_household_writable();
create trigger household_members_guard_writable before insert on public.household_members
  for each row execute function public.guard_household_writable();

-- A void is the only UPDATE end users cause on purchase_events (via void_purchase()).
create or replace function public.purchase_events_guard_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.voided_at is distinct from old.voided_at
     and not public.household_is_active(new.household_id) then
    raise exception 'household is pending deletion and read-only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger purchase_events_guard_void before update on public.purchase_events
  for each row execute function public.purchase_events_guard_void();
