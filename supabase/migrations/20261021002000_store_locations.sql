-- PRJ-018 P2-A (D390-D399): where a household's stores are. Additive only.
--
--   store_locations   at most ONE row per store: a point (lat/lng), the arrival radius in metres, and how it was set
--                     ('device' = "use my current location while I am in the shop", 'postcode' = looked up on postcodes.io).
--
-- This is the location the member SAVED for a shop, nothing more. A live position is compared on the device (browser or
-- phone) against these rows and is never sent to the server, never logged and never stored: there is deliberately no
-- table, column or function in the schema that could hold one. Rows follow the store: deleting the store deletes its
-- location (cascade), and a member can clear a location any time (delete). RLS is the same as the rest of the store book:
-- any active member reads, any member of a writable household (not pending deletion) writes.
create table public.store_locations (
  store_id     uuid primary key,
  household_id uuid not null,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  radius_m     integer not null default 150 check (radius_m between 50 and 1000),
  source       text not null check (source in ('device', 'postcode')),
  postcode     text check (postcode is null or char_length(postcode) between 5 and 8),
  created_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  foreign key (store_id, household_id) references public.stores (id, household_id) on delete cascade,
  check ((source = 'postcode') = (postcode is not null))
);
create index store_locations_household_idx on public.store_locations (household_id);

alter table public.store_locations enable row level security;
revoke all on public.store_locations from anon;
grant select, insert, update, delete on public.store_locations to authenticated;

create policy store_locations_select on public.store_locations for select to authenticated
  using (public.is_household_member(household_id));
create policy store_locations_insert on public.store_locations for insert to authenticated
  with check (public.is_household_writable(household_id));
create policy store_locations_update on public.store_locations for update to authenticated
  using (public.is_household_writable(household_id))
  with check (public.is_household_writable(household_id));
create policy store_locations_delete on public.store_locations for delete to authenticated
  using (public.is_household_writable(household_id));
