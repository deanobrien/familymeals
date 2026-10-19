-- Cross-household isolation for recipe, planning, shopping, purchase, receipt, pantry, nutrition, AI and
-- storage data; reference-table read-only; shared-or-own prices/packs; composite-FK tenancy guard.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test');

-- Fixtures (superuser; households bootstrap their owners from created_by).
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-0000000000bb', 'Bob home',   'b0000000-0000-4000-8000-000000000002');

insert into public.ingredients (id, name, slug, category, form) values
  ('11000000-0000-4000-8000-000000000001', 'Basmati rice', 'basmati-rice', 'Grains', null),
  ('11000000-0000-4000-8000-000000000002', 'Onion', 'onion', 'Vegetables', 'fresh');
insert into public.product_packs (id, household_id, ingredient_id, name, quantity_value, unit) values
  ('22000000-0000-4000-8000-000000000001', null, '11000000-0000-4000-8000-000000000001', 'Rice 1kg (generic)', 1, 'kg'),
  ('22000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000001', 'Alice rice 2kg', 2, 'kg');
insert into public.ingredient_prices (household_id, ingredient_id, price_pence, quantity_value, unit, kind, observed_on, source) values
  (null, '11000000-0000-4000-8000-000000000001', 180, 1, 'kg', 'generic_estimate', '2026-10-01', 'PRJ-018 generic seed 2026-10'),
  ('aa000000-0000-4000-8000-0000000000aa', '11000000-0000-4000-8000-000000000001', 150, 1, 'kg', 'user_confirmed', '2026-10-10', 'user');

insert into public.recipes (id, household_id, title) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Vegetable biryani'),
  ('b1000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'Bob''s chilli');
insert into public.recipe_ingredients (id, recipe_id, household_id, ingredient_id, original_text, quantity_kind, quantity_value, unit, position) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   '11000000-0000-4000-8000-000000000001', '300g basmati rice', 'exact', 300, 'g', 0),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   null, 'a pinch of saffron', 'approximate', null, null, 1);
update public.recipe_ingredients set approx_label = 'pinch' where id = 'a2000000-0000-4000-8000-000000000002';
insert into public.recipe_steps (recipe_id, household_id, step_number, instructions) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 1, 'Rinse the rice.');
insert into public.recipe_tags (id, household_id, name) values
  ('a3000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Fakeaway');
insert into public.recipe_tag_links (recipe_id, tag_id, household_id) values
  ('a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');

insert into public.meal_plans (id, household_id, start_date, end_date) values
  ('a4000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '2026-10-19', '2026-10-25');
insert into public.planned_meals (id, meal_plan_id, household_id, meal_date, meal_type, recipe_id, servings) values
  ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   '2026-10-20', 'dinner', 'a1000000-0000-4000-8000-000000000001', 4);

insert into public.shopping_lists (id, household_id, name, meal_plan_id) values
  ('a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'This week', 'a4000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'Bob list', null);
insert into public.shopping_list_items (id, shopping_list_id, household_id, ingredient_id, display_name, quantity_kind, quantity_value, unit) values
  ('a7000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
   '11000000-0000-4000-8000-000000000002', 'Onions', 'exact', 3, 'item'),
  ('b7000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb',
   null, 'Beans', 'exact', 2, 'can');
insert into public.shopping_list_item_sources (shopping_list_item_id, household_id, planned_meal_id, recipe_id, recipe_ingredient_id,
                                              quantity_kind, quantity_value, unit, original_text) values
  ('a7000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'a5000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'exact', 3, 'item', '3 onions');
insert into public.receipts (id, household_id, retailer, image_paths) values
  ('a8000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tesco',
   array['aa000000-0000-4000-8000-0000000000aa/receipts/a8000000-0000-4000-8000-000000000001/1.jpg']);
insert into public.receipt_lines (id, receipt_id, household_id, line_no, description, line_total_pence) values
  ('a9000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 1, 'ONIONS LOOSE', 45);
insert into public.pantry_items (household_id, display_name, quantity_kind, quantity_value, unit) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Rice', 'exact', 500, 'g');
insert into public.ai_usage (household_id, user_id, operation, provider, model, status) values
  ('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'recipe_extraction', 'mock', 'mock-1', 'success');
insert into public.nutrition_profiles (id, household_id, recipe_id, basis, servings, calculation_method) values
  ('aa100000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'a1000000-0000-4000-8000-000000000001', 'total', 4, 'test');
insert into public.nutrition_profile_values (nutrition_profile_id, household_id, nutrient, value_status, value, unit) values
  ('aa100000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'fibre', 'unknown', null, 'g');
insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/recipes/a1000000-0000-4000-8000-000000000001/1.jpg');

-- Search denormalisation triggers populated the recipe.
select tests.ok((select search_ingredients like '%basmati%' and search_tags = 'Fakeaway'
                   from public.recipes where id = 'a1000000-0000-4000-8000-000000000001'), 'search columns maintained');

-- ===================== Bob (outsider) =====================
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.recipes), 1, 'bob sees only his recipe');
select tests.is((select count(*) from public.recipe_ingredients), 0, 'bob sees no HA recipe lines');
select tests.is((select count(*) from public.recipe_steps), 0, 'bob sees no HA steps');
select tests.is((select count(*) from public.recipe_tags), 0, 'bob sees no HA tags');
select tests.is((select count(*) from public.meal_plans), 0, 'bob sees no HA meal plans');
select tests.is((select count(*) from public.planned_meals), 0, 'bob sees no HA planned meals');
select tests.is((select count(*) from public.shopping_lists), 1, 'bob sees only his list');
select tests.is((select count(*) from public.shopping_list_items), 1, 'bob sees only his item');
select tests.is((select count(*) from public.shopping_list_item_sources), 0, 'bob sees no HA provenance');
select tests.is((select count(*) from public.shopping_list_item_progress), 1, 'progress view respects RLS');
select tests.is((select count(*) from public.receipts), 0, 'bob sees no HA receipts');
select tests.is((select count(*) from public.receipt_lines), 0, 'bob sees no HA receipt lines');
select tests.is((select count(*) from public.pantry_items), 0, 'bob sees no HA pantry');
select tests.is((select count(*) from public.ai_usage), 0, 'bob sees no HA AI usage');
select tests.is((select count(*) from public.nutrition_profiles), 0, 'bob sees no HA nutrition');
select tests.is((select count(*) from public.nutrition_profile_values), 0, 'bob sees no HA nutrient values');
select tests.is((select count(*) from public.search_recipes('aa000000-0000-4000-8000-0000000000aa', 'rice')), 0,
                'search_recipes cannot reach HA');

-- Reference data: readable, not writable.
select tests.is((select count(*) from public.ingredients), 2, 'reference ingredients readable');
select tests.throws($$ insert into public.ingredients (name, slug, category) values ('X', 'x', 'Y') $$, '42501',
                    'reference ingredients not writable');
select tests.throws($$ update public.ingredients set name = 'Rice!' $$, '42501', 'reference ingredients not updatable');
select tests.throws($$ insert into public.ai_usage (household_id, operation, provider, model, status)
                      values ('bb000000-0000-4000-8000-0000000000bb', 'tagging', 'x', 'y', 'success') $$, '42501',
                    'ai_usage is server-written only');

-- Shared-or-own.
select tests.is((select count(*) from public.product_packs), 1, 'bob sees reference pack only');
select tests.is((select count(*) from public.ingredient_prices), 1, 'bob sees generic price only');
select tests.is(tests.affected($$ update public.ingredient_prices set price_pence = 1 $$), 0,
                'bob cannot modify generic or HA prices');
select tests.throws($$ insert into public.ingredient_prices (household_id, ingredient_id, price_pence, quantity_value, unit, kind, observed_on, source)
                      values (null, '11000000-0000-4000-8000-000000000001', 1, 1, 'kg', 'generic_estimate', '2026-10-01', 'forged') $$,
                    '42501', 'users cannot forge reference prices');
select tests.throws($$ insert into public.ingredient_prices (household_id, ingredient_id, price_pence, quantity_value, unit, kind, observed_on, source)
                      values ('bb000000-0000-4000-8000-0000000000bb', '11000000-0000-4000-8000-000000000001', 1, 1, 'kg', 'retailer_verified', '2026-10-01', 'forged') $$,
                    '23514', 'household rows cannot claim retailer_verified');

-- Writes into HA are refused (RLS) — even when the FK target exists.
select tests.throws($$ insert into public.recipes (household_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'Spam') $$,
                    '42501', 'bob cannot insert a recipe into HA');
select tests.throws($$ insert into public.shopping_list_items (shopping_list_id, household_id, display_name, quantity_kind)
                      values ('a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'x', 'to_taste') $$,
                    '42501', 'bob cannot add items to HA list');
select tests.is(tests.affected($$ delete from public.shopping_list_items where household_id = 'aa000000-0000-4000-8000-0000000000aa' $$), 0,
                'bob cannot delete HA items');
-- Composite FK: cannot smuggle a cross-household reference by labelling the row with his own household.
select tests.reset_actor();
select tests.throws($$ insert into public.purchase_events (shopping_list_item_id, household_id, quantity_kind, quantity_value, unit, created_by)
                      values ('a7000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'exact', 1, 'item',
                              'b0000000-0000-4000-8000-000000000002') $$,
                    '23503', 'composite FK blocks cross-household purchase (even for service role)');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ insert into public.recipe_ingredients (recipe_id, household_id, original_text, quantity_kind, position)
                      values ('a1000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'x', 'unparsed', 9) $$,
                    '23503', 'composite FK blocks cross-household recipe line');
select tests.throws($$ insert into public.planned_meals (meal_plan_id, household_id, meal_date, meal_type, servings, kind)
                      values ('a4000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', '2026-10-20', 'lunch', 2, 'eating_out') $$,
                    null, 'cross-household planned meal rejected (date trigger or composite FK)');

-- Storage.
select tests.is((select count(*) from storage.objects), 0, 'bob cannot list HA images');
select tests.throws($$ insert into storage.objects (bucket_id, name)
                      values ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/recipes/evil.jpg') $$,
                    '42501', 'bob cannot upload into HA folder');
select tests.throws($$ insert into storage.objects (bucket_id, name) values ('recipe-images', 'not-a-uuid/evil.jpg') $$,
                    '42501', 'non-household path rejected');
insert into storage.objects (bucket_id, name) values ('receipt-images', 'bb000000-0000-4000-8000-0000000000bb/receipts/r1/1.jpg');
select tests.is((select count(*) from storage.objects), 1, 'bob can use his own folder');

-- ===================== Alice (member) =====================
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from public.recipes), 1, 'alice sees her recipe');
select tests.is((select count(*) from public.product_packs), 2, 'alice sees reference + own pack');
select tests.is((select count(*) from public.ingredient_prices), 2, 'alice sees generic + own price');
select tests.is((select count(*) from public.search_recipes('aa000000-0000-4000-8000-0000000000aa', 'basmati')), 1,
                'search by ingredient');
select tests.is((select count(*) from public.search_recipes('aa000000-0000-4000-8000-0000000000aa', 'fakeaway')), 1,
                'search by tag');
select tests.is((select count(*) from public.search_recipes('aa000000-0000-4000-8000-0000000000aa', 'biriyani')), 1,
                'fuzzy title search (trigram)');
select tests.is((select count(*) from storage.objects), 1, 'alice sees her image only');

-- Purchases: written only via record_purchase / void_purchase (L17a design); derived progress.
select tests.throws($$ insert into public.purchase_events (shopping_list_item_id, household_id, quantity_kind, quantity_value, unit)
                      values ('a7000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'exact', 1, 'item') $$,
                    '42501', 'direct purchase_events insert is not allowed (RPC only)');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":2,"unit":"item","originalText":"2 onions"}', 30) ->> 'status' = 'applied',
                'explicit purchase of 2 applied');
-- offline replay of the same client-generated id returns the original outcome, no second write
select tests.ok((public.record_purchase('ae000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":2,"unit":"item"}') ->> 'duplicate')::boolean, 'replay flagged duplicate');
select tests.is((select purchase_event_count from public.shopping_list_item_progress
                  where shopping_list_item_id = 'a7000000-0000-4000-8000-000000000001'), 1, 'replay is idempotent');
select tests.ok((select purchase_status = 'partial' and outstanding_quantity = 1 and purchased_quantity = 2
                   from public.shopping_list_item_progress
                  where shopping_list_item_id = 'a7000000-0000-4000-8000-000000000001'), 'partial: 2 of 3 bought, 1 outstanding');
select tests.ok(public.shopping_item_outstanding('a7000000-0000-4000-8000-000000000001') = 1, 'SQL outstanding = 1');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'purchase',
                  '{"kind":"exact","value":-1,"unit":"item"}') ->> 'reason' = 'invalid_quantity', 'negative quantity rejected');
-- tick records exactly what is outstanding
select tests.ok((public.record_purchase('ae000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'tick')
                  -> 'quantity' ->> 'value')::numeric = 1, 'tick buys the outstanding 1');
select tests.ok((select purchase_status = 'purchased' and outstanding_quantity = 0
                   from public.shopping_list_item_progress
                  where shopping_list_item_id = 'a7000000-0000-4000-8000-000000000001'), 'purchased when fully covered');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000001', 'tick')
                  ->> 'reason' = 'already_complete', 'second shopper tick rejected: already complete');
select tests.throws($$ update public.purchase_events set quantity_value = 3 where id = 'ae000000-0000-4000-8000-000000000001' $$,
                    '42501', 'purchase events not directly updatable');
select tests.throws($$ delete from public.purchase_events where id = 'ae000000-0000-4000-8000-000000000001' $$,
                    '42501', 'purchase events cannot be deleted');
select tests.ok(public.void_purchase('af000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001') ->> 'status' = 'applied',
                'void allowed once');
select tests.ok(public.void_purchase('af000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000001') ->> 'reason' = 'already_voided',
                'second void rejected as already_voided');
select tests.ok((select purchase_status = 'partial' and outstanding_quantity = 2
                   from public.shopping_list_item_progress
                  where shopping_list_item_id = 'a7000000-0000-4000-8000-000000000001'), 'voided event excluded from progress');
select tests.is((select count(*) from public.shopping_command_log), 6, 'every command (incl. rejections) logged once');
select tests.is((select count(*) from public.shopping_command_log where status = 'rejected'), 3, 'rejections logged');
-- metric-compatible outstanding (kg item, g purchase) and engine fallback (g item, tbsp purchase)
insert into public.shopping_list_items (id, shopping_list_id, household_id, display_name, quantity_kind, quantity_value, unit) values
  ('a7000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Rice', 'exact', 1, 'kg'),
  ('a7000000-0000-4000-8000-000000000003', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Flour', 'exact', 500, 'g'),
  ('a7000000-0000-4000-8000-000000000004', 'a6000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Salt', 'to_taste', null, null);
select public.record_purchase('ae000000-0000-4000-8000-000000000010', 'a7000000-0000-4000-8000-000000000002', 'purchase', '{"value":250,"unit":"g"}');
select tests.ok(public.shopping_item_outstanding('a7000000-0000-4000-8000-000000000002') = 0.75, '1 kg - 250 g = 0.75 kg outstanding');
select public.record_purchase('ae000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000003', 'purchase', '{"value":2,"unit":"tbsp"}');
select tests.ok(public.shopping_item_outstanding('a7000000-0000-4000-8000-000000000003') is null, 'g vs tbsp needs engine (NULL)');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000012', 'a7000000-0000-4000-8000-000000000003', 'tick')
                  ->> 'reason' = 'needs_engine_outstanding', 'tick without engine figure rejected');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000013', 'a7000000-0000-4000-8000-000000000003', 'tick',
                  null, null, null, 470, 0) ->> 'reason' = 'needs_engine_outstanding', 'stale engine figure (event count mismatch) rejected');
select tests.ok((public.record_purchase('ae000000-0000-4000-8000-000000000014', 'a7000000-0000-4000-8000-000000000003', 'tick',
                  null, null, null, 470, 1) -> 'quantity' ->> 'value')::numeric = 470, 'engine figure accepted after re-check under lock');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000015', 'a7000000-0000-4000-8000-000000000004', 'tick') ->> 'status' = 'applied',
                'unquantified item tick applied');
select tests.ok(public.record_purchase('ae000000-0000-4000-8000-000000000016', 'a7000000-0000-4000-8000-000000000004', 'tick') ->> 'reason' = 'already_complete',
                'unquantified item second tick rejected');

-- Bob cannot touch HA purchases through the RPCs, nor read the HA command log.
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select public.record_purchase(gen_random_uuid(), 'a7000000-0000-4000-8000-000000000001', 'purchase', '{"value":1,"unit":"item"}') $$,
                    'P0002', 'outsider record_purchase on HA item refused');
select tests.throws($$ select public.void_purchase(gen_random_uuid(), 'ae000000-0000-4000-8000-000000000003') $$,
                    'P0002', 'outsider void on HA event refused');
select tests.is((select count(*) from public.shopping_command_log), 0, 'outsider cannot read HA command log');
select tests.act_as('a0000000-0000-4000-8000-000000000001');

-- Favourites/ratings are self-writable only.
insert into public.recipe_favourites (recipe_id, household_id) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');
select tests.throws($$ insert into public.recipe_ratings (recipe_id, household_id, user_id, rating)
                      values ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa',
                              'b0000000-0000-4000-8000-000000000002', 1) $$,
                    '42501', 'cannot rate on behalf of another user');

-- Data-shape guards.
select tests.throws($$ insert into public.recipe_ingredients (recipe_id, household_id, original_text, quantity_kind, quantity_value, unit, position)
                      values ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'salt to taste', 'to_taste', 2, 'g', 5) $$,
                    '23514', 'to_taste cannot carry an invented weight');
select tests.throws($$ insert into public.recipe_ingredients (recipe_id, household_id, original_text, quantity_kind, quantity_min, quantity_max, unit, position)
                      values ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '3-2 eggs', 'range', 3, 2, 'item', 6) $$,
                    '23514', 'range requires min <= max');
select tests.throws($$ insert into public.planned_meals (meal_plan_id, household_id, meal_date, meal_type, servings, kind)
                      values ('a4000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', '2026-11-30', 'lunch', 2, 'eating_out') $$,
                    '23514', 'planned meal must fall inside plan range');
select tests.throws($$ insert into public.nutrition_profile_values (nutrition_profile_id, household_id, nutrient, value_status, value, unit)
                      values ('aa100000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'salt', 'unknown', 0, 'g') $$,
                    '23514', 'unknown nutrient cannot be stored as 0');
select tests.throws($$ insert into public.receipts (household_id, image_paths)
                      values ('aa000000-0000-4000-8000-0000000000aa', array['bb000000-0000-4000-8000-0000000000bb/receipts/x.jpg']) $$,
                    '23514', 'receipt image path must be under own household');

rollback;
