-- PRJ-018 X2 (D187): per-household packaged-product snapshots (Open Food Facts), additive only.
-- A snapshot is OUR normalised product (name, pack size, per-100 nutrition with value status, UK-14 allergens, source
-- attribution), linked by the household to a canonical ingredient. Never a raw provider payload; no images stored.
-- Access is through SECURITY DEFINER functions only (member of an ACTIVE household to write; any member to read).

create table public.household_product_snapshots (
  household_id  uuid not null references public.households (id) on delete cascade,
  barcode       text not null check (barcode ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  ingredient_id uuid references public.ingredients (id) on delete set null,
  snapshot      jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 20000),
  retrieved_at  timestamptz not null,
  linked_by     uuid references auth.users (id) on delete set null,
  linked_at     timestamptz not null default now(),
  primary key (household_id, barcode)
);
create index household_product_snapshots_ingredient_idx
  on public.household_product_snapshots (household_id, ingredient_id) where ingredient_id is not null;

alter table public.household_product_snapshots enable row level security;
revoke all on public.household_product_snapshots from anon, authenticated;

create or replace function public.save_product_snapshot(
  p_household_id uuid, p_barcode text, p_ingredient_id uuid, p_snapshot jsonb, p_retrieved_at timestamptz)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) or not public.household_is_active(p_household_id) then
    raise exception 'only a member of an active household can save a product' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or (p_snapshot ->> 'barcode') is distinct from p_barcode then
    raise exception 'malformed product snapshot' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.household_product_snapshots as s (household_id, barcode, ingredient_id, snapshot, retrieved_at, linked_by, linked_at)
  values (p_household_id, p_barcode, p_ingredient_id, p_snapshot, p_retrieved_at, auth.uid(), now())
  on conflict (household_id, barcode) do update set
    ingredient_id = excluded.ingredient_id, snapshot = excluded.snapshot, retrieved_at = excluded.retrieved_at,
    linked_by = excluded.linked_by, linked_at = excluded.linked_at;
end
$$;

create or replace function public.household_product_snapshots(p_household_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when auth.uid() is not null and public.is_household_member(p_household_id) then (
    select coalesce(jsonb_agg(jsonb_build_object(
             'barcode', s.barcode, 'ingredient_id', s.ingredient_id, 'snapshot', s.snapshot,
             'retrieved_at', s.retrieved_at, 'linked_at', s.linked_at) order by s.linked_at desc, s.barcode), '[]'::jsonb)
      from public.household_product_snapshots s where s.household_id = p_household_id) end
$$;

create or replace function public.delete_product_snapshot(p_household_id uuid, p_barcode text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) or not public.household_is_active(p_household_id) then
    raise exception 'only a member of an active household can remove a product' using errcode = 'insufficient_privilege';
  end if;
  delete from public.household_product_snapshots where household_id = p_household_id and barcode = p_barcode;
end
$$;

revoke all on function public.save_product_snapshot(uuid, text, uuid, jsonb, timestamptz) from public;
revoke all on function public.household_product_snapshots(uuid) from public;
revoke all on function public.delete_product_snapshot(uuid, text) from public;
grant execute on function public.save_product_snapshot(uuid, text, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.household_product_snapshots(uuid) to authenticated;
grant execute on function public.delete_product_snapshot(uuid, text) to authenticated;
