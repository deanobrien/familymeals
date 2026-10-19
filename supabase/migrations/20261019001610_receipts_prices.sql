-- PRJ-018 S2 (D123-D124): Supabase receipts repository, household price observations, pantry purchase feed.
-- All functions are SECURITY INVOKER (RLS applies, including the grace-period read-only write policies) and also
-- filter by the household id passed in, so a service-role caller stays household-scoped.

alter table public.receipts
  add column review_state jsonb check (review_state is null or jsonb_typeof(review_state) = 'object'); -- app review model (warnings, ignored lines, reconciliation decisions)
alter table public.receipt_lines
  add column parsed jsonb check (parsed is null or jsonb_typeof(parsed) = 'object'); -- full parsed line + match suggestion as reviewed

-- Idempotent price recording: one household row per (source, ingredient). Reference rows (household NULL) are untouched.
create unique index ingredient_prices_household_source_uq
  on public.ingredient_prices (household_id, source, ingredient_id) where household_id is not null;

-- ---------------------------------------------------------------------------
-- save_receipt: receipt + lines in one transaction (lines are upserted by id; never deleted: purchases reference them)
-- p_receipt: {id, retailer, purchasedOn, totalPence, status ('parsed'|'reconciled'), reconciledAt, reviewState}
-- p_lines:   [{id, lineNo, description, quantity:{kind,value,min,max,unit,approxLabel,originalText}, unitPricePence,
--             lineTotalPence, matchStatus, matchedItemId, matchScore, addedToPantry, parsed}]
-- ---------------------------------------------------------------------------
create or replace function public.save_receipt(p_household_id uuid, p_receipt jsonb, p_lines jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := (p_receipt ->> 'id')::uuid;
  v jsonb;
  q jsonb;
  v_item uuid;
  v_status public.receipt_line_match_status;
begin
  insert into public.receipts as r (id, household_id, retailer, purchased_on, total_pence, status, reconciled_at, review_state)
  values (v_id, p_household_id, left(nullif(p_receipt ->> 'retailer', ''), 80), (p_receipt ->> 'purchasedOn')::date,
          (p_receipt ->> 'totalPence')::integer, (p_receipt ->> 'status')::public.receipt_status,
          (p_receipt ->> 'reconciledAt')::timestamptz, p_receipt -> 'reviewState')
  on conflict (id) do update set
    retailer = excluded.retailer, purchased_on = excluded.purchased_on, total_pence = excluded.total_pence,
    status = excluded.status, reconciled_at = excluded.reconciled_at, review_state = excluded.review_state
  where r.household_id = p_household_id;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'no_data_found';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce(v -> 'quantity', jsonb_build_object('kind', 'unparsed', 'originalText', ''));
    -- a suggestion/confirmation may only point at one of THIS household's items; otherwise the line is unmatched
    select i.id into v_item from public.shopping_list_items i
     where i.id = public.try_uuid(v ->> 'matchedItemId') and i.household_id = p_household_id;
    v_status := coalesce(v ->> 'matchStatus', 'unmatched')::public.receipt_line_match_status;
    if v_item is null and v_status in ('suggested', 'confirmed') then v_status := 'unmatched'; end if;
    insert into public.receipt_lines as l (
      id, receipt_id, household_id, line_no, description,
      quantity_kind, quantity_value, quantity_min, quantity_max, unit, approx_label, original_text,
      unit_price_pence, line_total_pence, match_status, matched_shopping_list_item_id, match_score, added_to_pantry, parsed)
    values (
      (v ->> 'id')::uuid, v_id, p_household_id, (v ->> 'lineNo')::integer,
      left(coalesce(nullif(btrim(v ->> 'description'), ''), 'item'), 300),
      (q ->> 'kind')::public.quantity_kind, (q ->> 'value')::numeric, (q ->> 'min')::numeric, (q ->> 'max')::numeric,
      (q ->> 'unit')::public.unit, q ->> 'approxLabel', coalesce(q ->> 'originalText', ''),
      (v ->> 'unitPricePence')::integer, (v ->> 'lineTotalPence')::integer, v_status, v_item,
      least(greatest((v ->> 'matchScore')::numeric, 0), 1), coalesce((v ->> 'addedToPantry')::boolean, false),
      v -> 'parsed')
    on conflict (id) do update set
      line_no = excluded.line_no, description = excluded.description,
      match_status = excluded.match_status, matched_shopping_list_item_id = excluded.matched_shopping_list_item_id,
      match_score = excluded.match_score, added_to_pantry = excluded.added_to_pantry, parsed = excluded.parsed
    where l.receipt_id = v_id and l.household_id = p_household_id;
    if not found then
      raise exception 'receipt line % belongs to another receipt', v ->> 'id' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return v_id;
end
$$;

create or replace function public.list_receipts(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'retailer', r.retailer, 'purchased_on', r.purchased_on, 'total_pence', r.total_pence,
           'status', r.status, 'created_at', r.created_at,
           'line_count', (select count(*) from public.receipt_lines l where l.receipt_id = r.id))
         order by r.purchased_on desc nulls last, r.created_at desc), '[]'::jsonb)
    from public.receipts r where r.household_id = p_household_id
$$;

create or replace function public.get_receipt(p_household_id uuid, p_receipt_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
           'receipt', to_jsonb(r),
           'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.receipt_lines l
                               where l.receipt_id = r.id), '[]'::jsonb))
    from public.receipts r where r.id = p_receipt_id and r.household_id = p_household_id
$$;

-- ---------------------------------------------------------------------------
-- Prices. Household rows may only be user_confirmed / receipt (table CHECK); unknown ingredients are skipped (the
-- reference ingredients table is the FK target), duplicates (same source + ingredient) ignored. Returns rows inserted.
-- p_items: [{ingredientId, retailer, pricePence, quantity:{...}, kind, observedOn, source, receiptLineId}]
-- ---------------------------------------------------------------------------
create or replace function public.record_price_observations(p_household_id uuid, p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  insert into public.ingredient_prices (household_id, ingredient_id, retailer, price_pence, quantity_kind, quantity_value,
                                        quantity_min, quantity_max, unit, approx_label, original_text, kind, observed_on,
                                        source, receipt_line_id)
  select p_household_id, g.id, left(nullif(x ->> 'retailer', ''), 80), (x ->> 'pricePence')::integer,
         (x -> 'quantity' ->> 'kind')::public.quantity_kind, (x -> 'quantity' ->> 'value')::numeric,
         (x -> 'quantity' ->> 'min')::numeric, (x -> 'quantity' ->> 'max')::numeric,
         (x -> 'quantity' ->> 'unit')::public.unit, x -> 'quantity' ->> 'approxLabel',
         coalesce(x -> 'quantity' ->> 'originalText', ''),
         (x ->> 'kind')::public.price_kind, (x ->> 'observedOn')::date, left(x ->> 'source', 200),
         public.try_uuid(x ->> 'receiptLineId')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    join public.ingredients g on g.id = public.try_uuid(x ->> 'ingredientId')
   where x ->> 'kind' in ('user_confirmed', 'receipt')
  on conflict (household_id, source, ingredient_id) where household_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- The household's own observations plus shared retailer_verified reference rows. Shared generic_estimate rows are left
-- out: the app adds the refdata generic estimates itself (no double counting).
create or replace function public.household_price_observations(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.observed_on desc, p.created_at desc), '[]'::jsonb)
    from public.ingredient_prices p
   where p.ingredient_id is not null
     and ((p.household_id = p_household_id and p.kind in ('user_confirmed', 'receipt'))
          or (p.household_id is null and p.kind = 'retailer_verified'))
$$;

-- ---------------------------------------------------------------------------
-- Pantry purchase feed: every purchase event of the household with what it was for.
-- ---------------------------------------------------------------------------
create or replace function public.household_purchase_records(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'event', to_jsonb(e),
           'item', jsonb_build_object('display_name', i.display_name,
                                      'ingredient_id', coalesce(i.ingredient_ref, i.ingredient_id::text)))
         order by e.created_at, e.id), '[]'::jsonb)
    from public.purchase_events e
    join public.shopping_list_items i on i.id = e.shopping_list_item_id
   where e.household_id = p_household_id
$$;

revoke all on function public.save_receipt(uuid, jsonb, jsonb) from public;
revoke all on function public.list_receipts(uuid) from public;
revoke all on function public.get_receipt(uuid, uuid) from public;
revoke all on function public.record_price_observations(uuid, jsonb) from public;
revoke all on function public.household_price_observations(uuid) from public;
revoke all on function public.household_purchase_records(uuid) from public;
grant execute on function public.save_receipt(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.list_receipts(uuid) to authenticated;
grant execute on function public.get_receipt(uuid, uuid) to authenticated;
grant execute on function public.record_price_observations(uuid, jsonb) to authenticated;
grant execute on function public.household_price_observations(uuid) to authenticated;
grant execute on function public.household_purchase_records(uuid) to authenticated;
