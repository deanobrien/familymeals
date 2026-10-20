-- IL1 (D223): save_recipe learns an explicit "not in the ingredient list".
-- Before: an ingredient line sent without a usable ingredientId always inherited the id of the previous line with the
-- same name, so a manual "not in list" choice came back on the next save. Now a line whose JSON carries the key
-- "ingredientId" with null or '' is stored UNLINKED and never carried over; a line without the key still inherits
-- (imports, duplicate, older clients) and a valid id still wins. Only the ingredient_id expression changed; the rest
-- of the function is identical to 20261019001520.
create or replace function public.save_recipe(
  p_household_id uuid, p_user_id uuid, p_id uuid, p_input jsonb, p_mode text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id        uuid := p_id;
  v_uuid_re   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_cover     text := nullif(btrim(coalesce(p_input ->> 'imageUrl', '')), '');
  v_prev      jsonb := '{}'::jsonb;
  v_before    text;
  v_after     text;
  v_orig      text;
  v_corrected jsonb;
  v_actor     uuid := coalesce(p_user_id, auth.uid());
begin
  if p_mode not in ('create', 'update') then
    raise exception 'save_recipe: bad mode %', p_mode;
  end if;
  -- a cover is only a storage path when it lives in the household folder; anything else is an external URL
  if v_cover is not null and v_cover not like p_household_id::text || '/%' then
    v_cover := null;
  end if;

  if p_mode = 'create' then
    v_id := coalesce(v_id, gen_random_uuid());
    insert into public.recipes (id, household_id, title, description, cover_image_path, source_url, source_attribution,
                                prep_minutes, cook_minutes, default_servings, cuisine, meal_type, diet_category, status, created_by)
    values (v_id, p_household_id, btrim(p_input ->> 'title'), nullif(p_input ->> 'description', ''), v_cover,
            nullif(p_input ->> 'sourceUrl', ''), nullif(p_input ->> 'sourceAttribution', ''),
            (p_input ->> 'prepMinutes')::integer, (p_input ->> 'cookMinutes')::integer,
            (p_input ->> 'servings')::smallint, nullif(p_input ->> 'cuisine', ''),
            (p_input ->> 'mealType')::public.meal_type, (p_input ->> 'diet')::public.diet_category, 'active', v_actor);
  else
    perform 1 from public.recipes r
      where r.id = v_id and r.household_id = p_household_id and r.status <> 'archived' for update;
    if not found then
      return null;
    end if;
    update public.recipes set
      title = btrim(p_input ->> 'title'), description = nullif(p_input ->> 'description', ''),
      cover_image_path = v_cover, source_url = nullif(p_input ->> 'sourceUrl', ''),
      source_attribution = nullif(p_input ->> 'sourceAttribution', ''),
      prep_minutes = (p_input ->> 'prepMinutes')::integer, cook_minutes = (p_input ->> 'cookMinutes')::integer,
      default_servings = (p_input ->> 'servings')::smallint, cuisine = nullif(p_input ->> 'cuisine', ''),
      meal_type = (p_input ->> 'mealType')::public.meal_type, diet_category = (p_input ->> 'diet')::public.diet_category,
      status = 'active'
     where id = v_id and household_id = p_household_id;
  end if;

  -- ingredient lines: replace, carrying over canonical ids for same-name lines, and detect real changes
  select coalesce(jsonb_object_agg(coalesce(ri.display_name, ri.original_text), ri.ingredient_id), '{}'::jsonb) into v_prev
    from public.recipe_ingredients ri where ri.recipe_id = v_id and ri.ingredient_id is not null;
  select md5(coalesce(jsonb_agg(jsonb_build_array(ri.display_name, ri.original_text, ri.quantity_kind, ri.quantity_value,
                                                    ri.quantity_min, ri.quantity_max, ri.unit, ri.optional) order by ri.position)::text, ''))
    into v_before from public.recipe_ingredients ri where ri.recipe_id = v_id;

  delete from public.recipe_ingredients where recipe_id = v_id and household_id = p_household_id;
  insert into public.recipe_ingredients (recipe_id, household_id, ingredient_id, display_name, original_text, quantity_kind,
                                         quantity_value, quantity_min, quantity_max, unit, approx_label, preparation, optional, position)
  select v_id, p_household_id,
         (select i.id from public.ingredients i
           where i.id::text = case
                   when (e.value ? 'ingredientId') and coalesce(btrim(e.value ->> 'ingredientId'), '') = '' then null
                   else coalesce(
                     case when lower(e.value ->> 'ingredientId') ~ v_uuid_re then lower(e.value ->> 'ingredientId') end,
                     v_prev ->> (e.value ->> 'name'))
                 end),
         btrim(e.value ->> 'name'),
         coalesce(nullif(btrim(e.value #>> '{quantity,originalText}'), ''), btrim(e.value ->> 'name')),
         (e.value #>> '{quantity,kind}')::public.quantity_kind,
         (e.value #>> '{quantity,value}')::numeric, (e.value #>> '{quantity,min}')::numeric,
         (e.value #>> '{quantity,max}')::numeric, (e.value #>> '{quantity,unit}')::public.unit,
         nullif(e.value #>> '{quantity,approxLabel}', ''), nullif(e.value ->> 'preparation', ''),
         coalesce((e.value ->> 'optional')::boolean, false), (e.ord - 1)::integer
    from jsonb_array_elements(p_input -> 'ingredients') with ordinality as e(value, ord);
  select md5(coalesce(jsonb_agg(jsonb_build_array(ri.display_name, ri.original_text, ri.quantity_kind, ri.quantity_value,
                                                    ri.quantity_min, ri.quantity_max, ri.unit, ri.optional) order by ri.position)::text, ''))
    into v_after from public.recipe_ingredients ri where ri.recipe_id = v_id;
  if p_mode = 'update' and v_before is distinct from v_after then
    delete from public.nutrition_profiles where recipe_id = v_id and household_id = p_household_id;
  end if;

  -- steps
  delete from public.recipe_steps where recipe_id = v_id and household_id = p_household_id;
  insert into public.recipe_steps (recipe_id, household_id, step_number, instructions)
  select v_id, p_household_id, e.ord::integer, btrim(e.value #>> '{}')
    from jsonb_array_elements(p_input -> 'steps') with ordinality as e(value, ord);

  -- tags (household vocabulary, case-insensitive, stored lower-case)
  delete from public.recipe_tag_links where recipe_id = v_id and household_id = p_household_id;
  insert into public.recipe_tags (household_id, name)
  select distinct p_household_id, lower(btrim(e.value #>> '{}'))
    from jsonb_array_elements(coalesce(p_input -> 'tags', '[]'::jsonb)) e
   where btrim(e.value #>> '{}') <> ''
  on conflict (household_id, lower(name)) do nothing;
  insert into public.recipe_tag_links (recipe_id, tag_id, household_id)
  select distinct v_id, t.id, p_household_id
    from jsonb_array_elements(coalesce(p_input -> 'tags', '[]'::jsonb)) e
    join public.recipe_tags t on t.household_id = p_household_id and lower(t.name) = lower(btrim(e.value #>> '{}'))
   where btrim(e.value #>> '{}') <> '';

  -- new immutable version snapshot (originalText write-once)
  v_orig := coalesce((select v.corrected ->> 'originalText' from public.recipe_versions v
                       where v.recipe_id = v_id and coalesce(v.corrected ->> 'originalText', '') <> ''
                       order by v.version_no asc limit 1),
                     coalesce(p_input ->> 'originalText', ''));
  v_corrected := p_input || jsonb_build_object('originalText', v_orig);
  insert into public.recipe_versions (recipe_id, household_id, version_no, corrected, created_by)
  values (v_id, p_household_id,
          coalesce((select max(v.version_no) from public.recipe_versions v where v.recipe_id = v_id), 0) + 1,
          v_corrected, v_actor);

  return public.recipe_view_json(v_id, p_user_id);
end
$$;
