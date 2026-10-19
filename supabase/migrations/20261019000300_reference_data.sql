-- PRJ-018 schema v1 — 0003 reference data (shared, read-only to authenticated; written by service role / L5 importer):
-- ingredients, ingredient_aliases, ingredient_densities, ingredient_unit_weights, ingredient_nutrients (CoFID/USDA),
-- plus "shared-or-own" tables product_packs and ingredient_prices (household_id NULL = reference row).

create table public.ingredients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category    text not null check (char_length(category) between 1 and 60),
  form        public.ingredient_form,          -- fresh vs ground coriander stay separate rows
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index ingredients_name_form_uq on public.ingredients (lower(name), form) nulls not distinct;
create index ingredients_name_trgm_idx on public.ingredients using gin (name extensions.gin_trgm_ops);
create trigger ingredients_set_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();

create table public.ingredient_aliases (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  alias         text not null check (char_length(btrim(alias)) between 1 and 120),
  locale        text not null default 'en-GB',
  created_at    timestamptz not null default now()
);
create unique index ingredient_aliases_uq on public.ingredient_aliases (lower(alias), locale);
create index ingredient_aliases_ingredient_idx on public.ingredient_aliases (ingredient_id);
create index ingredient_aliases_trgm_idx on public.ingredient_aliases using gin (alias extensions.gin_trgm_ops);

-- Review #3: volume<->mass needs density; engine refuses conversion without a row here.
create table public.ingredient_densities (
  id              uuid primary key default gen_random_uuid(),
  ingredient_id   uuid not null references public.ingredients (id) on delete cascade,
  g_per_ml        numeric(8,4) not null check (g_per_ml > 0 and g_per_ml < 25),
  source          text not null check (char_length(source) between 1 and 200),
  created_at      timestamptz not null default now(),
  unique (ingredient_id)
);

-- Review #3: count->mass (1 onion ~ 150 g) is ALWAYS an estimate.
create table public.ingredient_unit_weights (
  id              uuid primary key default gen_random_uuid(),
  ingredient_id   uuid not null references public.ingredients (id) on delete cascade,
  unit            public.unit not null default 'item' check (public.unit_dimension(unit) = 'count'),
  grams           numeric(10,3) not null check (grams > 0),
  source          text not null check (char_length(source) between 1 and 200),
  estimate        boolean not null default true check (estimate),
  created_at      timestamptz not null default now(),
  unique (ingredient_id, unit)
);

-- Per-ingredient composition per 100 g (edible portion). Review #1: CoFID primary, USDA fallback.
-- value_status distinguishes known / zero / unknown / unavailable — unknown is never stored as 0.
create table public.ingredient_nutrients (
  id              uuid primary key default gen_random_uuid(),
  ingredient_id   uuid not null references public.ingredients (id) on delete cascade,
  nutrient        public.nutrient_key not null,
  value_status    public.value_status not null,
  value_per_100g  numeric(12,4),
  unit            public.nutrient_unit not null,
  source          text not null check (char_length(source) between 1 and 60), -- e.g. 'CoFID', 'USDA-FDC'
  source_version  text,                                                         -- e.g. 'CoFID 2021'
  source_ref      text,                                                         -- food code in source
  estimate        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (ingredient_id, nutrient, source),
  check (case value_status
           when 'known' then value_per_100g is not null and value_per_100g >= 0
           when 'zero'  then value_per_100g = 0
           else value_per_100g is null end)
);
create index ingredient_nutrients_ingredient_idx on public.ingredient_nutrients (ingredient_id);

-- Ingredient -> regulated allergen group (reference; lets allergen_group exclusions match canonical ingredients).
create table public.ingredient_allergens (
  ingredient_id   uuid not null references public.ingredients (id) on delete cascade,
  allergen_group  public.allergen_group not null,
  source          text not null check (char_length(source) between 1 and 200),
  created_at      timestamptz not null default now(),
  primary key (ingredient_id, allergen_group)
);
create index ingredient_allergens_group_idx on public.ingredient_allergens (allergen_group);

alter table public.household_exclusions
  add constraint household_exclusions_ingredient_fk
  foreign key (ingredient_id) references public.ingredients (id) on delete set null;
create index household_exclusions_ingredient_idx on public.household_exclusions (ingredient_id);

-- ProductPack: purchasable pack (1 kg bag of rice). household_id NULL = shared reference pack.
create table public.product_packs (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households (id) on delete cascade,
  ingredient_id     uuid not null references public.ingredients (id) on delete restrict,
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  retailer          text check (retailer is null or char_length(retailer) between 1 and 80),
  quantity_kind     public.quantity_kind not null default 'exact' check (quantity_kind in ('exact', 'approximate')),
  quantity_value    numeric(12,3) not null,
  quantity_min      numeric(12,3),
  quantity_max      numeric(12,3),
  unit              public.unit not null,
  approx_label      text,
  original_text     text not null default '',
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit))
);
create index product_packs_ingredient_idx on public.product_packs (ingredient_id);
create index product_packs_household_idx on public.product_packs (household_id);
create trigger product_packs_set_updated_at before update on public.product_packs
  for each row execute function public.set_updated_at();

-- IngredientPrice / CONTRACT PriceObservation. Review #2: price_kind encodes the hierarchy
-- user_confirmed > receipt > retailer_verified > generic_estimate. Never "live".
-- Reference rows (household_id NULL) may only be generic_estimate or retailer_verified;
-- household rows may only be user_confirmed or receipt (users cannot forge verified/generic prices).
create table public.ingredient_prices (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households (id) on delete cascade,
  ingredient_id     uuid references public.ingredients (id) on delete cascade,
  product_pack_id   uuid references public.product_packs (id) on delete cascade,
  retailer          text check (retailer is null or char_length(retailer) between 1 and 80),
  price_pence       integer not null check (price_pence >= 0),
  currency          char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  quantity_kind     public.quantity_kind not null default 'exact' check (quantity_kind in ('exact', 'approximate')),
  quantity_value    numeric(12,3) not null,
  quantity_min      numeric(12,3),
  quantity_max      numeric(12,3),
  unit              public.unit not null,
  approx_label      text,
  original_text     text not null default '',
  kind              public.price_kind not null,
  observed_on       date not null,
  source            text not null check (char_length(source) between 1 and 200),
  receipt_line_id   uuid, -- FK added in 0007
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  check (ingredient_id is not null or product_pack_id is not null),
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit)),
  check ((household_id is null) = (kind in ('generic_estimate', 'retailer_verified'))),
  check (kind <> 'receipt' or receipt_line_id is not null)
);
create index ingredient_prices_lookup_idx on public.ingredient_prices (ingredient_id, household_id, observed_on desc);
create index ingredient_prices_pack_idx on public.ingredient_prices (product_pack_id, observed_on desc);
create index ingredient_prices_household_idx on public.ingredient_prices (household_id);
