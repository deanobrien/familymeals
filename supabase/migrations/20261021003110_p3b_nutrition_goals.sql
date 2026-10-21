-- PRJ-018 P3-B (DECISIONS D430-D434): optional per-person nutrition goals (special category data, consent-gated).
--
-- Data minimisation: only the chosen goal ids (a fixed list of six), a portion share and a planner opt-in. No weights, ages,
-- medical conditions or calorie targets. Reference values live in the app (cited UK public guidance), not here.
-- Privacy by construction:
--   * every row is visible and writable ONLY by the person it belongs to (not other members, not the household owner);
--   * writes need an ACTIVE nutrition_goals consent (checked in the policies, so a direct API call cannot bypass the UI);
--   * withdrawing the consent DELETES the person's goals (trigger), it does not just hide them;
--   * leaving a household deletes them (trigger on household_members.status = 'left'); account / household purge cascades;
--   * the planner never reads them: it gets an anonymous, deduplicated list of goal ids from planner_goal_nudge() and only
--     for members who opted in with nudge_plan.

create or replace function public.has_nutrition_goals_consent(p_household_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.consent_records c
     where c.household_id = p_household_id and c.user_id = auth.uid()
       and c.consent_type = 'nutrition_goals' and c.withdrawn_at is null
  )
$$;
revoke all on function public.has_nutrition_goals_consent(uuid) from public, anon;
grant execute on function public.has_nutrition_goals_consent(uuid) to authenticated;

create table public.nutrition_goal_profiles (
  household_id        uuid not null references public.households (id) on delete cascade,
  user_id             uuid not null default auth.uid(),
  -- The person confirmed they are an adult (the reference values are adult values; there are no goals for children).
  adult_confirmed_at  timestamptz not null,
  -- How much of a recipe serving this person usually eats (0.25 - 2); used to scale planned meals.
  portion_share       numeric(3,2) not null default 1 check (portion_share between 0.25 and 2),
  -- Opt in to "nudge the plan towards my goals" (the planner sees only anonymous goal ids).
  nudge_plan          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (household_id, user_id),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create trigger nutrition_goal_profiles_set_updated_at before update on public.nutrition_goal_profiles
  for each row execute function public.set_updated_at();

create table public.nutrition_goals (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null,
  goal          text not null check (goal in ('more_fibre', 'less_salt', 'less_sugar', 'more_fruit_veg', 'more_oily_fish', 'less_red_processed_meat')),
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id, goal),
  foreign key (household_id, user_id) references public.nutrition_goal_profiles (household_id, user_id) on delete cascade
);

alter table public.nutrition_goal_profiles enable row level security;
alter table public.nutrition_goals enable row level security;
revoke all on public.nutrition_goal_profiles, public.nutrition_goals from anon;
grant select, insert, update, delete on public.nutrition_goal_profiles, public.nutrition_goals to authenticated;

-- Reading is only ever your own rows; writes need the household to be writable AND an active consent.
-- Deleting your own rows never needs consent.
create policy nutrition_goal_profiles_self_select on public.nutrition_goal_profiles for select to authenticated
  using (user_id = auth.uid());
create policy nutrition_goal_profiles_self_insert on public.nutrition_goal_profiles for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_writable(household_id) and public.has_nutrition_goals_consent(household_id));
create policy nutrition_goal_profiles_self_update on public.nutrition_goal_profiles for update to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id))
  with check (user_id = auth.uid() and public.is_household_writable(household_id) and public.has_nutrition_goals_consent(household_id));
create policy nutrition_goal_profiles_self_delete on public.nutrition_goal_profiles for delete to authenticated
  using (user_id = auth.uid());

create policy nutrition_goals_self_select on public.nutrition_goals for select to authenticated
  using (user_id = auth.uid());
create policy nutrition_goals_self_insert on public.nutrition_goals for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_writable(household_id) and public.has_nutrition_goals_consent(household_id));
create policy nutrition_goals_self_delete on public.nutrition_goals for delete to authenticated
  using (user_id = auth.uid());

-- Replace the caller's whole goal profile in one transaction (SECURITY INVOKER: the policies above are the authority).
-- A missing consent raises 42501; an unknown goal 23514; more than six goals or no adult confirmation 22023.
create or replace function public.set_nutrition_goals(
  p_household_id uuid, p_goals text[], p_portion_share numeric, p_nudge_plan boolean, p_adult_confirmed boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goals text[];
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_nutrition_goals_consent(p_household_id) then
    raise exception 'nutrition goals need your consent first' using errcode = '42501';
  end if;
  if p_adult_confirmed is not true and not exists (
       select 1 from public.nutrition_goal_profiles where household_id = p_household_id and user_id = auth.uid()) then
    raise exception 'goals are for adults only' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct btrim(t)) filter (where btrim(t) <> ''), '{}')
    into v_goals from unnest(coalesce(p_goals, '{}')) as t;
  if cardinality(v_goals) > 6 then
    raise exception 'too many goals' using errcode = '22023';
  end if;
  insert into public.nutrition_goal_profiles (household_id, user_id, adult_confirmed_at, portion_share, nudge_plan)
  values (p_household_id, auth.uid(), now(), coalesce(p_portion_share, 1), coalesce(p_nudge_plan, false))
  on conflict (household_id, user_id) do update
    set portion_share = coalesce(p_portion_share, 1), nudge_plan = coalesce(p_nudge_plan, false);
  delete from public.nutrition_goals where household_id = p_household_id and user_id = auth.uid();
  insert into public.nutrition_goals (household_id, user_id, goal)
    select p_household_id, auth.uid(), g from unnest(v_goals) as g;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.set_nutrition_goals(uuid, text[], numeric, boolean, boolean) from public, anon;
grant execute on function public.set_nutrition_goals(uuid, text[], numeric, boolean, boolean) to authenticated;

-- Withdrawing the consent deletes the stored goals (not just hides them).
create or replace function public.nutrition_goals_on_withdraw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_type = 'nutrition_goals' and new.withdrawn_at is not null and old.withdrawn_at is null then
    delete from public.nutrition_goal_profiles where household_id = new.household_id and user_id = new.user_id; -- cascades to goals
  end if;
  return new;
end
$$;
revoke all on function public.nutrition_goals_on_withdraw() from public, anon, authenticated;
create trigger consent_records_nutrition_goals_withdraw after update on public.consent_records
  for each row execute function public.nutrition_goals_on_withdraw();

-- Leaving a household (member_leave / account deletion set status = 'left') deletes the person's goals.
create or replace function public.nutrition_goals_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'left' and old.status is distinct from 'left' then
    delete from public.nutrition_goal_profiles where household_id = new.household_id and user_id = new.user_id;
  end if;
  return new;
end
$$;
revoke all on function public.nutrition_goals_on_leave() from public, anon, authenticated;
create trigger household_members_nutrition_goals_leave after update on public.household_members
  for each row execute function public.nutrition_goals_on_leave();

-- The planner's view: ONLY a deduplicated list of goal ids, for members with an active consent who opted in to the nudge.
-- No user ids, names or counts leave the database. The caller must be an active member of the household.
create or replace function public.planner_goal_nudge(p_household_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text[];
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a household member' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct g.goal order by g.goal), '{}') into v
    from public.nutrition_goals g
    join public.nutrition_goal_profiles p on p.household_id = g.household_id and p.user_id = g.user_id
   where g.household_id = p_household_id and p.nudge_plan
     and exists (select 1 from public.consent_records c
                  where c.household_id = g.household_id and c.user_id = g.user_id
                    and c.consent_type = 'nutrition_goals' and c.withdrawn_at is null);
  return v;
end
$$;
revoke all on function public.planner_goal_nudge(uuid) from public, anon;
grant execute on function public.planner_goal_nudge(uuid) to authenticated;
