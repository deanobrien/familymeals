-- PRJ-018 schema v1 — 0013 concurrency-safe shopping writes (adopts L17a SQL-NOTES.md).
--   shopping_command_log        ordered per-list log = realtime feed + reconnect cursor (rejections logged too)
--   shopping_item_outstanding() outstanding qty in the item's unit for same-unit / metric-compatible cases
--   record_purchase()           tick / explicit purchase: idempotent (command_id), item row lock, rejects
--                               a tick when nothing is outstanding
--   void_purchase()             undo (one-time void), idempotent
-- Clients no longer INSERT/UPDATE purchase_events directly; all purchase writes go through these RPCs so
-- every decision is serialised and logged.

create table public.shopping_command_log (
  seq               bigint generated always as identity primary key,
  command_id        uuid not null unique,                -- client-generated; = purchase event id for tick/purchase
  household_id      uuid not null references public.households (id) on delete cascade,
  shopping_list_id  uuid not null,
  command_type      text not null check (command_type in ('tick', 'purchase', 'void', 'regenerate', 'add', 'edit', 'remove')),
  command           jsonb not null check (jsonb_typeof(command) = 'object'),
  status            text not null check (status in ('applied', 'rejected')),
  reason            text check (reason is null or char_length(reason) <= 60),
  result            jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  foreign key (shopping_list_id, household_id) references public.shopping_lists (id, household_id) on delete cascade,
  check ((status = 'rejected') = (reason is not null))
);
create index shopping_command_log_list_seq_idx on public.shopping_command_log (shopping_list_id, seq);
create index shopping_command_log_household_idx on public.shopping_command_log (household_id);

alter table public.shopping_command_log enable row level security;
create policy shopping_command_log_member_select on public.shopping_command_log for select to authenticated
  using (public.is_household_member(household_id));
revoke all on public.shopping_command_log from anon, authenticated;
grant select on public.shopping_command_log to authenticated;

-- Purchases are written only via the RPCs below.
revoke insert, update on public.purchase_events from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_command_log;
  end if;
end
$$;

-- Factor to a base unit within a metric-compatible family (mass -> g, metric volume -> ml).
-- Non-metric volume (tsp/tbsp/cup/floz/pint) and count units only match themselves: their conversion
-- factors are owned by the engine (L3) and are not duplicated in SQL.
create or replace function public.metric_base_factor(u public.unit)
returns numeric
language sql immutable parallel safe
set search_path = ''
as $$
  select case u when 'mg' then 0.001 when 'g' then 1 when 'kg' then 1000
                when 'ml' then 1 when 'l' then 1000 else null end
$$;

-- Outstanding quantity in the ITEM's unit. NULL = cannot be computed in SQL (unquantified item, or an active
-- purchase in a unit that needs engine/density conversion) — the server computes it with @fr/engine and
-- record_purchase re-checks under the lock via p_expected_event_count.
create or replace function public.shopping_item_outstanding(p_item_id uuid)
returns numeric
language plpgsql stable
set search_path = ''
as $$
declare
  v_item public.shopping_list_items%rowtype;
  v_required numeric;
  v_bought numeric := 0;
  v_e record;
begin
  select * into v_item from public.shopping_list_items where id = p_item_id;
  if not found then return null; end if;
  v_required := case when v_item.quantity_kind = 'range' then v_item.quantity_max else v_item.quantity_value end;
  if v_required is null or v_item.unit is null then return null; end if;
  for v_e in
    select e.quantity_value, e.unit from public.purchase_events e
     where e.shopping_list_item_id = p_item_id and e.voided_at is null
  loop
    if v_e.quantity_value is null or v_e.unit is null then
      return null;
    elsif v_e.unit = v_item.unit then
      v_bought := v_bought + v_e.quantity_value;
    elsif public.metric_base_factor(v_e.unit) is not null and public.metric_base_factor(v_item.unit) is not null
          and public.unit_dimension(v_e.unit) = public.unit_dimension(v_item.unit) then
      v_bought := v_bought + v_e.quantity_value * public.metric_base_factor(v_e.unit) / public.metric_base_factor(v_item.unit);
    else
      return null;
    end if;
  end loop;
  return greatest(v_required - v_bought, 0);
end
$$;

-- p_qty (for 'purchase'): {"kind":"exact"|"approximate","value":n,"unit":"g","originalText":"..."}
-- p_expected_outstanding / p_expected_event_count: server-computed outstanding (engine, density-aware) and the
-- number of active events it was computed from; used only when SQL cannot compute outstanding itself.
create or replace function public.record_purchase(
  p_event_id uuid,
  p_item_id uuid,
  p_mode text,
  p_qty jsonb default null,
  p_price_pence integer default null,
  p_receipt_line_id uuid default null,
  p_expected_outstanding numeric default null,
  p_expected_event_count integer default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shopping_list_items%rowtype;
  v_prior public.shopping_command_log%rowtype;
  v_out numeric;
  v_active int;
  v_kind public.quantity_kind;
  v_value numeric;
  v_unit public.unit;
  v_text text;
  v_result jsonb;
begin
  if p_mode not in ('tick', 'purchase') then
    raise exception 'mode must be tick or purchase' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_item from public.shopping_list_items where id = p_item_id;
  if not found or v_uid is null or not public.is_household_member(v_item.household_id) then
    raise exception 'item_not_found' using errcode = 'no_data_found'; -- same error for missing and foreign
  end if;

  -- Serialise against list-wide commands (regenerate takes FOR UPDATE on the list), then lock the item.
  perform 1 from public.shopping_lists where id = v_item.shopping_list_id for share;
  select * into v_item from public.shopping_list_items where id = p_item_id for update;

  -- Idempotency (checked under the lock so a racing retry sees the first outcome).
  select * into v_prior from public.shopping_command_log where command_id = p_event_id;
  if found then
    if v_prior.household_id <> v_item.household_id then
      raise exception 'command_id reused' using errcode = 'unique_violation';
    end if;
    return v_prior.result || jsonb_build_object('duplicate', true);
  end if;

  select count(*) into v_active from public.purchase_events e
   where e.shopping_list_item_id = p_item_id and e.voided_at is null;
  v_out := public.shopping_item_outstanding(p_item_id);

  if v_item.status = 'removed' then
    v_result := jsonb_build_object('status', 'rejected', 'reason', 'item_removed');
  elsif p_mode = 'tick' then
    if v_out is null and (v_item.quantity_kind in ('to_taste', 'unparsed') or v_item.unit is null
                          or coalesce(v_item.quantity_value, v_item.quantity_max) is null) then
      -- unquantified item: a tick means "got it"; reject if someone already has
      if v_active > 0 then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'already_complete');
      else
        v_kind := 'unparsed'; v_value := null; v_unit := null; v_text := 'tick';
      end if;
    elsif v_out is null then
      if p_expected_outstanding is null or p_expected_event_count is distinct from v_active then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'needs_engine_outstanding',
                                       'activeEventCount', v_active);
      else
        v_out := p_expected_outstanding;
      end if;
    end if;
    if v_result is null and v_kind is null then
      if v_out <= 0 then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'already_complete');
      else
        v_kind := 'exact'; v_value := v_out; v_unit := v_item.unit; v_text := 'tick';
      end if;
    end if;
  else -- purchase
    begin
      v_kind  := coalesce(p_qty ->> 'kind', 'exact')::public.quantity_kind;
      v_value := (p_qty ->> 'value')::numeric;
      v_unit  := (p_qty ->> 'unit')::public.unit;
      v_text  := coalesce(p_qty ->> 'originalText', '');
    exception when others then
      v_kind := null;
    end;
    if v_kind is null or v_kind not in ('exact', 'approximate') or v_value is null or v_value <= 0 then
      v_result := jsonb_build_object('status', 'rejected', 'reason', 'invalid_quantity');
      v_kind := null;
    end if;
  end if;

  if p_price_pence is not null and p_price_pence < 0 then
    v_result := jsonb_build_object('status', 'rejected', 'reason', 'invalid_price');
  end if;

  if v_result is null then
    insert into public.purchase_events (id, shopping_list_item_id, household_id, quantity_kind, quantity_value,
                                        unit, original_text, actual_price_pence, receipt_line_id, created_by)
    values (p_event_id, p_item_id, v_item.household_id, v_kind, v_value, v_unit, v_text,
            p_price_pence, p_receipt_line_id, v_uid)
    on conflict (id) do nothing;
    v_result := jsonb_build_object('status', 'applied', 'eventId', p_event_id,
                                   'quantity', jsonb_build_object('kind', v_kind, 'value', v_value, 'unit', v_unit));
  elsif v_result ->> 'reason' = 'already_complete' then
    v_result := v_result || jsonb_build_object('completedBy',
      (select coalesce(jsonb_agg(distinct e.created_by), '[]'::jsonb) from public.purchase_events e
        where e.shopping_list_item_id = p_item_id and e.voided_at is null));
  end if;

  insert into public.shopping_command_log (command_id, household_id, shopping_list_id, command_type, command,
                                           status, reason, result, created_by)
  values (p_event_id, v_item.household_id, v_item.shopping_list_id, p_mode,
          jsonb_build_object('itemId', p_item_id, 'quantity', p_qty, 'pricePence', p_price_pence,
                             'receiptLineId', p_receipt_line_id),
          v_result ->> 'status', v_result ->> 'reason', v_result, v_uid);
  return v_result;
end
$$;

create or replace function public.void_purchase(p_void_id uuid, p_event_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.purchase_events%rowtype;
  v_list uuid;
  v_prior public.shopping_command_log%rowtype;
  v_result jsonb;
begin
  select * into v_event from public.purchase_events where id = p_event_id;
  if not found or v_uid is null or not public.is_household_member(v_event.household_id) then
    raise exception 'event_not_found' using errcode = 'no_data_found';
  end if;
  select shopping_list_id into v_list from public.shopping_list_items
   where id = v_event.shopping_list_item_id for update;

  select * into v_prior from public.shopping_command_log where command_id = p_void_id;
  if found then
    return v_prior.result || jsonb_build_object('duplicate', true);
  end if;

  update public.purchase_events set voided_by = v_uid, voided_at = now()
   where id = p_event_id and voided_at is null;
  if found then
    v_result := jsonb_build_object('status', 'applied', 'eventId', p_event_id);
  else
    v_result := jsonb_build_object('status', 'rejected', 'reason', 'already_voided', 'eventId', p_event_id);
  end if;

  insert into public.shopping_command_log (command_id, household_id, shopping_list_id, command_type, command,
                                           status, reason, result, created_by)
  values (p_void_id, v_event.household_id, v_list, 'void', jsonb_build_object('eventId', p_event_id),
          v_result ->> 'status', v_result ->> 'reason', v_result, v_uid);
  return v_result;
end
$$;

revoke all on function public.record_purchase(uuid, uuid, text, jsonb, integer, uuid, numeric, integer) from public;
revoke all on function public.void_purchase(uuid, uuid) from public;
grant execute on function public.record_purchase(uuid, uuid, text, jsonb, integer, uuid, numeric, integer) to authenticated;
grant execute on function public.void_purchase(uuid, uuid) to authenticated;
