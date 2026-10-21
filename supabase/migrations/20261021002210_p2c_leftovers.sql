-- PRJ-018 P2-C leftovers and batch cooking (D416-D419).
--   leftover_batches       {title, portions made, fridge|freezer, cooked_on, use_by}        household food, any writer manages
--   leftover_consumptions  {batch, idempotency key, portions, eaten|discarded}              the ledger: left = made - sum
--   planned_meals.leftover_batch_id  a plan slot of kind 'leftovers' may point at a batch (servings = portions)
-- Portions are DERIVED (made minus the ledger), never a balance, and a consumption key is unique per batch, so marking the
-- same planned meal eaten twice cannot take the portions twice. A trigger refuses to take more than remain.

create table public.leftover_batches (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  recipe_id     uuid,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  portions_made smallint not null check (portions_made between 1 and 100),
  stored_in     text not null check (stored_in in ('fridge', 'freezer')),
  cooked_on     date not null,
  use_by        date not null,
  source_key    text check (source_key is null or char_length(source_key) <= 120),
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id),
  check (use_by >= cooked_on),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete set null (recipe_id)
);
create index leftover_batches_household_idx on public.leftover_batches (household_id, use_by);
-- "Cook x2" for the same cooked event must never create two batches (retries, double taps).
create unique index leftover_batches_source_key_idx on public.leftover_batches (household_id, source_key) where source_key is not null;
create trigger leftover_batches_set_updated_at before update on public.leftover_batches
  for each row execute function public.set_updated_at();

create table public.leftover_consumptions (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null,
  household_id uuid not null,
  consume_key  text not null check (char_length(consume_key) between 1 and 160),
  portions     smallint not null check (portions between 1 and 100),
  kind         text not null default 'eaten' check (kind in ('eaten', 'discarded')),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (batch_id, consume_key),
  foreign key (batch_id, household_id) references public.leftover_batches (id, household_id) on delete cascade
);
create index leftover_consumptions_household_idx on public.leftover_consumptions (household_id);

-- Never take more than is left: lock the batch row so two concurrent takes serialise.
create or replace function public.leftover_consumption_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_made int;
  v_used int;
begin
  select b.portions_made into v_made from public.leftover_batches b where b.id = new.batch_id and b.household_id = new.household_id for update;
  select coalesce(sum(c.portions), 0) into v_used from public.leftover_consumptions c where c.batch_id = new.batch_id;
  if v_used + new.portions > v_made then
    raise exception 'not enough portions left' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger leftover_consumptions_guard before insert on public.leftover_consumptions
  for each row execute function public.leftover_consumption_guard();

alter table public.leftover_batches enable row level security;
alter table public.leftover_consumptions enable row level security;
revoke all on public.leftover_batches, public.leftover_consumptions from anon;
grant select, insert, update, delete on public.leftover_batches, public.leftover_consumptions to authenticated;

do $$
declare t text;
begin
  foreach t in array array['leftover_batches', 'leftover_consumptions'] loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.is_household_writable(household_id)) with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;

-- Plan slots may point at a batch (set null when the batch is deleted: the slot degrades to a generic "leftovers" slot).
alter table public.planned_meals add column leftover_batch_id uuid;
alter table public.planned_meals add foreign key (leftover_batch_id, household_id)
  references public.leftover_batches (id, household_id) on delete set null (leftover_batch_id);
create index planned_meals_leftover_idx on public.planned_meals (leftover_batch_id) where leftover_batch_id is not null;

-- save_meal_plan: as before, plus leftover slots keep their batch and portions (servings).
create or replace function public.save_meal_plan(p_household_id uuid, p_user_id uuid, p_doc jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id     uuid := (p_doc ->> 'id')::uuid;
  v_start  date := (p_doc ->> 'weekStart')::date;
  v_status public.meal_plan_status := (p_doc ->> 'status')::public.meal_plan_status;
  v_actor  uuid := coalesce(p_user_id, auth.uid());
  e        record;
  v_kind   public.planned_meal_kind;
  v_recipe uuid;
  v_batch  uuid;
  v_serv   integer;
  v_date   date;
  v_type   public.meal_type;
  v_note   text;
begin
  insert into public.meal_plans (id, household_id, start_date, end_date, budget_target_pence, planning_prompt, constraints,
                                 status, approved_at, approved_by, created_by)
  values (v_id, p_household_id, v_start, v_start + 6, (p_doc ->> 'budgetPence')::integer, nullif(p_doc ->> 'prompt', ''),
          jsonb_strip_nulls(jsonb_build_object('mealTypes', p_doc -> 'mealTypes', 'proposalId', p_doc -> 'proposalId')),
          v_status, case when v_status = 'approved' then now() end, case when v_status = 'approved' then v_actor end, v_actor)
  on conflict (id) do update set
    start_date = excluded.start_date, end_date = excluded.end_date,
    budget_target_pence = excluded.budget_target_pence, planning_prompt = excluded.planning_prompt,
    constraints = excluded.constraints, status = excluded.status,
    approved_at = case when excluded.status = 'approved' then coalesce(public.meal_plans.approved_at, now()) end,
    approved_by = case when excluded.status = 'approved' then coalesce(public.meal_plans.approved_by, v_actor) end
  where public.meal_plans.household_id = excluded.household_id;

  if not exists (select 1 from public.meal_plans where id = v_id and household_id = p_household_id) then
    raise exception 'meal plan % belongs to another household', v_id using errcode = 'insufficient_privilege';
  end if;

  update public.meal_plans set status = 'archived'
   where household_id = p_household_id and start_date = v_start and id <> v_id and status <> 'archived';

  delete from public.planned_meals pm
   where pm.meal_plan_id = v_id and pm.household_id = p_household_id and pm.position = 0
     and not exists (select 1 from jsonb_each(coalesce(p_doc -> 'entries', '{}'::jsonb)) en
                      where split_part(en.key, '|', 1)::date = pm.meal_date
                        and split_part(en.key, '|', 2) = pm.meal_type::text);

  for e in select en.key, en.value from jsonb_each(coalesce(p_doc -> 'entries', '{}'::jsonb)) en loop
    v_date := split_part(e.key, '|', 1)::date;
    v_type := split_part(e.key, '|', 2)::public.meal_type;
    v_kind := case e.value ->> 'kind' when 'recipe' then 'recipe' when 'leftovers' then 'leftovers' else 'eating_out' end;
    v_recipe := case when v_kind = 'recipe' then (e.value ->> 'recipeId')::uuid end;
    v_batch := case when v_kind = 'leftovers' then nullif(e.value ->> 'batchId', '')::uuid end;
    v_serv := case when v_kind = 'recipe' then (e.value ->> 'servings')::integer
                   when v_kind = 'leftovers' and v_batch is not null then coalesce((e.value ->> 'portions')::integer, 1)
                   else 1 end;
    v_note := nullif(e.value ->> 'note', '');
    update public.planned_meals set kind = v_kind, recipe_id = v_recipe, leftover_batch_id = v_batch, servings = v_serv,
           approved = (v_status = 'approved'), notes = v_note
     where meal_plan_id = v_id and household_id = p_household_id and position = 0 and meal_date = v_date and meal_type = v_type;
    if not found then
      insert into public.planned_meals (meal_plan_id, household_id, meal_date, meal_type, kind, recipe_id, leftover_batch_id, servings, approved, notes, position)
      values (v_id, p_household_id, v_date, v_type, v_kind, v_recipe, v_batch, v_serv, v_status = 'approved', v_note, 0);
    end if;
  end loop;
end
$$;
