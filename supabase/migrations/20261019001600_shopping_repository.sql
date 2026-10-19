-- PRJ-018 S2 (D120-D122): Supabase shopping repository.
--   * shopping_list_items carries the @fr/engine item state (merge key, plan requirement, manual quantity, plan link,
--     soft-removal reason) so a snapshot rebuilds the engine ShoppingState exactly; the flattened quantity columns hold
--     the engine's derived TOTAL required quantity so record_purchase()'s SQL outstanding agrees with the engine.
--   * Shopping quantities widen to numeric(18,6): the engine rounds to 6 dp (round6), so values round-trip exactly
--     (numeric(12,3) left visible residuals such as "0.0003 g left").
--   * shopping_command_log.list_seq: a per-list, gap-free sequence assigned in COMMIT order (a counter row locked until
--     commit). The global identity `seq` can commit out of order and is not contiguous per list, so it cannot be an
--     engine cursor. Clients (web + Realtime) use list_seq; `seq` stays for existing readers.
--   * apply_shopping_command(): engine-decided commands (add/edit/remove/regenerate and engine REJECTIONS of
--     tick/purchase/undo) persisted atomically under the list lock with an optimistic head check.
--   * shopping_list_snapshot(): one consistent read (one statement = one MVCC snapshot) of items, events and the log.
--   * ensure_shopping_list(): the household's single active list, created race-free.

-- ---------------------------------------------------------------------------
-- engine item state
-- ---------------------------------------------------------------------------
alter table public.shopping_list_items
  add column item_key        text check (item_key is null or char_length(item_key) <= 300),
  add column ingredient_ref  text check (ingredient_ref is null or char_length(ingredient_ref) <= 64), -- engine/refdata id even when not in public.ingredients
  add column requirement     jsonb check (requirement is null or jsonb_typeof(requirement) = 'object'),
  add column manual_quantity jsonb check (manual_quantity is null or jsonb_typeof(manual_quantity) = 'object'),
  add column plan_linked     boolean not null default false,
  add column removed_reason  text check (removed_reason is null or removed_reason in ('user', 'plan')),
  add column removed_by      uuid references auth.users (id) on delete set null,
  add column removed_at      timestamptz,
  add constraint shopping_list_items_removed_chk check (removed_at is null or status = 'removed');

-- ---------------------------------------------------------------------------
-- 6 dp quantities (view depends on the columns: drop, alter, recreate identically)
-- ---------------------------------------------------------------------------
drop view public.shopping_list_item_progress;
alter table public.shopping_list_items
  alter column quantity_value type numeric(18,6),
  alter column quantity_min   type numeric(18,6),
  alter column quantity_max   type numeric(18,6);
alter table public.purchase_events
  alter column quantity_value type numeric(18,6),
  alter column quantity_min   type numeric(18,6),
  alter column quantity_max   type numeric(18,6);

create view public.shopping_list_item_progress
with (security_invoker = true) as
select
  i.id                as shopping_list_item_id,
  i.shopping_list_id,
  i.household_id,
  i.quantity_kind,
  i.unit,
  case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end as required_quantity,
  coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0)
                      as purchased_quantity,
  case
    when i.quantity_kind in ('exact', 'range', 'approximate')
     and (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end) is not null
    then greatest(
           (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end)
           - coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0),
           0)
  end                 as outstanding_quantity,
  count(e.id)         as purchase_event_count,
  coalesce(sum(e.actual_price_pence), 0)::bigint as actual_spend_pence,
  bool_or(e.unit is distinct from i.unit or e.quantity_value is null) as has_unit_mismatch,
  case
    when count(e.id) = 0 then 'outstanding'
    when i.quantity_kind in ('to_taste', 'unparsed')
      or (case when i.quantity_kind = 'range' then i.quantity_max else i.quantity_value end) is null then 'purchased'
    when coalesce(sum(e.quantity_value) filter (where e.unit is not distinct from i.unit and e.quantity_value is not null), 0)
         >= (case when i.quantity_kind = 'range' then i.quantity_min else i.quantity_value end) then 'purchased'
    else 'partial'
  end                 as purchase_status,
  max(e.created_at)   as last_purchased_at
from public.shopping_list_items i
left join public.purchase_events e
  on e.shopping_list_item_id = i.id and e.voided_at is null
group by i.id;
revoke all on public.shopping_list_item_progress from anon;
grant select on public.shopping_list_item_progress to authenticated;

-- ---------------------------------------------------------------------------
-- per-list, commit-ordered log sequence
-- ---------------------------------------------------------------------------
create table public.shopping_list_log_heads (
  shopping_list_id  uuid primary key,
  household_id      uuid not null,
  head              bigint not null check (head >= 0),
  foreign key (shopping_list_id, household_id) references public.shopping_lists (id, household_id) on delete cascade
);
create index shopping_list_log_heads_household_idx on public.shopping_list_log_heads (household_id);
alter table public.shopping_list_log_heads enable row level security;
create policy shopping_list_log_heads_member_select on public.shopping_list_log_heads for select to authenticated
  using (public.is_household_member(household_id));
revoke all on public.shopping_list_log_heads from anon, authenticated;
grant select on public.shopping_list_log_heads to authenticated;

alter table public.shopping_command_log add column list_seq bigint;

-- Backfill existing rows (seq order per list), then seed the counters.
update public.shopping_command_log l set list_seq = o.n
  from (select seq, row_number() over (partition by shopping_list_id order by seq) as n from public.shopping_command_log) o
 where o.seq = l.seq;
insert into public.shopping_list_log_heads (shopping_list_id, household_id, head)
select shopping_list_id, household_id, max(list_seq) from public.shopping_command_log group by shopping_list_id, household_id;

-- The counter row stays locked until the inserting transaction commits, so the next appender to the same list waits:
-- list_seq order = commit order and a reader never sees k+1 without k. Taken LAST in every writer (after the list /
-- item locks) so there is no lock-order cycle with record_purchase / void_purchase / apply_shopping_command.
create or replace function public.shopping_command_log_assign_list_seq()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.shopping_list_log_heads as h (shopping_list_id, household_id, head)
  values (new.shopping_list_id, new.household_id, 1)
  on conflict (shopping_list_id) do update set head = h.head + 1
  returning h.head into new.list_seq;
  return new;
end
$$;
revoke all on function public.shopping_command_log_assign_list_seq() from public;
create trigger shopping_command_log_assign_list_seq before insert on public.shopping_command_log
  for each row execute function public.shopping_command_log_assign_list_seq();

alter table public.shopping_command_log alter column list_seq set not null;
alter table public.shopping_command_log add constraint shopping_command_log_list_seq_uq unique (shopping_list_id, list_seq);

-- ---------------------------------------------------------------------------
-- ensure_shopping_list: the household's one active list (newest wins if another writer made several)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_shopping_list(p_household_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('fr.shopping_list:' || p_household_id::text, 0));
  select id into v_id from public.shopping_lists
   where household_id = p_household_id and status = 'active'
   order by created_at desc, id desc limit 1;
  if v_id is null then
    insert into public.shopping_lists (household_id, name) values (p_household_id, 'Shopping list') returning id into v_id;
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- shopping_list_snapshot: consistent read for the engine (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.shopping_list_snapshot(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with list as (
    select id from public.shopping_lists
     where household_id = p_household_id and status = 'active'
     order by created_at desc, id desc limit 1
  )
  select jsonb_build_object(
    'listId', (select id from list),
    'head', coalesce((select h.head from public.shopping_list_log_heads h where h.shopping_list_id = (select id from list)), 0),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position, i.created_at, i.id)
                         from public.shopping_list_items i where i.shopping_list_id = (select id from list)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id)
                          from public.purchase_events e
                          join public.shopping_list_items i on i.id = e.shopping_list_item_id
                         where i.shopping_list_id = (select id from list)), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object(
                        'list_seq', l.list_seq, 'command_id', l.command_id, 'command_type', l.command_type,
                        'command', l.command, 'status', l.status, 'reason', l.reason, 'result', l.result,
                        'created_by', l.created_by, 'created_at', l.created_at) order by l.list_seq)
                       from public.shopping_command_log l where l.shopping_list_id = (select id from list)), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- apply_shopping_command: persist an engine decision (SECURITY DEFINER: the log is not writable by end users)
-- ---------------------------------------------------------------------------
-- p_items: engine items to upsert, each
--   {id, key, displayName, ingredientRef, category, aisle, notes, isManual, position, planLinked,
--    requirement, manualQuantity, removed: {reason, by, at} | null,
--    quantity: {kind, value, min, max, unit, approxLabel, originalText}}   (quantity = derived total requirement)
-- Returns p_result, a duplicate's original result (+duplicate:true), or {status:'stale', head} when p_expected_head is
-- not the list head (the caller rebuilds from a fresh snapshot and retries).
create or replace function public.apply_shopping_command(
  p_list_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_command jsonb,
  p_result jsonb,
  p_items jsonb default '[]'::jsonb,
  p_expected_head bigint default 0
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_list public.shopping_lists%rowtype;
  v_prior public.shopping_command_log%rowtype;
  v_head bigint;
  v_status text := p_result ->> 'status';
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v jsonb;
  q jsonb;
begin
  if p_command_type not in ('tick', 'purchase', 'void', 'add', 'edit', 'remove', 'regenerate') then
    raise exception 'unknown command type %', p_command_type using errcode = 'invalid_parameter_value';
  end if;
  if v_status is null or v_status not in ('applied', 'rejected')
     or jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(v_items) <> 'array' then
    raise exception 'malformed command' using errcode = 'invalid_parameter_value';
  end if;
  if v_status = 'rejected' and ((p_result ->> 'reason') is null or jsonb_array_length(v_items) > 0) then
    raise exception 'a rejection carries a reason and no item writes' using errcode = 'invalid_parameter_value';
  end if;
  -- Purchases and voids are only ever APPLIED by record_purchase / void_purchase (lock-time outstanding check).
  if p_command_type in ('tick', 'purchase', 'void') and v_status <> 'rejected' then
    raise exception 'purchases are recorded through record_purchase / void_purchase' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_list from public.shopping_lists where id = p_list_id;
  if not found or v_uid is null or not public.is_household_member(v_list.household_id) then
    raise exception 'list_not_found' using errcode = 'no_data_found';
  end if;
  if not public.is_household_writable(v_list.household_id) then
    raise exception 'household is pending deletion and read-only' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.shopping_lists where id = p_list_id for update;

  select * into v_prior from public.shopping_command_log where command_id = p_command_id;
  if found then
    if v_prior.household_id <> v_list.household_id then
      raise exception 'command_id reused' using errcode = 'unique_violation';
    end if;
    return v_prior.result || jsonb_build_object('duplicate', true);
  end if;

  select h.head into v_head from public.shopping_list_log_heads h where h.shopping_list_id = p_list_id;
  if coalesce(v_head, 0) is distinct from coalesce(p_expected_head, 0) then
    return jsonb_build_object('status', 'stale', 'head', coalesce(v_head, 0));
  end if;

  for v in select * from jsonb_array_elements(v_items) loop
    q := coalesce(v -> 'quantity', jsonb_build_object('kind', 'unparsed', 'originalText', ''));
    insert into public.shopping_list_items as i (
      id, shopping_list_id, household_id, ingredient_id, ingredient_ref, display_name,
      quantity_kind, quantity_value, quantity_min, quantity_max, unit, approx_label, original_text,
      category, aisle, notes, is_manual, status, position,
      item_key, requirement, manual_quantity, plan_linked, removed_reason, removed_by, removed_at, created_by)
    values (
      (v ->> 'id')::uuid, p_list_id, v_list.household_id,
      (select g.id from public.ingredients g where g.id = public.try_uuid(v ->> 'ingredientRef')),
      nullif(v ->> 'ingredientRef', ''),
      v ->> 'displayName',
      (q ->> 'kind')::public.quantity_kind, (q ->> 'value')::numeric, (q ->> 'min')::numeric, (q ->> 'max')::numeric,
      (q ->> 'unit')::public.unit, q ->> 'approxLabel', coalesce(q ->> 'originalText', ''),
      left(v ->> 'category', 60), left(v ->> 'aisle', 60), v ->> 'notes',
      coalesce((v ->> 'isManual')::boolean, false),
      (case when jsonb_typeof(v -> 'removed') = 'object' then 'removed' else 'active' end)::public.shopping_item_status,
      coalesce((v ->> 'position')::integer, 0),
      v ->> 'key', case when jsonb_typeof(v -> 'requirement') = 'object' then v -> 'requirement' end,
      case when jsonb_typeof(v -> 'manualQuantity') = 'object' then v -> 'manualQuantity' end,
      coalesce((v ->> 'planLinked')::boolean, false),
      v -> 'removed' ->> 'reason',
      (select u.id from auth.users u where u.id = public.try_uuid(v -> 'removed' ->> 'by')),
      (v -> 'removed' ->> 'at')::timestamptz,
      v_uid)
    on conflict (id) do update set
      ingredient_id = excluded.ingredient_id, ingredient_ref = excluded.ingredient_ref,
      display_name = excluded.display_name,
      quantity_kind = excluded.quantity_kind, quantity_value = excluded.quantity_value,
      quantity_min = excluded.quantity_min, quantity_max = excluded.quantity_max, unit = excluded.unit,
      approx_label = excluded.approx_label, original_text = excluded.original_text,
      category = excluded.category, aisle = excluded.aisle, notes = excluded.notes, is_manual = excluded.is_manual,
      status = excluded.status, item_key = excluded.item_key, requirement = excluded.requirement,
      manual_quantity = excluded.manual_quantity, plan_linked = excluded.plan_linked,
      removed_reason = excluded.removed_reason, removed_by = excluded.removed_by, removed_at = excluded.removed_at
      -- position and created_by are kept: insertion order is part of the engine state
    where i.shopping_list_id = p_list_id and i.household_id = v_list.household_id;
    if not found then
      raise exception 'item % belongs to another list', v ->> 'id' using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  insert into public.shopping_command_log (command_id, household_id, shopping_list_id, command_type, command,
                                           status, reason, result, created_by)
  values (p_command_id, v_list.household_id, p_list_id, p_command_type, p_command,
          v_status, left(p_result ->> 'reason', 60), p_result, v_uid);
  return p_result;
end
$$;

revoke all on function public.ensure_shopping_list(uuid) from public;
revoke all on function public.shopping_list_snapshot(uuid) from public;
revoke all on function public.apply_shopping_command(uuid, uuid, text, jsonb, jsonb, jsonb, bigint) from public;
grant execute on function public.ensure_shopping_list(uuid) to authenticated;
grant execute on function public.shopping_list_snapshot(uuid) to authenticated;
grant execute on function public.apply_shopping_command(uuid, uuid, text, jsonb, jsonb, jsonb, bigint) to authenticated;
