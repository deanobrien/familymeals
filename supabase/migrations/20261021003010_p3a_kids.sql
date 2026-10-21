-- PRJ-018 P3-A kids' mode (D425-D429).
--   kid_profiles           a named child WITHOUT a login: first name / nickname + an emoji + a colour. Nothing else, by construction
--                          (no email, no date of birth, no photo): the CHECKs below allow only those columns and values.
--   dinner_rounds          a parent opens a round for a day or a week: 3 to 6 candidate recipes, optional closing time
--   dinner_round_candidates / dinner_round_votes   thumbs-up or heart per voter per candidate (members and kids)
-- Votes are written through cast_dinner_vote (the round must be open: not closed and not past its closing time); a closed round is
-- final. The PIN that keeps a child inside kids' mode lives only on the device, never here.

create table public.kid_profiles (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  avatar       text not null check (char_length(avatar) between 1 and 12),
  colour       text not null check (colour in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink')),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id)
);
create index kid_profiles_household_idx on public.kid_profiles (household_id);
create trigger kid_profiles_set_updated_at before update on public.kid_profiles
  for each row execute function public.set_updated_at();

create or replace function public.kid_profiles_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.kid_profiles k where k.household_id = new.household_id) >= 8 then
    raise exception 'at most 8 kid profiles per household' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger kid_profiles_limit_trg before insert on public.kid_profiles
  for each row execute function public.kid_profiles_limit();

create table public.dinner_rounds (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title        text check (title is null or char_length(btrim(title)) between 1 and 60),
  for_date     date not null,
  days         smallint not null default 1 check (days between 1 and 7),
  status       text not null default 'open' check (status in ('open', 'closed')),
  closes_at    timestamptz,
  closed_at    timestamptz,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (id, household_id),
  check ((status = 'closed') = (closed_at is not null))
);
create index dinner_rounds_household_idx on public.dinner_rounds (household_id, for_date desc);

create table public.dinner_round_candidates (
  round_id     uuid not null,
  recipe_id    uuid not null,
  household_id uuid not null,
  position     smallint not null check (position between 0 and 5),
  primary key (round_id, recipe_id),
  foreign key (round_id, household_id) references public.dinner_rounds (id, household_id) on delete cascade,
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);

create table public.dinner_round_votes (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null,
  recipe_id     uuid not null,
  household_id  uuid not null,
  voter_user_id uuid references auth.users (id) on delete cascade,
  voter_kid_id  uuid,
  value         text not null check (value in ('up', 'heart')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((voter_user_id is null) <> (voter_kid_id is null)),
  foreign key (round_id, recipe_id) references public.dinner_round_candidates (round_id, recipe_id) on delete cascade,
  foreign key (round_id, household_id) references public.dinner_rounds (id, household_id) on delete cascade,
  foreign key (voter_kid_id, household_id) references public.kid_profiles (id, household_id) on delete cascade
);
create unique index dinner_round_votes_member_uq on public.dinner_round_votes (round_id, recipe_id, voter_user_id) where voter_user_id is not null;
create unique index dinner_round_votes_kid_uq on public.dinner_round_votes (round_id, recipe_id, voter_kid_id) where voter_kid_id is not null;
create index dinner_round_votes_household_idx on public.dinner_round_votes (household_id);

alter table public.kid_profiles enable row level security;
alter table public.dinner_rounds enable row level security;
alter table public.dinner_round_candidates enable row level security;
alter table public.dinner_round_votes enable row level security;
revoke all on public.kid_profiles, public.dinner_rounds, public.dinner_round_candidates, public.dinner_round_votes from anon, authenticated;
grant select on public.kid_profiles, public.dinner_rounds, public.dinner_round_candidates, public.dinner_round_votes to authenticated;
grant insert, update, delete on public.kid_profiles to authenticated;

create policy kid_profiles_select on public.kid_profiles for select to authenticated using (public.is_household_member(household_id));
create policy kid_profiles_insert on public.kid_profiles for insert to authenticated with check (public.is_household_writable(household_id));
create policy kid_profiles_update on public.kid_profiles for update to authenticated
  using (public.is_household_writable(household_id)) with check (public.is_household_writable(household_id));
create policy kid_profiles_delete on public.kid_profiles for delete to authenticated using (public.is_household_writable(household_id));
create policy dinner_rounds_select on public.dinner_rounds for select to authenticated using (public.is_household_member(household_id));
create policy dinner_round_candidates_select on public.dinner_round_candidates for select to authenticated using (public.is_household_member(household_id));
create policy dinner_round_votes_select on public.dinner_round_votes for select to authenticated using (public.is_household_member(household_id));

-- Open a round: 3 to 6 different recipes of this household, atomically.
create or replace function public.create_dinner_round(
  p_household_id uuid, p_for_date date, p_days integer, p_title text, p_recipe_ids uuid[], p_closes_at timestamptz default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_ids uuid[] := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_recipe_ids, '{}')) x);
begin
  if auth.uid() is null or not public.is_household_writable(p_household_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(v_ids) not between 3 and 6 or p_for_date is null or coalesce(p_days, 1) not between 1 and 7 then
    raise exception 'invalid round' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from public.recipes r where r.household_id = p_household_id and r.id = any (v_ids) and r.status <> 'archived') <> cardinality(v_ids) then
    raise exception 'recipe not found' using errcode = 'invalid_parameter_value';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'closing time must be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from public.dinner_rounds d where d.household_id = p_household_id and d.status = 'open' and (d.closes_at is null or d.closes_at > now())) >= 5 then
    raise exception 'too many open rounds' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.dinner_rounds (id, household_id, title, for_date, days, closes_at, created_by)
  values (v_id, p_household_id, nullif(left(btrim(coalesce(p_title, '')), 60), ''), p_for_date, coalesce(p_days, 1), p_closes_at, auth.uid());
  insert into public.dinner_round_candidates (round_id, recipe_id, household_id, position)
  select v_id, x.id, p_household_id, (x.n - 1)::smallint
    from unnest(p_recipe_ids) with ordinality as x(id, n) where x.id = any (v_ids)
  on conflict do nothing;
  return v_id;
end
$$;

create or replace function public.close_dinner_round(p_round_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_hh uuid;
begin
  select household_id into v_hh from public.dinner_rounds where id = p_round_id;
  if v_hh is null or auth.uid() is null or not public.is_household_writable(v_hh) then
    return false;
  end if;
  update public.dinner_rounds set status = 'closed', closed_at = now() where id = p_round_id and status = 'open';
  return true;
end
$$;

-- One vote: a member votes as themselves (p_kid_id null) or taps for a kid profile of the same household. p_value null removes it.
create or replace function public.cast_dinner_vote(p_round_id uuid, p_recipe_id uuid, p_kid_id uuid, p_value text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_r public.dinner_rounds%rowtype;
begin
  select * into v_r from public.dinner_rounds where id = p_round_id;
  if not found or auth.uid() is null or not public.is_household_writable(v_r.household_id) then
    return false;
  end if;
  if v_r.status <> 'open' or (v_r.closes_at is not null and v_r.closes_at <= now()) then
    raise exception 'round is closed' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.dinner_round_candidates c where c.round_id = p_round_id and c.recipe_id = p_recipe_id) then
    return false;
  end if;
  if p_value is not null and p_value not in ('up', 'heart') then
    raise exception 'invalid vote' using errcode = 'invalid_parameter_value';
  end if;
  if p_kid_id is not null and not exists (select 1 from public.kid_profiles k where k.id = p_kid_id and k.household_id = v_r.household_id) then
    return false;
  end if;
  if p_value is null then
    delete from public.dinner_round_votes v
     where v.round_id = p_round_id and v.recipe_id = p_recipe_id
       and ((p_kid_id is not null and v.voter_kid_id = p_kid_id) or (p_kid_id is null and v.voter_user_id = auth.uid()));
  elsif p_kid_id is not null then
    insert into public.dinner_round_votes (round_id, recipe_id, household_id, voter_kid_id, value)
    values (p_round_id, p_recipe_id, v_r.household_id, p_kid_id, p_value)
    on conflict (round_id, recipe_id, voter_kid_id) where voter_kid_id is not null do update set value = excluded.value, updated_at = now();
  else
    insert into public.dinner_round_votes (round_id, recipe_id, household_id, voter_user_id, value)
    values (p_round_id, p_recipe_id, v_r.household_id, auth.uid(), p_value)
    on conflict (round_id, recipe_id, voter_user_id) where voter_user_id is not null do update set value = excluded.value, updated_at = now();
  end if;
  return true;
end
$$;

revoke all on function public.create_dinner_round(uuid, date, integer, text, uuid[], timestamptz) from public, anon;
revoke all on function public.close_dinner_round(uuid) from public, anon;
revoke all on function public.cast_dinner_vote(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.kid_profiles_limit() from public, anon;
grant execute on function public.create_dinner_round(uuid, date, integer, text, uuid[], timestamptz) to authenticated;
grant execute on function public.close_dinner_round(uuid) to authenticated;
grant execute on function public.cast_dinner_vote(uuid, uuid, uuid, text) to authenticated;
