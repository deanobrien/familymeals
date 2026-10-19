-- PRJ-018 schema v1 — 0002 household & identity:
-- households, household_members, invitations, person_profiles, household_exclusions,
-- membership helpers (SECURITY DEFINER, fixed search_path), bootstrap + last-owner guards,
-- invitation create/accept RPCs (tokens are stored only as sha256 hashes).

create table public.households (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null check (char_length(btrim(name)) between 1 and 120),
  default_servings          smallint not null default 4 check (default_servings between 1 and 50),
  currency                  char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  locale                    text not null default 'en-GB' check (char_length(locale) between 2 and 35),
  preferred_units           public.preferred_units not null default 'metric',
  weekly_budget_pence       integer check (weekly_budget_pence is null or weekly_budget_pence >= 0),
  pantry_deduct_on_purchase boolean not null default false, -- BRIEF §14: configurable, off by default
  created_by                uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index households_created_by_idx on public.households (created_by);
create trigger households_set_updated_at before update on public.households
  for each row execute function public.set_updated_at();

create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.household_role not null default 'member',
  display_name  text check (display_name is null or char_length(display_name) between 1 and 80),
  status        public.membership_status not null default 'active',
  invitation_id uuid, -- FK added below (invitations created after)
  joined_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, user_id),
  check ((status = 'active') = (revoked_at is null))
);
create index household_members_user_idx on public.household_members (user_id) where status = 'active';
create trigger household_members_set_updated_at before update on public.household_members
  for each row execute function public.set_updated_at();

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email        text check (email is null or (email = lower(email) and email like '%_@_%')),
  role         public.household_role not null default 'member',
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'), -- sha256 hex; raw token never stored
  invited_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '30 days'),
  check ((accepted_at is null) = (accepted_by is null)),
  check (not (accepted_at is not null and revoked_at is not null))
);
create index invitations_household_idx on public.invitations (household_id);
alter table public.household_members
  add constraint household_members_invitation_fk
  foreign key (invitation_id) references public.invitations (id) on delete set null;

-- Optional per-person preferences (BRIEF §5 PersonProfile). Not necessarily an account holder (e.g. a child).
create table public.person_profiles (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  user_id              uuid references auth.users (id) on delete set null,
  display_name         text not null check (char_length(display_name) between 1 and 80),
  dietary_preference   public.diet_category,
  favourite_tag_ids    uuid[] not null default '{}',
  preferences          jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (household_id, user_id)
);
create index person_profiles_household_idx on public.person_profiles (household_id);
create trigger person_profiles_set_updated_at before update on public.person_profiles
  for each row execute function public.set_updated_at();

-- Household-level hard exclusions (review #4: allergies are special-category data → explicit consent,
-- stored at household level, never per person; only anonymised exclusion lists go to AI prompts).
-- Matchable three ways (L17a/L9 request): canonical ingredient_id (exact), allergen_group (via
-- ingredient_allergens, 0003), or free-text term (fallback for unmatched recipe lines). At least one required.
-- ingredient_id FK added in 0003 once ingredients exist.
create table public.household_exclusions (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  ingredient_id        uuid,
  allergen_group       public.allergen_group,
  term                 text check (term is null or char_length(btrim(term)) between 1 and 120),
  kind                 public.exclusion_kind not null,
  consent_recorded_at  timestamptz,
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (ingredient_id is not null or allergen_group is not null or term is not null),
  check (kind = 'avoid' or consent_recorded_at is not null)
);
create index household_exclusions_household_idx on public.household_exclusions (household_id);

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so policies on household_members itself don't recurse;
-- search_path pinned to '' and every object schema-qualified.
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner'
  )
$$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

-- Creator of a household becomes its first owner (avoids the chicken-and-egg insert problem).
create or replace function public.households_bootstrap_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.household_members (household_id, user_id, role, status)
    values (new.id, new.created_by, 'owner', 'active');
  end if;
  return new;
end
$$;
create trigger households_bootstrap_owner after insert on public.households
  for each row execute function public.households_bootstrap_owner();

-- A household must always keep at least one active owner.
create or replace function public.household_members_guard_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining int;
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    -- Allow cascade deletes of the whole household.
    if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = old.household_id) then
      return old;
    end if;
    select count(*) into remaining from public.household_members m
     where m.household_id = old.household_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id;
    if remaining = 0 then
      raise exception 'household % must keep at least one active owner', old.household_id
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end
$$;
create trigger household_members_guard_last_owner before update or delete on public.household_members
  for each row execute function public.household_members_guard_last_owner();

-- Members may not change their own role/household/user (only owners manage membership; enforced by RLS),
-- and household_id/user_id are immutable for everyone.
create or replace function public.household_members_immutable_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id <> old.household_id or new.user_id <> old.user_id then
    raise exception 'household_id and user_id are immutable' using errcode = 'check_violation';
  end if;
  if new.status <> 'active' and old.status = 'active' and new.revoked_at is null then
    new.revoked_at := now();
  end if;
  return new;
end
$$;
create trigger household_members_immutable_keys before update on public.household_members
  for each row execute function public.household_members_immutable_keys();

-- ---------------------------------------------------------------------------
-- Invitation RPCs. Raw token = 64 hex chars (two v4 UUIDs, ~244 random bits), returned once to the owner;
-- only sha256(token) is persisted.
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_household_id uuid,
  p_email text default null,
  p_role public.household_role default 'member',
  p_ttl interval default interval '7 days'
) returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_exp timestamptz := now() + least(p_ttl, interval '30 days');
begin
  if not public.is_household_owner(p_household_id) then
    raise exception 'only household owners can invite' using errcode = 'insufficient_privilege';
  end if;
  insert into public.invitations (household_id, email, role, token_hash, invited_by, expires_at)
  values (p_household_id, lower(nullif(btrim(p_email), '')), p_role,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), v_exp)
  returning id into v_id;
  return query select v_id, v_token, v_exp;
end
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid -- household_id joined
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into v_inv from public.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'invitation invalid or expired' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.household_members (household_id, user_id, role, status, invitation_id)
  values (v_inv.household_id, v_uid, v_inv.role, 'active', v_inv.id)
  on conflict (household_id, user_id) do update
    set status = 'active', revoked_at = null, role = excluded.role, invitation_id = excluded.invitation_id;
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end
$$;

revoke all on function public.create_invitation(uuid, text, public.household_role, interval) from public;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.create_invitation(uuid, text, public.household_role, interval) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
