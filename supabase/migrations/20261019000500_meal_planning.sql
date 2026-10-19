-- PRJ-018 schema v1 — 0005 meal planning: meal_plans, planned_meals.

create table public.meal_plans (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  start_date           date not null,
  end_date             date not null,
  budget_target_pence  integer check (budget_target_pence is null or budget_target_pence >= 0),
  planning_prompt      text check (planning_prompt is null or char_length(planning_prompt) <= 4000),
  constraints          jsonb check (constraints is null or jsonb_typeof(constraints) = 'object'), -- PlanConstraints snapshot (L9)
  status               public.meal_plan_status not null default 'draft',
  approved_at          timestamptz,
  approved_by          uuid references auth.users (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, household_id),
  check (end_date >= start_date and end_date <= start_date + 30),
  check ((status = 'approved') <= (approved_at is not null))
);
create index meal_plans_household_idx on public.meal_plans (household_id, start_date desc);
create trigger meal_plans_set_updated_at before update on public.meal_plans
  for each row execute function public.set_updated_at();

create table public.planned_meals (
  id            uuid primary key default gen_random_uuid(),
  meal_plan_id  uuid not null,
  household_id  uuid not null,
  meal_date     date not null,
  meal_type     public.meal_type not null,
  kind          public.planned_meal_kind not null default 'recipe',
  recipe_id     uuid,
  servings      smallint not null check (servings between 1 and 100),
  approved      boolean not null default false,
  notes         text check (notes is null or char_length(notes) <= 1000),
  position      smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id),
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete cascade,
  -- recipe deletion must not silently drop history; app archives recipes instead of deleting them.
  foreign key (recipe_id, household_id) references public.recipes (id, household_id), -- NO ACTION (checked end-of-statement so household cascade works)
  check ((kind = 'recipe') = (recipe_id is not null) or kind = 'leftovers')
);
create index planned_meals_plan_idx on public.planned_meals (meal_plan_id, meal_date, meal_type, position);
create index planned_meals_household_idx on public.planned_meals (household_id);
create index planned_meals_recipe_idx on public.planned_meals (recipe_id);
create trigger planned_meals_set_updated_at before update on public.planned_meals
  for each row execute function public.set_updated_at();

-- meal_date must fall inside its plan's date range.
create or replace function public.planned_meals_check_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.meal_plans p
     where p.id = new.meal_plan_id and p.household_id = new.household_id
       and new.meal_date between p.start_date and p.end_date
  ) then
    raise exception 'meal_date % is outside meal plan range', new.meal_date using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger planned_meals_check_date before insert or update of meal_date, meal_plan_id on public.planned_meals
  for each row execute function public.planned_meals_check_date();
