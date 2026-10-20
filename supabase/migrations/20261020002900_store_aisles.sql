-- PRJ-018 AS1 (D290-D293): stores, their aisles and where things live in each store (shared by every household member).
-- Additive only. Plain household-scoped tables under RLS: any active member reads; any member of a writable household
-- (not pending deletion) writes. Composite foreign keys keep a placement, its aisle and its store in ONE household.
--
--   stores           {name, chain (free text), notes}
--   store_aisles     {store, label ("1", "Fruit & veg", "Frozen"), sort_order}
--   store_placements {store, target_type, target_key, aisle}   one aisle per (store, target)
--       target_type 'ingredient'  target_key = canonical ingredient id (uuid text)   most specific, wins
--                   'item'        target_key = normalised display name (free-text items)
--                   'category'    target_key = the shopping list category label       fallback
--
-- target_key is deliberately text without an FK to ingredients: it also holds free-text names and category labels,
-- and a reference ingredient that is retired later must not silently delete a household's placements.

create table public.stores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  chain        text check (chain is null or char_length(btrim(chain)) between 1 and 60),
  notes        text check (notes is null or char_length(notes) <= 500),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id)
);
create unique index stores_household_name_uq on public.stores (household_id, lower(btrim(name)));

create table public.store_aisles (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  store_id     uuid not null,
  label        text not null check (char_length(btrim(label)) between 1 and 60),
  sort_order   integer not null default 0 check (sort_order between 0 and 100000),
  created_at   timestamptz not null default now(),
  foreign key (store_id, household_id) references public.stores (id, household_id) on delete cascade,
  unique (id, store_id)
);
create index store_aisles_store_idx on public.store_aisles (store_id, sort_order);

create table public.store_placements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  store_id     uuid not null,
  aisle_id     uuid not null,
  target_type  text not null check (target_type in ('ingredient', 'item', 'category')),
  target_key   text not null check (char_length(target_key) between 1 and 120),
  created_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  foreign key (store_id, household_id) references public.stores (id, household_id) on delete cascade,
  foreign key (aisle_id, store_id) references public.store_aisles (id, store_id) on delete cascade,
  unique (store_id, target_type, target_key)
);
create index store_placements_store_idx on public.store_placements (store_id);

alter table public.stores enable row level security;
alter table public.store_aisles enable row level security;
alter table public.store_placements enable row level security;
revoke all on public.stores, public.store_aisles, public.store_placements from anon;
grant select, insert, update, delete on public.stores, public.store_aisles, public.store_placements to authenticated;

do $$
declare t text;
begin
  foreach t in array array['stores', 'store_aisles', 'store_placements'] loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.is_household_writable(household_id))
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;

-- One round trip for the whole book (what the shopping page caches for offline use). SECURITY INVOKER: RLS applies, and the
-- household id is also checked, so a service-role caller stays household-scoped.
create or replace function public.household_store_book(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'chain', s.chain, 'notes', s.notes)
                                         order by lower(s.name), s.id)
                          from public.stores s where s.household_id = p_household_id), '[]'::jsonb),
    'aisles', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'storeId', a.store_id, 'label', a.label, 'sortOrder', a.sort_order)
                                         order by a.store_id, a.sort_order, a.id)
                          from public.store_aisles a where a.household_id = p_household_id), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object('storeId', p.store_id, 'targetType', p.target_type,
                                                                 'targetKey', p.target_key, 'aisleId', p.aisle_id)
                                         order by p.store_id, p.target_type, p.target_key)
                          from public.store_placements p where p.household_id = p_household_id), '[]'::jsonb))
$$;
revoke all on function public.household_store_book(uuid) from public;
grant execute on function public.household_store_book(uuid) to authenticated;

-- Copy another store's aisles and placements into this one (same household, any chain). Replaces the target's aisles and
-- placements wholesale, in one transaction. Returns the number of aisles copied.
create or replace function public.copy_store_layout(p_household_id uuid, p_from_store uuid, p_to_store uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  if p_from_store = p_to_store then
    raise exception 'cannot copy a store onto itself' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.stores where id = p_from_store and household_id = p_household_id)
     or not exists (select 1 from public.stores where id = p_to_store and household_id = p_household_id) then
    raise exception 'store_not_found' using errcode = 'no_data_found';
  end if;
  delete from public.store_aisles where store_id = p_to_store and household_id = p_household_id; -- placements cascade
  with m as materialized (
    select a.id as old_id, gen_random_uuid() as new_id, a.label, a.sort_order
      from public.store_aisles a where a.store_id = p_from_store and a.household_id = p_household_id),
  ins as (
    insert into public.store_aisles (id, household_id, store_id, label, sort_order)
      select m.new_id, p_household_id, p_to_store, m.label, m.sort_order from m returning 1),
  insp as (
    insert into public.store_placements (household_id, store_id, aisle_id, target_type, target_key, created_by)
      select p_household_id, p_to_store, m.new_id, p.target_type, p.target_key, auth.uid()
        from public.store_placements p join m on m.old_id = p.aisle_id
       where p.store_id = p_from_store and p.household_id = p_household_id returning 1)
  -- data-modifying CTEs always run to completion, so `insp` executes even though only `ins` is counted
  select count(*) into n from ins;
  return n;
end
$$;
revoke all on function public.copy_store_layout(uuid, uuid, uuid) from public;
grant execute on function public.copy_store_layout(uuid, uuid, uuid) to authenticated;
