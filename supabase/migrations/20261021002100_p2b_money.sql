-- PRJ-018 P2-B (D400-D409): price comparison per shop and budget tracking over time. Additive only.
--
--   spend_entries         spending the household records by hand (a market stall, a shop with no receipt). Receipts keep
--                         their own table; actual spend = confirmed receipts + these rows.
--   store_retailer_links  "the receipts that say TESCO EXTRA are my store Tesco": the user-confirmed link between the
--                         retailer text printed on a receipt (normalised) and one of the household's `stores`. One link
--                         per (household, retailer text); a store can have several spellings linked to it.
--   household_spend_receipts(household, from, to)
--                         reconciled receipts with their lines in one round trip (what the Spending page reads).
--
-- Prices are NOT a new table: per-shop prices are the household's own `ingredient_prices` rows (receipt / user_confirmed,
-- with `retailer`), exactly what receipt confirmation already writes (D124).
-- Plain household-scoped tables under RLS, like AS1: any active member reads; any member of a writable household (not
-- pending deletion) writes. Composite FKs keep a row and its store in ONE household.

create table public.spend_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  spent_on      date not null check (spent_on between date '2000-01-01' and date '2100-01-01'),
  amount_pence  integer not null check (amount_pence > 0 and amount_pence <= 100000000),
  store_id      uuid,
  retailer      text check (retailer is null or char_length(btrim(retailer)) between 1 and 80),
  category      text check (category is null or char_length(btrim(category)) between 1 and 60),
  note          text check (note is null or char_length(note) <= 200),
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id),
  foreign key (store_id, household_id) references public.stores (id, household_id) on delete set null (store_id)
);
create index spend_entries_household_date_idx on public.spend_entries (household_id, spent_on desc);
create trigger spend_entries_set_updated_at before update on public.spend_entries
  for each row execute function public.set_updated_at();

create table public.store_retailer_links (
  household_id  uuid not null,
  retailer_key  text not null check (char_length(retailer_key) between 1 and 80 and retailer_key = lower(retailer_key)),
  store_id      uuid not null,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  primary key (household_id, retailer_key),
  foreign key (store_id, household_id) references public.stores (id, household_id) on delete cascade
);
create index store_retailer_links_store_idx on public.store_retailer_links (store_id);

alter table public.spend_entries enable row level security;
alter table public.store_retailer_links enable row level security;
revoke all on public.spend_entries, public.store_retailer_links from anon;
grant select, insert, update, delete on public.spend_entries, public.store_retailer_links to authenticated;

do $$
declare t text;
begin
  foreach t in array array['spend_entries', 'store_retailer_links'] loop
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

-- Reconciled receipts (the confirmed ones) dated between two days, each with its lines, newest first. A receipt with no
-- printed date counts on the day it was scanned in UK time. SECURITY INVOKER: RLS applies and the household is checked.
create or replace function public.household_spend_receipts(p_household_id uuid, p_from date, p_to date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'receipt', to_jsonb(r),
           'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.receipt_lines l where l.receipt_id = r.id), '[]'::jsonb))
         order by coalesce(r.purchased_on, (r.created_at at time zone 'Europe/London')::date) desc, r.created_at desc), '[]'::jsonb)
    from public.receipts r
   where r.household_id = p_household_id
     and r.status = 'reconciled'
     and coalesce(r.purchased_on, (r.created_at at time zone 'Europe/London')::date) between p_from and p_to
$$;
revoke all on function public.household_spend_receipts(uuid, date, date) from public;
grant execute on function public.household_spend_receipts(uuid, date, date) to authenticated;
