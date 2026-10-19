-- S2 (D120-D126): shopping command persistence, per-list log sequence, receipts, prices, planner profile, AI settings.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol home', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'member', 'Bob');
update public.household_members set display_name = 'Alice'
 where household_id = 'aa000000-0000-4000-8000-0000000000aa' and user_id = 'a0000000-0000-4000-8000-000000000001';
insert into public.ingredients (id, name, slug, category, form) values
  ('11000000-0000-4000-8000-000000000001', 'Flour', 'flour', 'Baking', null),
  ('11000000-0000-4000-8000-000000000002', 'Peanut butter', 'peanut-butter', 'Spreads', null);
insert into public.ingredient_allergens (ingredient_id, allergen_group, source) values
  ('11000000-0000-4000-8000-000000000002', 'peanuts', 'test');

-- ===================== shopping =====================
select tests.act_as('a0000000-0000-4000-8000-000000000001');
create temp table t_list as select public.ensure_shopping_list('aa000000-0000-4000-8000-0000000000aa') as id;
select tests.ok((select public.ensure_shopping_list('aa000000-0000-4000-8000-0000000000aa')) = (select id from t_list), 'ensure_shopping_list is idempotent');
select tests.is((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 1, 'one active list');

-- an engine-decided add: item row + log row with list_seq 1
select tests.ok((public.apply_shopping_command((select id from t_list), 'c1000000-0000-4000-8000-000000000001', 'add',
  '{"type":"add_item","commandId":"c1000000-0000-4000-8000-000000000001"}'::jsonb,
  '{"commandId":"c1000000-0000-4000-8000-000000000001","type":"add_item","status":"applied","itemId":"d1000000-0000-4000-8000-000000000001"}'::jsonb,
  '[{"id":"d1000000-0000-4000-8000-000000000001","key":"ing:11000000-0000-4000-8000-000000000001","displayName":"Flour",
     "ingredientRef":"11000000-0000-4000-8000-000000000001","category":"Baking","isManual":true,"position":0,"planLinked":false,
     "manualQuantity":{"kind":"exact","value":500,"unit":"g","originalText":"500 g"},
     "quantity":{"kind":"exact","value":500.123456,"unit":"g","originalText":"500 g"}}]'::jsonb, 0) ->> 'status') = 'applied', 'add applied');
select tests.ok((select quantity_value = 500.123456 and ingredient_id = '11000000-0000-4000-8000-000000000001' and item_key like 'ing:%'
                   from public.shopping_list_items where id = 'd1000000-0000-4000-8000-000000000001'), 'item persisted with 6 dp and engine state');
select tests.is((select list_seq from public.shopping_command_log where command_id = 'c1000000-0000-4000-8000-000000000001'), 1, 'first list_seq = 1');

-- stale head: nothing written
select tests.ok((public.apply_shopping_command((select id from t_list), 'c1000000-0000-4000-8000-000000000002', 'edit',
  '{"type":"edit_item"}'::jsonb, '{"status":"applied"}'::jsonb, '[]'::jsonb, 0) ->> 'status') = 'stale', 'stale head refused');
select tests.is((select count(*) from public.shopping_command_log where command_id = 'c1000000-0000-4000-8000-000000000002'), 0, 'stale writes nothing');

-- record_purchase (Bob) interleaves: list_seq 2, contiguous per list
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok((public.record_purchase('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'tick') ->> 'status') = 'applied', 'tick applied by SQL');
select tests.ok((select quantity_value = 500.123456 from public.purchase_events where id = 'e1000000-0000-4000-8000-000000000001'), 'tick records the 6 dp outstanding');
select tests.is((select list_seq from public.shopping_command_log where command_id = 'e1000000-0000-4000-8000-000000000001'), 2, 'record_purchase gets list_seq 2');
select tests.is((select head from public.shopping_list_log_heads where shopping_list_id = (select id from t_list)), 2, 'head = 2');

-- an engine rejection of a tick is logged without touching purchases
select tests.ok((public.apply_shopping_command((select id from t_list), 'e1000000-0000-4000-8000-000000000002', 'tick',
  '{"type":"tick"}'::jsonb, '{"status":"rejected","reason":"already_complete","type":"tick"}'::jsonb, '[]'::jsonb, 2) ->> 'reason') = 'already_complete', 'engine rejection logged');
select tests.is((select count(*) from public.purchase_events where id = 'e1000000-0000-4000-8000-000000000002'), 0, 'rejection buys nothing');
-- duplicate command id: original result back, nothing appended
select tests.ok((public.apply_shopping_command((select id from t_list), 'e1000000-0000-4000-8000-000000000002', 'tick',
  '{"type":"tick"}'::jsonb, '{"status":"rejected","reason":"already_complete"}'::jsonb, '[]'::jsonb, 99) ->> 'duplicate')::boolean, 'duplicate is idempotent');
select tests.is((select head from public.shopping_list_log_heads where shopping_list_id = (select id from t_list)), 3, 'duplicate not appended');

-- an APPLIED tick/purchase/void can only come from record_purchase / void_purchase
select tests.throws($$ select public.apply_shopping_command((select id from t_list), 'e1000000-0000-4000-8000-000000000003', 'purchase',
  '{"type":"purchase"}'::jsonb, '{"status":"applied"}'::jsonb, '[]'::jsonb, 3) $$, '22023', 'applied purchase refused');
select tests.throws($$ select public.apply_shopping_command((select id from t_list), 'e1000000-0000-4000-8000-000000000004', 'edit',
  '{"type":"edit_item"}'::jsonb, '{"status":"rejected","reason":"x"}'::jsonb,
  '[{"id":"d1000000-0000-4000-8000-000000000001","displayName":"x","quantity":{"kind":"unparsed","originalText":""}}]'::jsonb, 3) $$,
  '22023', 'a rejection cannot write items');
-- end users still cannot write the log or the counter directly
select tests.throws($$ insert into public.shopping_command_log (command_id, household_id, shopping_list_id, command_type, command, status)
  values (gen_random_uuid(), 'aa000000-0000-4000-8000-0000000000aa', (select id from t_list), 'add', '{}', 'applied') $$, '42501', 'log not writable');
select tests.throws($$ update public.shopping_list_log_heads set head = 0 $$, '42501', 'counter not writable');

-- snapshot: consistent bundle for the member, nothing for another household
create temp table t_snap as select public.shopping_list_snapshot('aa000000-0000-4000-8000-0000000000aa') as s;
select tests.ok((select (s ->> 'head')::int = 3 and jsonb_array_length(s -> 'items') = 1 and jsonb_array_length(s -> 'events') = 1
                        and jsonb_array_length(s -> 'log') = 3 from t_snap), 'snapshot bundles items/events/log at head');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok((select public.shopping_list_snapshot('aa000000-0000-4000-8000-0000000000aa') ->> 'listId') is null, 'foreign snapshot is empty');
select tests.throws($$ select public.apply_shopping_command((select id from t_list), gen_random_uuid(), 'add', '{}'::jsonb,
  '{"status":"applied"}'::jsonb, '[]'::jsonb, 3) $$, 'P0002', 'foreign list refused');
-- Carol cannot move one of Alice's items into her list
create temp table t_clist as select public.ensure_shopping_list('cc000000-0000-4000-8000-0000000000cc') as id;
select tests.throws($$ select public.apply_shopping_command((select id from t_clist), gen_random_uuid(), 'edit', '{}'::jsonb,
  '{"status":"applied"}'::jsonb,
  '[{"id":"d1000000-0000-4000-8000-000000000001","displayName":"stolen","quantity":{"kind":"unparsed","originalText":""}}]'::jsonb, 0) $$,
  '22023', 'cross-household item hijack refused');
select tests.reset_actor();
select tests.ok((select display_name = 'Flour' from public.shopping_list_items where id = 'd1000000-0000-4000-8000-000000000001'), 'item untouched');

-- ===================== receipts + prices =====================
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"f1000000-0000-4000-8000-000000000001","retailer":"Shop","purchasedOn":"2026-10-18","totalPence":120,"status":"parsed","reviewState":{"warnings":[]}}'::jsonb,
  '[{"id":"f2000000-0000-4000-8000-000000000001","lineNo":1,"description":"FLOUR 1KG","quantity":{"kind":"exact","value":1,"unit":"kg","originalText":"1KG"},
     "unitPricePence":120,"lineTotalPence":120,"matchStatus":"suggested","matchedItemId":"d1000000-0000-4000-8000-000000000001","matchScore":0.9,"parsed":{"id":"x"}},
    {"id":"f2000000-0000-4000-8000-000000000002","lineNo":2,"description":"MYSTERY","matchStatus":"suggested","matchedItemId":"not-an-item"}]'::jsonb);
select tests.ok((select match_status = 'suggested' from public.receipt_lines where id = 'f2000000-0000-4000-8000-000000000001'), 'suggestion kept');
select tests.ok((select match_status = 'unmatched' and matched_shopping_list_item_id is null from public.receipt_lines where id = 'f2000000-0000-4000-8000-000000000002'), 'unknown item -> unmatched');
select tests.is((select jsonb_array_length(public.list_receipts('aa000000-0000-4000-8000-0000000000aa'))), 1, 'listed');
select tests.is((select jsonb_array_length(public.get_receipt('aa000000-0000-4000-8000-0000000000aa', 'f1000000-0000-4000-8000-000000000001') -> 'lines')), 2, 'lines read back');
-- reconcile (status + timestamp move together)
select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"f1000000-0000-4000-8000-000000000001","status":"reconciled","reconciledAt":"2026-10-18T10:00:00Z","purchasedOn":"2026-10-18"}'::jsonb,
  '[{"id":"f2000000-0000-4000-8000-000000000001","lineNo":1,"description":"FLOUR 1KG","matchStatus":"confirmed","matchedItemId":"d1000000-0000-4000-8000-000000000001"}]'::jsonb);
select tests.ok((select status = 'reconciled' from public.receipts where id = 'f1000000-0000-4000-8000-000000000001'), 'reconciled');

select tests.is(public.record_price_observations('aa000000-0000-4000-8000-0000000000aa',
  '[{"ingredientId":"11000000-0000-4000-8000-000000000001","pricePence":120,"quantity":{"kind":"exact","value":1,"unit":"kg","originalText":"1KG"},
     "kind":"receipt","observedOn":"2026-10-18","source":"receipt:f1:f2","receiptLineId":"f2000000-0000-4000-8000-000000000001"},
    {"ingredientId":"99000000-0000-4000-8000-000000000009","pricePence":1,"quantity":{"kind":"exact","value":1,"unit":"kg","originalText":"1"},
     "kind":"receipt","observedOn":"2026-10-18","source":"receipt:f1:x","receiptLineId":"f2000000-0000-4000-8000-000000000001"},
    {"ingredientId":"11000000-0000-4000-8000-000000000001","pricePence":5,"quantity":{"kind":"exact","value":1,"unit":"kg","originalText":"1"},
     "kind":"retailer_verified","observedOn":"2026-10-18","source":"forged"}]'::jsonb), 1, 'only the known-ingredient household receipt price is stored');
select tests.is(public.record_price_observations('aa000000-0000-4000-8000-0000000000aa',
  '[{"ingredientId":"11000000-0000-4000-8000-000000000001","pricePence":120,"quantity":{"kind":"exact","value":1,"unit":"kg","originalText":"1KG"},
     "kind":"receipt","observedOn":"2026-10-18","source":"receipt:f1:f2","receiptLineId":"f2000000-0000-4000-8000-000000000001"}]'::jsonb), 0, 'idempotent on source');
select tests.reset_actor();
insert into public.ingredient_prices (household_id, ingredient_id, price_pence, quantity_value, unit, kind, observed_on, source) values
  (null, '11000000-0000-4000-8000-000000000001', 99, 1, 'kg', 'retailer_verified', '2026-10-01', 'retailer'),
  (null, '11000000-0000-4000-8000-000000000001', 98, 1, 'kg', 'generic_estimate', '2026-10-01', 'generic');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select jsonb_array_length(public.household_price_observations('aa000000-0000-4000-8000-0000000000aa'))), 2, 'own receipt + shared retailer_verified (no shared generic)');
select tests.is((select jsonb_array_length(public.household_purchase_records('aa000000-0000-4000-8000-0000000000aa'))), 1, 'purchase feed');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select jsonb_array_length(public.list_receipts('aa000000-0000-4000-8000-0000000000aa'))), 0, 'receipts invisible to others');
select tests.ok(public.get_receipt('aa000000-0000-4000-8000-0000000000aa', 'f1000000-0000-4000-8000-000000000001') is null, 'receipt invisible to others');
select tests.is((select jsonb_array_length(public.household_price_observations('aa000000-0000-4000-8000-0000000000aa'))), 1, 'only shared rows for others');
select tests.is((select jsonb_array_length(public.household_purchase_records('aa000000-0000-4000-8000-0000000000aa'))), 0, 'purchase feed isolated');
select tests.throws($$ select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"f1000000-0000-4000-8000-000000000009","status":"parsed"}'::jsonb, '[]'::jsonb) $$, '42501', 'cannot write into another household');

-- ===================== planner profile =====================
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.consent_records (household_id, consent_type, wording_version) values ('aa000000-0000-4000-8000-0000000000aa', 'allergy_data', 'v1');
insert into public.household_exclusions (household_id, allergen_group, kind, consent_recorded_at) values ('aa000000-0000-4000-8000-0000000000aa', 'peanuts', 'allergy', now());
insert into public.household_exclusions (household_id, term, kind) values ('aa000000-0000-4000-8000-0000000000aa', 'Mushrooms', 'avoid');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
create temp table t_prof as select public.planner_household_profile('aa000000-0000-4000-8000-0000000000aa') as p;
select tests.is((select jsonb_array_length(p -> 'members') from t_prof), 2, 'two members');
select tests.ok((select p -> 'exclusions' @> '[{"name":"peanut butter","kind":"allergy"},{"name":"peanuts","kind":"allergy"},{"name":"mushrooms","kind":"avoid"}]' from t_prof), 'allergen group expanded, avoid term kept');
select tests.is((select (p ->> 'withheldExclusions')::int from t_prof), 0, 'nothing withheld while consent is active');
-- Alice withdraws consent: the allergy row is withheld (Bob, who cannot see her consent, gets the same answer)
select tests.act_as('a0000000-0000-4000-8000-000000000001');
update public.consent_records set withdrawn_at = now() where household_id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok((select not (public.planner_household_profile('aa000000-0000-4000-8000-0000000000aa') -> 'exclusions' @> '[{"kind":"allergy"}]')), 'withdrawn consent -> allergy withheld');
select tests.is((select (public.planner_household_profile('aa000000-0000-4000-8000-0000000000aa') ->> 'withheldExclusions')::int), 1, 'withheld counted');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.planner_household_profile('aa000000-0000-4000-8000-0000000000aa') is null, 'non-member gets nothing');

-- ===================== AI settings =====================
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select public.save_household_ai_settings('aa000000-0000-4000-8000-0000000000aa', 'openai', '{}'::jsonb, '{}'::jsonb) $$, '42501', 'member cannot write');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.save_household_ai_settings('aa000000-0000-4000-8000-0000000000aa', 'openai', '{}'::jsonb,
  '{"openai":{"enc":"sk-plaintext-key","hint":"x"}}'::jsonb) $$, '22023', 'plaintext key refused');
select public.save_household_ai_settings('aa000000-0000-4000-8000-0000000000aa', 'openai', '{"openai":{"model":"gpt-4.1"}}'::jsonb,
  '{"openai":{"enc":"v1.aXY=.dGFn.Y3Q=","hint":"sk-...abcd"}}'::jsonb);
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok((select public.get_household_ai_settings('aa000000-0000-4000-8000-0000000000aa') -> 'keys' -> 'openai' ->> 'hint') = 'sk-...abcd', 'member reads settings');
select tests.throws($$ select * from public.household_ai_settings $$, '42501', 'table not readable directly');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.get_household_ai_settings('aa000000-0000-4000-8000-0000000000aa') is null, 'non-member reads nothing');

-- ===================== grace period read-only =====================
select tests.reset_actor();
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.apply_shopping_command((select id from t_list), gen_random_uuid(), 'add', '{}'::jsonb,
  '{"status":"applied"}'::jsonb, '[]'::jsonb, 3) $$, '42501', 'read-only: no shopping writes');
select tests.throws($$ select public.save_household_ai_settings('aa000000-0000-4000-8000-0000000000aa', 'mock', '{}'::jsonb, '{}'::jsonb) $$, '42501', 'read-only: no AI settings writes');
select tests.ok((select (public.shopping_list_snapshot('aa000000-0000-4000-8000-0000000000aa') ->> 'head')::int = 3), 'read-only: reads still work');

select tests.reset_actor();
rollback;
