# SQL notes — concurrency-safe shopping writes (for L1 schema)

Mirrors `src/sync.ts` (`serverSubmit`): one ordered, per-list command log; idempotent on the
client-generated id; tick decided under a row lock so two shoppers can never double-buy.
Postgres/Supabase. Names are suggestions; align with L1's final schema.

```sql
-- Append-only purchases (never UPDATE quantity, never DELETE).
create table purchase_event (
  id                     uuid primary key,             -- client-generated (idempotency key)
  household_id           uuid not null references household(id),
  shopping_list_item_id  uuid not null references shopping_list_item(id),
  quantity_kind          quantity_kind not null,
  quantity_value         numeric, quantity_min numeric, quantity_max numeric,
  unit                   text, original_text text not null,
  actual_price_pence     integer check (actual_price_pence >= 0),
  receipt_line_id        uuid references receipt_line(id),
  created_by             uuid not null, created_at timestamptz not null default now(),
  voided_by              uuid, voided_at timestamptz           -- only column ever updated (null -> value once)
);
create index on purchase_event (shopping_list_item_id) where voided_by is null;

-- Ordered command log = realtime feed + reconnect cursor. Rejections are logged too (replay determinism).
create table shopping_command_log (
  seq            bigint generated always as identity primary key,
  list_id        uuid not null references shopping_list(id),
  command_id     uuid not null unique,                   -- dedupe across retries
  command_type   text not null,
  payload        jsonb not null,
  status         text not null check (status in ('applied','rejected')),
  reason         text,
  actor          uuid not null,
  created_at     timestamptz not null default now()
);
create index on shopping_command_log (list_id, seq);
```

## `record_purchase` (tick or explicit purchase)

```sql
create or replace function record_purchase(
  p_event_id uuid, p_item_id uuid, p_mode text,          -- 'tick' | 'purchase'
  p_qty jsonb default null, p_price integer default null, p_receipt_line uuid default null)
returns jsonb language plpgsql security invoker as $$
declare
  v_item     shopping_list_item%rowtype;
  v_prior    shopping_command_log%rowtype;
  v_out      numeric;                                    -- outstanding in the item's base unit
  v_result   jsonb;
begin
  -- 1. Idempotency: same id seen before -> return original outcome, no write.
  select * into v_prior from shopping_command_log where command_id = p_event_id;
  if found then
    return jsonb_build_object('status', v_prior.status, 'reason', v_prior.reason, 'duplicate', true);
  end if;

  -- 2. Serialise all purchases for this item (RLS still applies: invoker rights).
  select * into v_item from shopping_list_item where id = p_item_id for update;
  if not found then raise exception 'item_not_found'; end if;

  if v_item.removed_at is not null then
    v_result := jsonb_build_object('status','rejected','reason','item_removed');
  else
    -- 3. Outstanding = required - sum(active purchases), converted to base unit.
    --    Conversion lives in a SQL helper (or the edge function computes it with @fr/engine and
    --    passes p_expected_outstanding, re-checked here under the lock).
    v_out := shopping_item_outstanding(p_item_id);
    if p_mode = 'tick' and v_out <= 0 then
      v_result := jsonb_build_object('status','rejected','reason','already_complete',
        'completedBy', (select jsonb_agg(distinct created_by) from purchase_event
                        where shopping_list_item_id = p_item_id and voided_by is null));
    else
      insert into purchase_event (id, household_id, shopping_list_item_id, quantity_kind, quantity_value,
                                  unit, original_text, actual_price_pence, receipt_line_id, created_by)
      values (p_event_id, v_item.household_id, p_item_id, 'exact',
              case when p_mode = 'tick' then v_out else (p_qty->>'value')::numeric end,
              case when p_mode = 'tick' then shopping_item_base_unit(p_item_id) else p_qty->>'unit' end,
              coalesce(p_qty->>'originalText', 'tick'), p_price, p_receipt_line, auth.uid())
      on conflict (id) do nothing;                       -- belt and braces vs. a racing retry
      v_result := jsonb_build_object('status','applied','eventId',p_event_id);
    end if;
  end if;

  -- 4. Log (rejections included). Unique(command_id) makes a racing duplicate fail -> caller re-reads.
  insert into shopping_command_log (list_id, command_id, command_type, payload, status, reason, actor)
  values (v_item.list_id, p_event_id, p_mode,
          jsonb_build_object('itemId',p_item_id,'quantity',p_qty,'price',p_price,'receiptLineId',p_receipt_line),
          v_result->>'status', v_result->>'reason', auth.uid())
  on conflict (command_id) do nothing;
  return v_result;
end $$;
```

## `void_purchase` (undo)

```sql
-- p_void_id is the client-generated undo id (logged as command_id).
update purchase_event set voided_by = auth.uid(), voided_at = now()
 where id = p_event_id and voided_by is null;          -- 0 rows => 'already_voided' / 'event_not_found'
```
Same pattern: check log for `p_void_id`, lock the event's item row, update, log.

## Notes
- **Ordering**: take the item row lock *before* inserting into the log so `seq` order matches the
  order decisions were made. Commands touching many items (`regenerate`) lock the list row
  (`select ... from shopping_list where id = $1 for update`); per-item commands also take a
  `for share` lock on the list row so regenerate and ticks serialise against each other.
- **Read-committed is enough** with the explicit row locks; no SERIALIZABLE retries needed.
- **Realtime**: clients subscribe to `shopping_command_log` inserts for their list; on reconnect
  call `select * from shopping_command_log where list_id = $1 and seq > $cursor order by seq`.
  If the client cursor is older than log retention, return a snapshot (items + events + `max(seq)`)
  instead — mirrors `clientResync`.
- **RLS**: all tables scoped by `household_id`; functions are `security invoker`.
- **Never delete** `purchase_event` rows; item removal is `removed_at`/`removed_reason` (soft).
- pgTAP: concurrent tick test = two sessions call `record_purchase(..., 'tick')` on the same item;
  assert exactly one `applied`, one `already_complete`, sum(active qty) = required.
