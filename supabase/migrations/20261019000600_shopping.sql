-- PRJ-018 schema v1 — 0006 shopping:
-- shopping_lists, shopping_list_items (required quantity only — purchased qty is DERIVED),
-- shopping_list_item_sources (provenance item <- planned meal <- recipe ingredient),
-- purchase_events (append-only; client-generated UUID = idempotent offline replay),
-- shopping_list_item_progress view (purchased / outstanding derived from purchase_events).

create table public.shopping_lists (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  meal_plan_id  uuid,
  status        public.shopping_list_status not null default 'active',
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id),
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete set null (meal_plan_id)
);
create index shopping_lists_household_idx on public.shopping_lists (household_id, status, updated_at desc);
create index shopping_lists_meal_plan_idx on public.shopping_lists (meal_plan_id);
create trigger shopping_lists_set_updated_at before update on public.shopping_lists
  for each row execute function public.set_updated_at();

create table public.shopping_list_items (
  id                     uuid primary key default gen_random_uuid(),
  shopping_list_id       uuid not null,
  household_id           uuid not null,
  ingredient_id          uuid references public.ingredients (id) on delete set null,
  product_pack_id        uuid references public.product_packs (id) on delete set null,
  display_name           text not null check (char_length(btrim(display_name)) between 1 and 200),
  -- required quantity (CONTRACT Requirement.quantity, flattened)
  quantity_kind          public.quantity_kind not null,
  quantity_value         numeric(12,3),
  quantity_min           numeric(12,3),
  quantity_max           numeric(12,3),
  unit                   public.unit,
  approx_label           text,
  original_text          text not null default '',
  unresolved             jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved) = 'array'), -- Quantity[] not safely combinable
  category               text check (category is null or char_length(category) <= 60),
  aisle                  text check (aisle is null or char_length(aisle) <= 60),
  notes                  text check (notes is null or char_length(notes) <= 500),
  is_manual              boolean not null default false,
  status                 public.shopping_item_status not null default 'active',
  estimated_price_pence  integer check (estimated_price_pence is null or estimated_price_pence >= 0),
  estimated_price_kind   public.price_kind,
  position               integer not null default 0,
  created_by             uuid references auth.users (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, household_id),
  foreign key (shopping_list_id, household_id) references public.shopping_lists (id, household_id) on delete cascade,
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit)),
  check ((estimated_price_pence is null) = (estimated_price_kind is null))
);
create index shopping_list_items_list_idx on public.shopping_list_items (shopping_list_id, status, aisle, position);
create index shopping_list_items_household_idx on public.shopping_list_items (household_id);
create index shopping_list_items_ingredient_idx on public.shopping_list_items (ingredient_id);
create trigger shopping_list_items_set_updated_at before update on public.shopping_list_items
  for each row execute function public.set_updated_at();

-- Review: provenance (CONTRACT Contribution). Recipe/meal/line refs are nullable + ON DELETE SET NULL so
-- editing a recipe never destroys list history; *_snapshot columns keep it human-readable.
create table public.shopping_list_item_sources (
  id                     uuid primary key default gen_random_uuid(),
  shopping_list_item_id  uuid not null,
  household_id           uuid not null,
  planned_meal_id        uuid,
  recipe_id              uuid,
  recipe_ingredient_id   uuid,
  recipe_title_snapshot  text,
  ingredient_text_snapshot text,
  quantity_kind          public.quantity_kind not null,
  quantity_value         numeric(12,3),
  quantity_min           numeric(12,3),
  quantity_max           numeric(12,3),
  unit                   public.unit,
  approx_label           text,
  original_text          text not null default '',
  created_at             timestamptz not null default now(),
  foreign key (shopping_list_item_id, household_id) references public.shopping_list_items (id, household_id) on delete cascade,
  foreign key (planned_meal_id, household_id) references public.planned_meals (id, household_id) on delete set null (planned_meal_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete set null (recipe_id),
  foreign key (recipe_ingredient_id, household_id) references public.recipe_ingredients (id, household_id) on delete set null (recipe_ingredient_id),
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit))
);
create index shopping_list_item_sources_item_idx on public.shopping_list_item_sources (shopping_list_item_id);
create index shopping_list_item_sources_household_idx on public.shopping_list_item_sources (household_id);
create index shopping_list_item_sources_meal_idx on public.shopping_list_item_sources (planned_meal_id);
create index shopping_list_item_sources_recipe_idx on public.shopping_list_item_sources (recipe_id);
create index shopping_list_item_sources_line_idx on public.shopping_list_item_sources (recipe_ingredient_id);

-- Review: append-only purchases (replaces mutable purchased_quantity → no lost updates between two shoppers).
-- id is generated on the client; replays use INSERT ... ON CONFLICT (id) DO NOTHING.
-- The only permitted UPDATE is a one-time void (voided_by/voided_at from NULL to set). DELETE is blocked.
create table public.purchase_events (
  id                     uuid primary key default gen_random_uuid(),
  shopping_list_item_id  uuid not null,
  household_id           uuid not null references public.households (id) on delete cascade,
  quantity_kind          public.quantity_kind not null check (quantity_kind in ('exact', 'approximate', 'unparsed')),
  quantity_value         numeric(12,3),
  quantity_min           numeric(12,3),
  quantity_max           numeric(12,3),
  unit                   public.unit,
  approx_label           text,
  original_text          text not null default '',
  actual_price_pence     integer check (actual_price_pence is null or actual_price_pence >= 0),
  receipt_line_id        uuid, -- FK added in 0007
  created_by             uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  voided_by              uuid references auth.users (id) on delete restrict,
  voided_at              timestamptz,
  foreign key (shopping_list_item_id, household_id) references public.shopping_list_items (id, household_id), -- NO ACTION: lists with purchases are archived, not deleted
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit)),
  check ((voided_by is null) = (voided_at is null))
);
create index purchase_events_item_idx on public.purchase_events (shopping_list_item_id) where voided_at is null;
create index purchase_events_household_idx on public.purchase_events (household_id, created_at desc);

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
  -- UPDATE: only a single void transition is allowed
  if old.voided_at is not null
     or new.voided_at is null
     or (to_jsonb(new) - 'voided_by' - 'voided_at') <> (to_jsonb(old) - 'voided_by' - 'voided_at') then
    raise exception 'purchase_events are append-only; only a one-time void is permitted' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger purchase_events_append_only before update or delete on public.purchase_events
  for each row execute function public.purchase_events_append_only();

-- Derived progress per item. Sums only events in the SAME unit as the requirement (cross-unit / converted
-- reconciliation is the engine's job, flagged via has_unit_mismatch). security_invoker → RLS of base tables applies.
create view public.shopping_list_item_progress
with (security_invoker = true) as
select
  i.id                as shopping_list_item_id,
  i.shopping_list_id,
  i.household_id,
  i.quantity_kind,
  i.unit,
  case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end as required_quantity,
  coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0)
                      as purchased_quantity,
  case
    when i.quantity_kind in ('exact', 'range', 'approximate')
     and (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end) is not null
    then greatest(
           (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end)
           - coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0),
           0)
  end                 as outstanding_quantity,
  count(e.id)         as purchase_event_count,
  coalesce(sum(e.actual_price_pence), 0)::bigint as actual_spend_pence,
  bool_or(e.unit is distinct from i.unit or e.quantity_value is null) as has_unit_mismatch,
  case
    when count(e.id) = 0 then 'outstanding'
    when i.quantity_kind in ('to_taste', 'unparsed')
      or (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end) is null then 'purchased'
    when coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0)
         >= (case when i.quantity_kind = 'range' then i.quantity_min else i.quantity_value end) then 'purchased'
    else 'partial'
  end                 as purchase_status,
  max(e.created_at)   as last_purchased_at
from public.shopping_list_items i
left join public.purchase_events e
  on e.shopping_list_item_id = i.id and e.voided_at is null
group by i.id;
