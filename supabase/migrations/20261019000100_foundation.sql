-- PRJ-018 schema v1 — 0001 foundation: extensions, enums, shared helper functions.
-- Target: Supabase Postgres 15+ (also validated against PGlite / Postgres 17 with tests/support/supabase-stub.sql).
-- Conventions: UUID PKs (gen_random_uuid), timestamptz, money = integer pence, every household-scoped
-- table carries household_id (denormalised) so RLS policies are a single indexed membership check.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (names/values mirror CONTRACT-SEED.ts exactly)
-- ---------------------------------------------------------------------------
create type public.unit as enum (
  'mg', 'g', 'kg',                                              -- MassUnit
  'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',              -- VolumeUnit
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick' -- CountUnit
);
create type public.dimension as enum ('mass', 'volume', 'count');
create type public.quantity_kind as enum ('exact', 'range', 'approximate', 'to_taste', 'unparsed');
create type public.value_status as enum ('known', 'zero', 'unknown', 'unavailable');
create type public.nutrient_key as enum (
  'energy_kcal', 'energy_kj', 'protein', 'carbohydrate', 'sugars', 'fat', 'saturates', 'fibre', 'salt', 'sodium'
);
create type public.nutrient_unit as enum ('kcal', 'kJ', 'g', 'mg', 'ug');
create type public.price_kind as enum ('user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate');
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type public.diet_category as enum ('meat', 'fish', 'vegetarian', 'vegan');
create type public.ingredient_form as enum ('fresh', 'dried', 'ground', 'frozen', 'canned', 'other');

create type public.household_role as enum ('owner', 'member');
create type public.membership_status as enum ('active', 'revoked', 'left');
create type public.preferred_units as enum ('metric', 'imperial', 'us');
create type public.exclusion_kind as enum ('allergy', 'intolerance', 'avoid');
-- UK FIC 14 regulated allergens.
create type public.allergen_group as enum (
  'celery', 'cereals_gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs',
  'mustard', 'peanuts', 'sesame', 'soya', 'sulphites', 'tree_nuts'
);
create type public.recipe_status as enum ('draft', 'active', 'archived');
create type public.recipe_image_kind as enum ('source', 'cover');
create type public.meal_plan_status as enum ('draft', 'approved', 'archived');
create type public.planned_meal_kind as enum ('recipe', 'leftovers', 'eating_out', 'other');
create type public.shopping_list_status as enum ('active', 'completed', 'archived');
create type public.shopping_item_status as enum ('active', 'removed');
create type public.receipt_status as enum ('uploaded', 'parsed', 'reconciling', 'reconciled', 'failed');
create type public.receipt_line_match_status as enum ('unmatched', 'suggested', 'confirmed', 'extra', 'ignored');
create type public.pantry_source as enum ('manual', 'purchase', 'receipt');
create type public.nutrition_basis as enum ('total', 'per_serving');
create type public.ai_operation as enum (
  'recipe_extraction', 'receipt_parse', 'tagging', 'meal_plan', 'ingredient_match', 'substitution'
);
create type public.ai_status as enum ('success', 'error', 'invalid_output', 'rate_limited', 'rejected');

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Dimension of a canonical unit (mirrors engine; used for CHECKs / views only).
create or replace function public.unit_dimension(u public.unit)
returns public.dimension
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when u in ('mg','g','kg') then 'mass'::public.dimension
    when u in ('ml','l','tsp','tbsp','cup','floz','pint') then 'volume'::public.dimension
    else 'count'::public.dimension
  end
$$;

-- Shape rules for a flattened Quantity (CONTRACT-SEED Quantity):
--   exact       -> value > 0, no min/max
--   range       -> 0 <= min <= max, no value
--   approximate -> optional value (> 0), no min/max (approx_label carries 'pinch'/'handful'; never a weight)
--   to_taste    -> no value/min/max/unit
--   unparsed    -> no value/min/max/unit (original_text is the only truth)
create or replace function public.quantity_is_valid(
  k public.quantity_kind, v numeric, mn numeric, mx numeric, u public.unit
) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case k
    when 'exact'       then v is not null and v > 0 and mn is null and mx is null
    when 'range'       then v is null and mn is not null and mx is not null and mn >= 0 and mn <= mx
    when 'approximate' then (v is null or v > 0) and mn is null and mx is null
    when 'to_taste'    then v is null and mn is null and mx is null and u is null
    when 'unparsed'    then v is null and mn is null and mx is null and u is null
  end
$$;

-- Safe text -> uuid cast (NULL on bad input); used by storage path policies.
create or replace function public.try_uuid(t text)
returns uuid
language plpgsql immutable parallel safe
set search_path = ''
as $$
begin
  return t::uuid;
exception when others then
  return null;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
