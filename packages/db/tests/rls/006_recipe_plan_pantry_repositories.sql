-- Lane S1 (0015): recipe / meal plan / pantry repository RPCs, run as real household members so RLS applies.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-0000000000bb', 'Bob home',   'b0000000-0000-4000-8000-000000000002');
insert into public.ingredients (id, name, slug, category, form) values
  ('11000000-0000-4000-8000-000000000001', 'Spaghetti', 'spaghetti', 'Grains', null),
  ('11000000-0000-4000-8000-000000000002', 'Onion', 'onion', 'Vegetables', 'fresh');

create or replace function tests.titles(p jsonb) returns text language sql as $$
  select string_agg(x ->> 'title', ',' order by ord) from jsonb_array_elements(p -> 'items') with ordinality t(x, ord)
$$;
grant execute on function tests.titles(jsonb) to authenticated;

select tests.act_as('a0000000-0000-4000-8000-000000000001');

-- ===================== recipes: create =====================
select tests.ok(
  public.save_recipe('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001', $j${
      "title": "Tomato pasta", "description": "Quick supper", "imageUrl": "https://example.test/pasta.jpg",
      "sourceAttribution": "Nan", "sourceUrl": "", "originalText": "Boil pasta. Add sauce.",
      "prepMinutes": 10, "cookMinutes": 15, "servings": 4, "cuisine": "Italian", "mealType": "dinner", "diet": "vegetarian",
      "tags": ["Quick", "pasta", "quick"],
      "ingredients": [
        {"name": "spaghetti", "ingredientId": "11000000-0000-4000-8000-000000000001",
         "quantity": {"kind": "exact", "value": 400, "unit": "g", "originalText": "400g"}, "optional": false},
        {"name": "fresh basil", "ingredientId": "99999999-0000-4000-8000-000000000009",
         "quantity": {"kind": "approximate", "approxLabel": "handful", "originalText": "a handful"}, "optional": true},
        {"name": "salt", "quantity": {"kind": "to_taste", "originalText": ""}, "optional": false}
      ],
      "steps": ["Boil the pasta", "Make the sauce"]
    }$j$::jsonb, 'create') ->> 'title' = 'Tomato pasta', 'create returns the view');

select tests.is((select count(*) from public.recipe_ingredients where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 3, 'three ingredient rows');
select tests.is((select count(*) from public.recipe_steps where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 2, 'two steps');
select tests.is((select count(*) from public.recipe_tag_links where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 2, 'tags de-duplicated case-insensitively');
select tests.is((select count(*) from public.recipe_versions where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'version 1 written');
select tests.ok((select ingredient_id is null from public.recipe_ingredients where display_name = 'fresh basil'),
  'ingredient id unknown to public.ingredients is stored as NULL (line kept)');
select tests.ok((select original_text = 'salt' from public.recipe_ingredients where display_name = 'salt'),
  'blank quantity text falls back to the name (original_text is NOT NULL, min 1 char)');
select tests.ok((select cover_image_path is null from public.recipes where id = 'a1000000-0000-4000-8000-000000000001'),
  'external image URL is not stored as a storage path');
select tests.ok((select position('spaghetti' in search_ingredients) > 0 and position('fresh basil' in search_ingredients) > 0
                   from public.recipes where id = 'a1000000-0000-4000-8000-000000000001'),
  'search_ingredients includes display names');

-- the view document
select tests.ok(
  (select v ->> 'original_text' = 'Boil pasta. Add sauce.'
      and v ->> 'image_url' = 'https://example.test/pasta.jpg'
      and jsonb_array_length(v -> 'ingredients') = 3 and jsonb_array_length(v -> 'steps') = 2
      and v -> 'tags' = '["pasta","quick"]'::jsonb and (v ->> 'favourite')::boolean = false and v -> 'rating' = 'null'::jsonb
      and v ->> 'default_servings' = '4' and v ->> 'status' = 'active'
    from (select public.get_recipes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
                                    array['a1000000-0000-4000-8000-000000000001']::uuid[]) -> 0 as v) s),
  'view document shape');

select tests.throws($$ select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', '{"title":"Dup","description":"","imageUrl":null,"sourceAttribution":"","sourceUrl":"","originalText":"","prepMinutes":null,"cookMinutes":null,"servings":2,"cuisine":"","mealType":"dinner","diet":"meat","tags":[],"ingredients":[{"name":"x","quantity":{"kind":"unparsed","originalText":"x"},"optional":false}],"steps":["s"]}'::jsonb, 'create') $$,
  '23505', 'creating with an existing id fails');

-- ===================== recipes: update =====================
select tests.ok(
  public.save_recipe('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001', $j${
      "title": "Tomato pasta v2", "description": "", "imageUrl": null, "sourceAttribution": "", "sourceUrl": "",
      "originalText": "ATTEMPTED OVERWRITE", "prepMinutes": 5, "cookMinutes": null, "servings": 2, "cuisine": "Italian",
      "mealType": "dinner", "diet": "vegetarian", "tags": ["pasta"],
      "ingredients": [
        {"name": "spaghetti", "quantity": {"kind": "exact", "value": 200, "unit": "g", "originalText": "200g"}, "optional": false},
        {"name": "onion", "quantity": {"kind": "exact", "value": 1, "unit": "item", "originalText": "1"}, "optional": false}
      ],
      "steps": ["Boil", "Sauce", "Serve"]
    }$j$::jsonb, 'update') ->> 'title' = 'Tomato pasta v2', 'update returns the new view');
select tests.is((select count(*) from public.recipe_versions where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 2, 'version 2 appended');
select tests.ok((select public.get_recipes('aa000000-0000-4000-8000-0000000000aa', null, array['a1000000-0000-4000-8000-000000000001']::uuid[]) -> 0 ->> 'original_text')
                = 'Boil pasta. Add sauce.', 'originalText is write-once');
select tests.ok((select ingredient_id = '11000000-0000-4000-8000-000000000001' from public.recipe_ingredients where display_name = 'spaghetti'),
  'canonical ingredient id carried over for a same-name line when not re-sent');
select tests.is((select count(*) from public.recipe_steps where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 3, 'steps replaced');
select tests.is((select count(*) from public.recipe_tag_links where recipe_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'tag links replaced');
select tests.ok((select v ->> 'image_url' is null from (select public.get_recipes('aa000000-0000-4000-8000-0000000000aa', null,
                 array['a1000000-0000-4000-8000-000000000001']::uuid[]) -> 0 as v) s), 'cleared image stays cleared');
select tests.ok(public.save_recipe('aa000000-0000-4000-8000-0000000000aa', null, 'a1000000-0000-4000-8000-0000000000ff',
  '{"title":"x"}'::jsonb, 'update') is null, 'update of a missing recipe returns NULL');

-- nutrition cache is dropped when ingredient lines change, kept otherwise
insert into public.nutrition_profiles (id, household_id, recipe_id, basis, servings, calculation_method) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'a1000000-0000-4000-8000-000000000001', 'per_serving', 2, 'test');
insert into public.nutrition_profile_values (nutrition_profile_id, household_id, nutrient, value_status, value, unit) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'energy_kcal', 'known', 480, 'kcal'),
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'fibre', 'unknown', null, 'g');
select tests.ok((select v -> 'nutrition' -> 'values' -> 0 ->> 'nutrient' = 'energy_kcal' and jsonb_array_length(v -> 'nutrition' -> 'values') = 2
                   from (select public.get_recipes('aa000000-0000-4000-8000-0000000000aa', null, array['a1000000-0000-4000-8000-000000000001']::uuid[]) -> 0 as v) s),
  'nutrition per serving surfaces in the view');
select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', null, 'a1000000-0000-4000-8000-000000000001', $j${
  "title": "Tomato pasta v2", "description": "", "imageUrl": null, "sourceAttribution": "", "sourceUrl": "", "originalText": "",
  "prepMinutes": 5, "cookMinutes": null, "servings": 2, "cuisine": "Italian", "mealType": "dinner", "diet": "vegetarian", "tags": ["pasta"],
  "ingredients": [
    {"name": "spaghetti", "quantity": {"kind": "exact", "value": 200, "unit": "g", "originalText": "200g"}, "optional": false},
    {"name": "onion", "quantity": {"kind": "exact", "value": 1, "unit": "item", "originalText": "1"}, "optional": false}
  ], "steps": ["Boil"]}$j$::jsonb, 'update');
select tests.is((select count(*) from public.nutrition_profiles), 1, 'unchanged ingredient lines keep the nutrition cache');
select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', null, 'a1000000-0000-4000-8000-000000000001', $j${
  "title": "Tomato pasta v2", "description": "", "imageUrl": null, "sourceAttribution": "", "sourceUrl": "", "originalText": "",
  "prepMinutes": 5, "cookMinutes": null, "servings": 2, "cuisine": "Italian", "mealType": "dinner", "diet": "vegetarian", "tags": ["pasta"],
  "ingredients": [{"name": "spaghetti", "quantity": {"kind": "exact", "value": 300, "unit": "g", "originalText": "300g"}, "optional": false}],
  "steps": ["Boil"]}$j$::jsonb, 'update');
select tests.is((select count(*) from public.nutrition_profiles), 0, 'changed ingredient lines drop the nutrition cache');

-- a second recipe for list tests
select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002', $j${
  "title": "Beef stew", "description": "Slow", "imageUrl": null, "sourceAttribution": "", "sourceUrl": "", "originalText": "",
  "prepMinutes": 30, "cookMinutes": 180, "servings": 6, "cuisine": "British", "mealType": "dinner", "diet": "meat", "tags": ["winter", "pasta"],
  "ingredients": [{"name": "beef", "quantity": {"kind": "exact", "value": 800, "unit": "g", "originalText": "800g"}, "optional": false}],
  "steps": ["Stew"]}$j$::jsonb, 'create');
select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000003', $j${
  "title": "Porridge", "description": "", "imageUrl": null, "sourceAttribution": "", "sourceUrl": "", "originalText": "",
  "prepMinutes": 2, "cookMinutes": 5, "servings": 1, "cuisine": "", "mealType": "breakfast", "diet": "vegan", "tags": [],
  "ingredients": [{"name": "oats", "quantity": {"kind": "exact", "value": 50, "unit": "g", "originalText": "50g"}, "optional": false}],
  "steps": ["Heat"]}$j$::jsonb, 'create');

-- ===================== list_recipes =====================
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001'))
                = 'Beef stew,Porridge,Tomato pasta v2', 'default: all live recipes by name');
select tests.is((public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null) ->> 'total')::bigint, 3, 'total');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_query => 'spaghetti')) = 'Tomato pasta v2',
                'ingredient search (display name)');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_query => 'stew')) = 'Beef stew', 'title search');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_tags => array['PASTA'])) = 'Beef stew,Tomato pasta v2',
                'tag filter is case-insensitive and ANDs');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_tags => array['pasta', 'winter'])) = 'Beef stew', 'all tags required');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_cuisine => 'italian')) = 'Tomato pasta v2', 'cuisine filter');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_meal_type => 'breakfast')) = 'Porridge', 'meal type filter');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_max_prep => 5)) = 'Porridge,Tomato pasta v2', 'max prep filter');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_diet => 'meat')) = 'Beef stew', 'diet filter');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_collection => 'vegetarian')) = 'Porridge,Tomato pasta v2', 'vegetarian collection includes vegan');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_collection => 'quick')) = 'Porridge,Tomato pasta v2', 'quick collection (total <= 30 min, unknown excluded)');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_collection => 'budget')) is null, 'budget collection matches nothing without a cost cache');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_sort => 'prep')) = 'Porridge,Tomato pasta v2,Beef stew', 'sort by prep asc');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_limit => 2, p_offset => 2)) = 'Tomato pasta v2', 'paging');
select tests.is((public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_limit => 2, p_offset => 2) ->> 'total')::bigint, 3, 'total ignores paging');

-- favourites (per member) and ratings (household mean)
insert into public.recipe_favourites (recipe_id, user_id, household_id) values
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');
insert into public.recipe_ratings (recipe_id, user_id, household_id, rating) values
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 5),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 3);
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', p_collection => 'favourites')) = 'Beef stew', 'favourites for alice');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', p_collection => 'favourites')) is null, 'favourites are per member');
select tests.ok(tests.titles(public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null, p_sort => 'rating')) = 'Beef stew,Porridge,Tomato pasta v2', 'rating sort: unrated last');
select tests.ok((public.list_recipes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', p_collection => 'favourites') -> 'items' -> 0 ->> 'rating')::numeric = 5.0
            and (public.list_recipes('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', p_collection => 'favourites') -> 'items' -> 0 ->> 'favourite')::boolean,
  'view carries favourite + rating');

-- ===================== facets / duplicates =====================
select tests.ok(public.recipe_facets('aa000000-0000-4000-8000-0000000000aa') -> 'tags' -> 0 = '{"tag":"pasta","count":2}'::jsonb, 'tag facets ordered by count');
select tests.ok(public.recipe_facets('aa000000-0000-4000-8000-0000000000aa') -> 'cuisines' = '["British","Italian"]'::jsonb, 'cuisine facets (blank omitted)');
select tests.is(jsonb_array_length(public.find_recipe_duplicates('aa000000-0000-4000-8000-0000000000aa', null, 'Tomato Pasta V2 (copy)', null)), 1, 'duplicate by normalised title');
select tests.is(jsonb_array_length(public.find_recipe_duplicates('aa000000-0000-4000-8000-0000000000aa', null, 'Something else', array['spaghetti'], null)), 0, 'fewer than 3 names never matches on ingredients');
select tests.is(jsonb_array_length(public.find_recipe_duplicates('aa000000-0000-4000-8000-0000000000aa', null, 'Tomato pasta v2', null, 'a1000000-0000-4000-8000-000000000001')), 0, 'excludeId honoured');

-- ===================== tenancy =====================
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((public.list_recipes('aa000000-0000-4000-8000-0000000000aa', null) ->> 'total')::bigint, 0, 'bob (RLS) cannot list alice''s recipes via the RPC');
select tests.throws($$ select public.save_recipe('aa000000-0000-4000-8000-0000000000aa', null, null,
  '{"title":"Intruder","description":"","imageUrl":null,"sourceAttribution":"","sourceUrl":"","originalText":"","prepMinutes":null,"cookMinutes":null,"servings":2,"cuisine":"","mealType":"dinner","diet":"meat","tags":[],"ingredients":[{"name":"x","quantity":{"kind":"unparsed","originalText":"x"},"optional":false}],"steps":["s"]}'::jsonb, 'create') $$,
  null, 'bob cannot write into alice''s household');
select tests.act_as('a0000000-0000-4000-8000-000000000001');

-- ===================== meal plans =====================
select public.save_meal_plan('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', $j${
  "id": "d1000000-0000-4000-8000-000000000001", "weekStart": "2026-10-19", "mealTypes": ["lunch", "dinner"], "status": "draft",
  "budgetPence": 5000, "prompt": "cheap week", "proposalId": "prop-1",
  "entries": {
    "2026-10-19|dinner": {"kind": "recipe", "recipeId": "a1000000-0000-4000-8000-000000000002", "servings": 4, "note": "big pot"},
    "2026-10-20|lunch": {"kind": "leftovers"},
    "2026-10-21|dinner": {"kind": "eating_out", "note": "pizza"}
  }}$j$::jsonb);
select tests.is((select count(*) from public.planned_meals where meal_plan_id = 'd1000000-0000-4000-8000-000000000001'), 3, 'three planned meals');
select tests.ok((select end_date = date '2026-10-25' and constraints = '{"mealTypes":["lunch","dinner"],"proposalId":"prop-1"}'::jsonb
                   from public.meal_plans where id = 'd1000000-0000-4000-8000-000000000001'), 'week range + constraints snapshot');
select tests.ok((select (p -> 'plan' ->> 'status') = 'draft' and jsonb_array_length(p -> 'meals') = 3
                   from (select public.select_meal_plans('aa000000-0000-4000-8000-0000000000aa', null, date '2026-10-19') -> 0 as p) s), 'select by week');

-- re-save in place: ids survive, removed slot goes, approval stamps approved_at
select set_config('app.kept_meal', (select id::text from public.planned_meals
  where meal_plan_id = 'd1000000-0000-4000-8000-000000000001' and meal_date = date '2026-10-19'), true);
select public.save_meal_plan('aa000000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', $j${
  "id": "d1000000-0000-4000-8000-000000000001", "weekStart": "2026-10-19", "mealTypes": ["lunch", "dinner"], "status": "approved",
  "entries": {"2026-10-19|dinner": {"kind": "recipe", "recipeId": "a1000000-0000-4000-8000-000000000002", "servings": 6}}}$j$::jsonb);
select tests.is((select count(*) from public.planned_meals where meal_plan_id = 'd1000000-0000-4000-8000-000000000001'), 1, 'removed slots deleted');
select tests.ok((select pm.id::text = current_setting('app.kept_meal') and pm.servings = 6 and pm.approved and pm.notes is null
                   from public.planned_meals pm where pm.meal_plan_id = 'd1000000-0000-4000-8000-000000000001'),
  'existing slot updated in place (id kept)');
select tests.ok((select status = 'approved' and approved_at is not null and approved_by = 'a0000000-0000-4000-8000-000000000001'
                   from public.meal_plans where id = 'd1000000-0000-4000-8000-000000000001'), 'approved stamps approved_at/by');

-- another plan for the same week archives the first
select public.save_meal_plan('aa000000-0000-4000-8000-0000000000aa', null, $j${
  "id": "d1000000-0000-4000-8000-000000000002", "weekStart": "2026-10-19", "mealTypes": ["dinner"], "status": "draft", "entries": {}}$j$::jsonb);
select tests.ok((select status = 'archived' from public.meal_plans where id = 'd1000000-0000-4000-8000-000000000001'), 'same-week plan archived, not deleted');
select tests.is((select count(*) from public.planned_meals where meal_plan_id = 'd1000000-0000-4000-8000-000000000001'), 1, 'archived plan keeps its meals');
select tests.is(jsonb_array_length(public.select_meal_plans('aa000000-0000-4000-8000-0000000000aa')), 1, 'archived plans are not listed');
select tests.throws($$ select public.save_meal_plan('bb000000-0000-4000-8000-0000000000bb', null,
  '{"id":"d1000000-0000-4000-8000-000000000002","weekStart":"2026-10-19","mealTypes":[],"status":"draft","entries":{}}'::jsonb) $$,
  null, 'a plan id cannot be re-pointed at another household');

-- ===================== pantry =====================
select public.replace_pantry_items('aa000000-0000-4000-8000-0000000000aa', $j$[
  {"id": "e1000000-0000-4000-8000-000000000001", "ingredient_id": "11000000-0000-4000-8000-000000000002", "display_name": "onion",
   "quantity_kind": "exact", "quantity_value": 3, "unit": "item", "original_text": "3", "expires_on": "2026-11-01",
   "source": "manual", "source_event_ids": ["ee000000-0000-4000-8000-000000000001"], "stock_updated_at": "2026-10-10T09:00:00+00:00"},
  {"id": "e1000000-0000-4000-8000-000000000002", "ingredient_id": "99999999-0000-4000-8000-000000000009", "display_name": "mystery tin",
   "quantity_kind": "approximate", "approx_label": "tin", "original_text": "a tin", "source": "purchase", "stock_updated_at": "2026-10-11T09:00:00+00:00"}
]$j$::jsonb);
select tests.is((select count(*) from public.pantry_items where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 2, 'two pantry rows');
select tests.ok((select ingredient_id is null from public.pantry_items where display_name = 'mystery tin'), 'unknown ingredient id stored as NULL');
update public.pantry_items set notes = 'keep me' where display_name = 'onion';
select public.replace_pantry_items('aa000000-0000-4000-8000-0000000000aa', $j$[
  {"id": "e1000000-0000-4000-8000-000000000001", "ingredient_id": "11000000-0000-4000-8000-000000000002", "display_name": "onion",
   "quantity_kind": "exact", "quantity_value": 2, "unit": "item", "original_text": "2", "expires_on": "2026-11-01",
   "source": "manual", "source_event_ids": ["ee000000-0000-4000-8000-000000000001"], "stock_updated_at": "2026-10-10T09:00:00+00:00"}
]$j$::jsonb);
select tests.is((select count(*) from public.pantry_items where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 1, 'rows absent from the list are deleted');
select tests.ok((select quantity_value = 2 and notes = 'keep me' and stock_updated_at = timestamptz '2026-10-10T09:00:00+00:00'
                   and source_event_ids = array['ee000000-0000-4000-8000-000000000001']::uuid[]
                   from public.pantry_items where display_name = 'onion'),
  'upsert keeps unmodelled columns and the engine''s own lastUpdated (not the trigger''s updated_at)');

-- settings + handled events
insert into public.pantry_settings (household_id, purchase_mode, stale_after_days) values ('aa000000-0000-4000-8000-0000000000aa', 'auto', 21);
select tests.throws($$ insert into public.pantry_settings (household_id, purchase_mode) values ('aa000000-0000-4000-8000-0000000000aa', 'sometimes') $$, null, 'bad purchase_mode rejected');
insert into public.pantry_handled_events (household_id, purchase_event_id) values ('aa000000-0000-4000-8000-0000000000aa', 'ee000000-0000-4000-8000-000000000001');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.pantry_settings), 0, 'bob cannot read alice''s pantry settings');
select tests.is((select count(*) from public.pantry_handled_events), 0, 'bob cannot read alice''s handled events');
select tests.is(tests.affected($$ delete from public.pantry_items $$), 0, 'bob cannot delete alice''s pantry rows');
select public.replace_pantry_items('aa000000-0000-4000-8000-0000000000aa', '[]'::jsonb);
select tests.reset_actor();
select tests.is((select count(*) from public.pantry_items where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 1,
  'bob replacing alice''s pantry with [] deletes nothing (RLS)');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select public.replace_pantry_items('aa000000-0000-4000-8000-0000000000aa',
  '[{"id":"e1000000-0000-4000-8000-0000000000ff","display_name":"x","quantity_kind":"unparsed","source":"manual"}]'::jsonb) $$,
  null, 'bob cannot insert pantry rows into alice''s household');

rollback;
