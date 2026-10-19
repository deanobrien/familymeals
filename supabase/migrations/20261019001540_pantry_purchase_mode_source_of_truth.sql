-- One source of truth for "what happens to the pantry when something is bought" (DECISIONS D108).
--
--   pantry_settings.purchase_mode  ('off' | 'suggest' | 'auto')   <- the setting; the app reads and writes only this
--   households.pantry_deduct_on_purchase (boolean)                 <- legacy column kept for the @fr/domain Household
--                                                                     contract; now a DERIVED MIRROR: true iff mode = 'auto'
--
-- The mirror cannot drift: an AFTER trigger on pantry_settings recomputes it, and a BEFORE trigger on households
-- pins it to the derived value, so a direct write to the legacy column is ignored.
-- Existing households with the legacy flag set and no pantry_settings row are backfilled to 'auto'
-- (the flag meant "deduct on purchase", which is what 'auto' does).

create or replace function public.backfill_pantry_purchase_mode() returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ins as (
    insert into public.pantry_settings (household_id, purchase_mode)
    select h.id, 'auto'
      from public.households h
     where h.pantry_deduct_on_purchase
       and not exists (select 1 from public.pantry_settings s where s.household_id = h.id)
    on conflict (household_id) do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.backfill_pantry_purchase_mode() from public, anon, authenticated;

select public.backfill_pantry_purchase_mode();

create or replace function public.mirror_pantry_deduct_on_purchase() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update public.households set pantry_deduct_on_purchase = false
     where id = old.household_id and pantry_deduct_on_purchase;
    return old;
  end if;
  update public.households set pantry_deduct_on_purchase = (new.purchase_mode = 'auto')
   where id = new.household_id and pantry_deduct_on_purchase is distinct from (new.purchase_mode = 'auto');
  return new;
end $$;
revoke all on function public.mirror_pantry_deduct_on_purchase() from public, anon, authenticated;

create trigger pantry_settings_mirror_deduct
  after insert or update of purchase_mode or delete on public.pantry_settings
  for each row execute function public.mirror_pantry_deduct_on_purchase();

create or replace function public.pin_household_pantry_deduct() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.pantry_deduct_on_purchase := coalesce(
    (select s.purchase_mode = 'auto' from public.pantry_settings s where s.household_id = new.id), false);
  return new;
end $$;
revoke all on function public.pin_household_pantry_deduct() from public, anon, authenticated;

create trigger households_pin_pantry_deduct
  before insert or update on public.households
  for each row execute function public.pin_household_pantry_deduct();

comment on column public.households.pantry_deduct_on_purchase is
  'DERIVED MIRROR of pantry_settings.purchase_mode = ''auto''. Do not write; set pantry_settings.purchase_mode instead.';
