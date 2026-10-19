-- PRJ-018 schema v1 — 0008 recipe nutrition profiles (calculated cache) and AI usage ledger.

-- NutritionProfile for a recipe (ingredient-level composition lives in ingredient_nutrients, 0003).
create table public.nutrition_profiles (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null,
  recipe_id           uuid not null,
  basis               public.nutrition_basis not null,
  servings            smallint not null check (servings between 1 and 100),
  calculation_method  text not null check (char_length(calculation_method) between 1 and 80), -- e.g. 'engine-v1 sum per 100g'
  engine_version      text,
  coverage_ratio      numeric(4,3) check (coverage_ratio is null or coverage_ratio between 0 and 1),     -- share of lines with data
  confidence          text check (confidence is null or confidence in ('high', 'medium', 'low')),
  calculated_at       timestamptz not null default now(),
  unique (id, household_id),
  unique (recipe_id, basis, servings),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index nutrition_profiles_household_idx on public.nutrition_profiles (household_id);

create table public.nutrition_profile_values (
  id                    uuid primary key default gen_random_uuid(),
  nutrition_profile_id  uuid not null,
  household_id          uuid not null,
  nutrient              public.nutrient_key not null,
  value_status          public.value_status not null,
  value                 numeric(12,4),
  unit                  public.nutrient_unit not null,
  source                text,
  estimate              boolean not null default false,
  unique (nutrition_profile_id, nutrient),
  foreign key (nutrition_profile_id, household_id) references public.nutrition_profiles (id, household_id) on delete cascade,
  check (case value_status
           when 'known' then value is not null and value >= 0
           when 'zero'  then value = 0
           else value is null end)
);
create index nutrition_profile_values_household_idx on public.nutrition_profile_values (household_id);

-- Review: AiUsage for limits + audit. Written by the server (service role) only; members may read.
-- Cost is integer millipence (1/1000 p) — AI calls routinely cost fractions of a penny; no floats for money.
create table public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  user_id            uuid references auth.users (id) on delete set null,
  operation          public.ai_operation not null,
  provider           text not null check (char_length(provider) between 1 and 40),
  model              text not null check (char_length(model) between 1 and 100),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  image_count        smallint not null default 0 check (image_count >= 0),
  cost_millipence    bigint not null default 0 check (cost_millipence >= 0),
  status             public.ai_status not null,
  error_code         text check (error_code is null or char_length(error_code) <= 80),
  latency_ms         integer check (latency_ms is null or latency_ms >= 0),
  request_id         text,
  created_at         timestamptz not null default now()
);
create index ai_usage_household_time_idx on public.ai_usage (household_id, created_at desc);
create index ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);
