-- PRJ-018 schema v1 — 0007 receipts & pantry: receipts, receipt_lines, pantry_items,
-- plus deferred FKs from purchase_events / ingredient_prices to receipt_lines.

create table public.receipts (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  image_paths        text[] not null default '{}',
  retailer           text check (retailer is null or char_length(retailer) <= 80),
  purchased_on       date,
  total_pence        integer check (total_pence is null or total_pence >= 0),
  currency           char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  status             public.receipt_status not null default 'uploaded',
  parsed_raw         jsonb check (parsed_raw is null or jsonb_typeof(parsed_raw) = 'object'), -- validated AI output
  reconciled_at      timestamptz,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, household_id),
  check ((status = 'reconciled') = (reconciled_at is not null))
);
create index receipts_household_idx on public.receipts (household_id, purchased_on desc nulls last);
create trigger receipts_set_updated_at before update on public.receipts
  for each row execute function public.set_updated_at();

-- image_paths must all live under the household's storage folder.
create or replace function public.receipts_check_paths()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.image_paths) p where p not like new.household_id::text || '/%') then
    raise exception 'receipt image paths must be under %/', new.household_id using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger receipts_check_paths before insert or update of image_paths, household_id on public.receipts
  for each row execute function public.receipts_check_paths();

create table public.receipt_lines (
  id                             uuid primary key default gen_random_uuid(),
  receipt_id                     uuid not null,
  household_id                   uuid not null,
  line_no                        integer not null check (line_no >= 1),
  description                    text not null check (char_length(description) between 1 and 300),
  quantity_kind                  public.quantity_kind not null default 'unparsed',
  quantity_value                 numeric(12,3),
  quantity_min                   numeric(12,3),
  quantity_max                   numeric(12,3),
  unit                           public.unit,
  approx_label                   text,
  original_text                  text not null default '',
  unit_price_pence               integer check (unit_price_pence is null or unit_price_pence >= 0),
  line_total_pence               integer, -- may be negative (discount / multibuy saving lines)
  match_status                   public.receipt_line_match_status not null default 'unmatched',
  matched_shopping_list_item_id  uuid,
  match_score                    numeric(4,3) check (match_score is null or match_score between 0 and 1),
  added_to_pantry                boolean not null default false,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (id, household_id),
  unique (receipt_id, line_no),
  foreign key (receipt_id, household_id) references public.receipts (id, household_id) on delete cascade,
  foreign key (matched_shopping_list_item_id, household_id)
    references public.shopping_list_items (id, household_id) on delete set null (matched_shopping_list_item_id),
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit)),
  -- uncertain text matches are only ever 'suggested'; 'confirmed' requires a user action (BRIEF §12)
  check (match_status not in ('suggested', 'confirmed') or matched_shopping_list_item_id is not null)
);
create index receipt_lines_receipt_idx on public.receipt_lines (receipt_id, line_no);
create index receipt_lines_household_idx on public.receipt_lines (household_id);
create index receipt_lines_item_idx on public.receipt_lines (matched_shopping_list_item_id);
create trigger receipt_lines_set_updated_at before update on public.receipt_lines
  for each row execute function public.set_updated_at();

alter table public.purchase_events
  add constraint purchase_events_receipt_line_fk
  foreign key (receipt_line_id, household_id) references public.receipt_lines (id, household_id);
create index purchase_events_receipt_line_idx on public.purchase_events (receipt_line_id);

alter table public.ingredient_prices
  add constraint ingredient_prices_receipt_line_fk
  foreign key (receipt_line_id, household_id) references public.receipt_lines (id, household_id) on delete cascade;
create index ingredient_prices_receipt_line_idx on public.ingredient_prices (receipt_line_id);

create table public.pantry_items (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  ingredient_id    uuid references public.ingredients (id) on delete set null,
  product_pack_id  uuid references public.product_packs (id) on delete set null,
  display_name     text not null check (char_length(btrim(display_name)) between 1 and 200),
  quantity_kind    public.quantity_kind not null,
  quantity_value   numeric(12,3),
  quantity_min     numeric(12,3),
  quantity_max     numeric(12,3),
  unit             public.unit,
  approx_label     text,
  original_text    text not null default '',
  expires_on       date,
  notes            text check (notes is null or char_length(notes) <= 500),
  source           public.pantry_source not null default 'manual',
  receipt_line_id  uuid,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (receipt_line_id, household_id) references public.receipt_lines (id, household_id) on delete set null (receipt_line_id),
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit))
);
create index pantry_items_household_idx on public.pantry_items (household_id, expires_on nulls last);
create index pantry_items_ingredient_idx on public.pantry_items (ingredient_id);
create trigger pantry_items_set_updated_at before update on public.pantry_items
  for each row execute function public.set_updated_at();
