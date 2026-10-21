-- PRJ-018 P2-C calendar-aware planning (D410-D415). Only DERIVED busy flags are stored, never event titles, places or
-- attendees: the device (Android) or the ICS reader (server) reduces a calendar to "busy that evening, N minutes free".
--
--   plan_busy_days          {household, day, source manual|device|ics, set by, minutes_available?}  household-visible
--   member_calendar_feeds   {household, member, encrypted ICS URL, host hint, last sync status}      OWN ROWS ONLY
--
-- The ICS subscription address is a secret (anyone holding it can read the calendar), so it is stored AES-256-GCM
-- encrypted with APP_SECRET by the app (ciphertext only here) and RLS shows each row to its own member and nobody else.
-- A member who leaves takes their feed and their device / ICS flags with them (trigger below), like cooking rows.

create table public.plan_busy_days (
  household_id      uuid not null references public.households (id) on delete cascade,
  day               date not null,
  source            text not null check (source in ('manual', 'device', 'ics')),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  minutes_available smallint check (minutes_available is null or minutes_available between 0 and 1440),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (household_id, day, source, user_id)
);
create index plan_busy_days_household_idx on public.plan_busy_days (household_id, day);
create trigger plan_busy_days_set_updated_at before update on public.plan_busy_days
  for each row execute function public.set_updated_at();

create table public.member_calendar_feeds (
  household_id   uuid not null references public.households (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url_encrypted  text not null check (char_length(url_encrypted) between 20 and 4000),
  host_hint      text not null check (char_length(host_hint) between 1 and 253),
  last_synced_at timestamptz,
  last_status    text check (last_status is null or char_length(last_status) <= 80),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);
create trigger member_calendar_feeds_set_updated_at before update on public.member_calendar_feeds
  for each row execute function public.set_updated_at();

alter table public.plan_busy_days enable row level security;
alter table public.member_calendar_feeds enable row level security;
revoke all on public.plan_busy_days, public.member_calendar_feeds from anon;
grant select, insert, update, delete on public.plan_busy_days, public.member_calendar_feeds to authenticated;

create policy plan_busy_days_select on public.plan_busy_days for select to authenticated
  using (public.is_household_member(household_id));
create policy plan_busy_days_insert on public.plan_busy_days for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_writable(household_id));
create policy plan_busy_days_update on public.plan_busy_days for update to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id))
  with check (user_id = auth.uid() and public.is_household_writable(household_id));
-- Anyone in the household may clear a manual toggle; device / ics flags are cleared only by the member they came from.
create policy plan_busy_days_delete on public.plan_busy_days for delete to authenticated
  using (public.is_household_writable(household_id) and (user_id = auth.uid() or source = 'manual'));

-- The feed address: strictly the owner's own row.
create policy member_calendar_feeds_select on public.member_calendar_feeds for select to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id));
create policy member_calendar_feeds_insert on public.member_calendar_feeds for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_writable(household_id));
create policy member_calendar_feeds_update on public.member_calendar_feeds for update to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id))
  with check (user_id = auth.uid() and public.is_household_writable(household_id));
create policy member_calendar_feeds_delete on public.member_calendar_feeds for delete to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id));

create or replace function public.calendar_member_left()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.member_calendar_feeds where household_id = new.household_id and user_id = new.user_id;
  delete from public.plan_busy_days where household_id = new.household_id and user_id = new.user_id and source <> 'manual';
  return new;
end
$$;
revoke all on function public.calendar_member_left() from public, anon, authenticated;
create trigger household_members_calendar_left after update of status on public.household_members
  for each row when (old.status is distinct from new.status and new.status in ('left', 'revoked'))
  execute function public.calendar_member_left();
