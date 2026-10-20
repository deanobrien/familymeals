-- PRJ-018 PR1 (DECISIONS D280-D289): minimum pantry stock ("par levels") + restock settings.
--
-- A par level is "keep at least N of X in". It lives in its own table, NOT on pantry_items, so it survives the stock
-- hitting zero (the pantry row is deleted at ~0). Suggestions are computed on read by @fr/engine/pantry
-- (restockSuggestions); nothing here stores a suggestion. Household members read/write; the shared RLS helper
-- is_household_writable makes both tables read-only during the account-deletion grace period.

create table public.pantry_par_levels (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  -- Canonical ingredient when matched; free-text items keep only display_name (matched by normalised name).
  ingredient_id     uuid references public.ingredients (id) on delete set null,
  display_name      text not null check (char_length(btrim(display_name)) between 1 and 200),
  -- The unit the minimum is counted in; suggestions are expressed in it.
  unit              public.unit not null,
  min_value         numeric(12,3) not null check (min_value > 0 and min_value <= 1000000),
  -- Top-up target; NULL means "restock to the minimum".
  restock_to_value  numeric(12,3) check (restock_to_value is null or (restock_to_value >= min_value and restock_to_value <= 1000000)),
  -- Optional preferred pack (e.g. 400 g): both columns or neither. Suggestions round up to whole packs.
  pack_value        numeric(12,3) check (pack_value is null or (pack_value > 0 and pack_value <= 1000000)),
  pack_unit         public.unit,
  enabled           boolean not null default true,
  -- Snooze / dismiss: hidden while today is before this date.
  snoozed_until     date,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((pack_value is null) = (pack_unit is null))
);
-- One minimum per ingredient, or per (normalised) name for free-text items, per household.
create unique index pantry_par_levels_ingredient_uq on public.pantry_par_levels (household_id, ingredient_id)
  where ingredient_id is not null;
create unique index pantry_par_levels_name_uq on public.pantry_par_levels (household_id, lower(btrim(display_name)))
  where ingredient_id is null;
create trigger pantry_par_levels_set_updated_at before update on public.pantry_par_levels
  for each row execute function public.set_updated_at();

-- Household-level restock behaviour. No row = defaults (auto_add false: suggestions only).
create table public.restock_settings (
  household_id  uuid primary key references public.households (id) on delete cascade,
  auto_add      boolean not null default false,
  updated_at    timestamptz not null default now()
);
create trigger restock_settings_set_updated_at before update on public.restock_settings
  for each row execute function public.set_updated_at();

alter table public.pantry_par_levels enable row level security;
alter table public.restock_settings enable row level security;
revoke all on public.pantry_par_levels, public.restock_settings from anon;
grant select, insert, update, delete on public.pantry_par_levels, public.restock_settings to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pantry_par_levels', 'restock_settings'] loop
    execute format($f$create policy %1$s_member_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_insert on public.%1$I for insert to authenticated
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_member_update on public.%1$I for update to authenticated
                     using (public.is_household_writable(household_id))
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_member_delete on public.%1$I for delete to authenticated
                     using (public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;
