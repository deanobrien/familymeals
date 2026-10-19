-- PRJ-018 schema v1 — 0015 repository support (lane S1: recipes, meal plans, pantry) — DECISIONS D50-D59.
--
-- The web app's repositories (apps/web/lib/server/supabase) talk to Postgres through RPCs so that every multi-table
-- write is ONE transaction and so the read shape is tested here (PGlite) rather than guessed from PostgREST embeds.
-- All functions are SECURITY INVOKER: RLS (member select, writable-household insert/update/delete) still applies to
-- every table they touch. Callers also pass household_id explicitly and every statement filters by it, so a
-- service-role client (RLS bypassed) is still household-scoped.

-- ---------------------------------------------------------------------------
-- Column additions
-- ---------------------------------------------------------------------------
-- recipe_ingredients keeps the line text as written in `original_text` (quantity text) but had nowhere to keep the
-- ingredient NAME for unmatched lines (ingredient_id NULL). display_name carries it.
alter table public.recipe_ingredients
  add column display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 200);

-- pantry_items.updated_at is bumped by the set_updated_at trigger on EVERY write, so it cannot carry the engine's
-- "last confirmed" instant (replacing unchanged items would make all stock look fresh). stock_updated_at does.
alter table public.pantry_items
  add column stock_updated_at timestamptz not null default now(),
  add column source_event_ids uuid[] not null default '{}';

-- Search text must include the display name (unmatched lines have no ingredients.name).
create or replace function public.refresh_recipe_search(p_recipe_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.recipes r set
    search_ingredients = coalesce((
      select string_agg(coalesce(i.name || ' ', '') || coalesce(ri.display_name || ' ', '') || ri.original_text, ' ' order by ri.position)
        from public.recipe_ingredients ri
        left join public.ingredients i on i.id = ri.ingredient_id
       where ri.recipe_id = p_recipe_id), ''),
    search_tags = coalesce((
      select string_agg(t.name, ' ' order by t.name)
        from public.recipe_tag_links l join public.recipe_tags t on t.id = l.tag_id
       where l.recipe_id = p_recipe_id), '')
  where r.id = p_recipe_id
$$;

-- ---------------------------------------------------------------------------
-- New household tables: pantry settings + handled purchase events
-- ---------------------------------------------------------------------------
create table public.pantry_settings (
  household_id      uuid primary key references public.households (id) on delete cascade,
  purchase_mode     text not null default 'suggest' check (purchase_mode in ('off', 'suggest', 'auto')),
  stale_after_days  integer not null default 14 check (stale_after_days between 1 and 3650),
  updated_at        timestamptz not null default now()
);
create trigger pantry_settings_set_updated_at before update on public.pantry_settings
  for each row execute function public.set_updated_at();

-- Purchase events already applied to / dismissed from the pantry (so they are never suggested twice).
-- No FK to purchase_events on purpose: purchase history is append-only and owned by the shopping lane.
create table public.pantry_handled_events (
  household_id       uuid not null references public.households (id) on delete cascade,
  purchase_event_id  uuid not null,
  handled_at         timestamptz not null default now(),
  primary key (household_id, purchase_event_id)
);

alter table public.pantry_settings enable row level security;
alter table public.pantry_handled_events enable row level security;
revoke all on public.pantry_settings, public.pantry_handled_events from anon;
grant select, insert, update, delete on public.pantry_settings, public.pantry_handled_events to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pantry_settings', 'pantry_handled_events'] loop
    execute format($f$create policy %1$s_member_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_insert on public.%1$I for insert to authenticated
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_member_update on public.%1$I for update to authenticated
                     using (public.is_household_writable(household_id))
                     with check (public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_member_delete on public.%1$I for delete to authenticated
                     using (public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Normalisers shared with the in-memory repository (duplicate detection)
-- ---------------------------------------------------------------------------
create or replace function public.fr_norm_title(p text)
returns text language sql immutable
set search_path = ''
as $$
  select btrim(regexp_replace(replace(lower(coalesce(p, '')), '(copy)', ''), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.fr_norm_ingredient(p text)
returns text language sql immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Recipe read model: one jsonb document per recipe, ROW-shaped (snake_case columns) so the app maps it with the
-- @fr/domain row schemas. Extras: ingredients[], steps[], tags[], favourite, rating, original_text, image_url, nutrition.
--   * favourite  = p_user_id has favourited it (favourites are per member)
--   * rating     = household mean of member ratings (1 dp), null when unrated
--   * original_text = earliest non-blank corrected.originalText across versions (write-once)
--   * image_url  = cover_image_path, else the latest version's corrected.imageUrl (external URLs have no storage path)
-- ---------------------------------------------------------------------------
create or replace function public.recipe_view_json(p_recipe_id uuid, p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select (to_jsonb(r) - 'search_tsv' - 'search_ingredients' - 'search_tags')
    || jsonb_build_object(
      'ingredients', coalesce((select jsonb_agg(to_jsonb(ri) order by ri.position)
                                 from public.recipe_ingredients ri where ri.recipe_id = r.id), '[]'::jsonb),
      'steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.step_number)
                           from public.recipe_steps s where s.recipe_id = r.id), '[]'::jsonb),
      'tags', coalesce((select jsonb_agg(t.name order by t.name)
                          from public.recipe_tag_links l join public.recipe_tags t on t.id = l.tag_id
                         where l.recipe_id = r.id), '[]'::jsonb),
      'favourite', exists (select 1 from public.recipe_favourites f where f.recipe_id = r.id and f.user_id = p_user_id),
      'rating', (select round(avg(rt.rating)::numeric, 1) from public.recipe_ratings rt where rt.recipe_id = r.id),
      'original_text', coalesce((select v.corrected ->> 'originalText' from public.recipe_versions v
                                  where v.recipe_id = r.id and coalesce(v.corrected ->> 'originalText', '') <> ''
                                  order by v.version_no asc limit 1), ''),
      'image_url', coalesce(r.cover_image_path, (select v.corrected ->> 'imageUrl' from public.recipe_versions v
                                                  where v.recipe_id = r.id order by v.version_no desc limit 1)),
      'nutrition', (select jsonb_build_object(
                      'servings', np.servings,
                      'values', coalesce((select jsonb_agg(to_jsonb(nv) order by nv.nutrient)
                                            from public.nutrition_profile_values nv
                                           where nv.nutrition_profile_id = np.id), '[]'::jsonb))
                      from public.nutrition_profiles np
                     where np.recipe_id = r.id and np.basis = 'per_serving'
                     order by np.calculated_at desc limit 1)
    )
  from public.recipes r
  where r.id = p_recipe_id
$$;

create or replace function public.get_recipes(p_household_id uuid, p_user_id uuid, p_ids uuid[])
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.recipe_view_json(r.id, p_user_id) order by r.title, r.id), '[]'::jsonb)
    from public.recipes r
   where r.household_id = p_household_id and r.status <> 'archived' and r.id = any (p_ids)
$$;

-- ---------------------------------------------------------------------------
-- list_recipes: search + filters + sort + paging, all in SQL. Returns {total, items[]}.
--   p_query     ranked like search_recipes(): FTS OR trigram similarity over title / ingredients / tags
--   p_collection  favourites | quick | budget | vegetarian   (budget needs a cost cache: none yet -> matches nothing)
--   p_sort      name | recent | cost | rating | prep         (cost: no cost cache yet, so falls back to name)
-- ---------------------------------------------------------------------------
create or replace function public.list_recipes(
  p_household_id uuid,
  p_user_id      uuid,
  p_query        text default '',
  p_cuisine      text default null,
  p_meal_type    public.meal_type default null,
  p_max_prep     integer default null,
  p_diet         public.diet_category default null,
  p_tags         text[] default '{}',
  p_collection   text default null,
  p_sort         text default 'name',
  p_limit        integer default 12,
  p_offset       integer default 0
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_tsq   tsquery := pg_catalog.websearch_to_tsquery('english'::regconfig, coalesce(p_query, ''));
  v_q     text := coalesce(btrim(p_query), '');
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 10000);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  with filtered as (
  select row_number() over (
           order by
             case when p_sort = 'recent' then r.created_at end desc nulls last,
             case when p_sort = 'rating' then (select avg(rt.rating) from public.recipe_ratings rt where rt.recipe_id = r.id) end desc nulls last,
             case when p_sort = 'prep' then r.prep_minutes end asc nulls last,
             lower(r.title) asc, r.id asc) as rn,
         r.id
    from public.recipes r
   where r.household_id = p_household_id
     and r.status <> 'archived'
     and (v_q = ''
          or r.search_tsv @@ v_tsq
          or extensions.word_similarity(v_q, r.title) > 0.3
          or extensions.word_similarity(v_q, r.search_ingredients) > 0.4
          or extensions.word_similarity(v_q, r.search_tags) > 0.4)
     and (p_cuisine is null or lower(r.cuisine) = lower(p_cuisine))
     and (p_meal_type is null or r.meal_type = p_meal_type)
     and (p_max_prep is null or (r.prep_minutes is not null and r.prep_minutes <= p_max_prep))
     and (p_diet is null or r.diet_category = p_diet)
     and not exists (
           select 1 from unnest(coalesce(p_tags, '{}'::text[])) want(tag)
            where not exists (select 1 from public.recipe_tag_links l join public.recipe_tags t on t.id = l.tag_id
                               where l.recipe_id = r.id and lower(t.name) = lower(want.tag)))
     and case coalesce(p_collection, '')
           when 'favourites' then exists (select 1 from public.recipe_favourites f where f.recipe_id = r.id and f.user_id = p_user_id)
           when 'quick' then (r.prep_minutes is not null or r.cook_minutes is not null)
                             and coalesce(r.prep_minutes, 0) + coalesce(r.cook_minutes, 0) <= 30
           when 'vegetarian' then r.diet_category in ('vegetarian', 'vegan')
           when 'budget' then false
           else true
         end
  )
  select (select count(*) from filtered),
         coalesce((select jsonb_agg(public.recipe_view_json(f.id, p_user_id) order by f.rn)
                     from filtered f where f.rn > v_off and f.rn <= v_off + v_limit), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('total', v_total, 'items', v_items);
end
$$;

-- Distinct tags (with counts) and cuisines of the household's live recipes.
create or replace function public.recipe_facets(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', x.tag, 'count', x.n) order by x.n desc, x.tag asc)
                        from (select lower(t.name) as tag, count(distinct l.recipe_id) as n
                                from public.recipe_tag_links l
                                join public.recipe_tags t on t.id = l.tag_id
                                join public.recipes r on r.id = l.recipe_id
                               where r.household_id = p_household_id and r.status <> 'archived'
                               group by lower(t.name)) x), '[]'::jsonb),
    'cuisines', coalesce((select jsonb_agg(c.cuisine order by lower(c.cuisine))
                            from (select distinct r.cuisine from public.recipes r
                                   where r.household_id = p_household_id and r.status <> 'archived'
                                     and coalesce(btrim(r.cuisine), '') <> '') c), '[]'::jsonb))
$$;

-- Same-title (normalised) or near-identical ingredient set (Jaccard >= 0.8 over >= 3 names).
create or replace function public.find_recipe_duplicates(
  p_household_id uuid, p_user_id uuid, p_title text, p_names text[], p_exclude uuid default null)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_title text := nullif(public.fr_norm_title(p_title), '');
  v_names text[];
  v_out   jsonb := '[]'::jsonb;
  r       record;
  v_inter integer;
  v_union integer;
  v_theirs text[];
begin
  select coalesce(array_agg(distinct n), '{}') into v_names
    from (select nullif(public.fr_norm_ingredient(x), '') as n from unnest(coalesce(p_names, '{}'::text[])) x) s
   where n is not null;

  for r in
    select rc.id, rc.title from public.recipes rc
     where rc.household_id = p_household_id and rc.status <> 'archived' and rc.id is distinct from p_exclude
     order by rc.title, rc.id
  loop
    if v_title is not null and public.fr_norm_title(r.title) = v_title then
      v_out := v_out || jsonb_build_array(public.recipe_view_json(r.id, p_user_id));
      continue;
    end if;
    if coalesce(cardinality(v_names), 0) >= 3 then
      select coalesce(array_agg(distinct n), '{}') into v_theirs
        from (select nullif(public.fr_norm_ingredient(coalesce(ri.display_name, ri.original_text)), '') as n
                from public.recipe_ingredients ri where ri.recipe_id = r.id) s
       where n is not null;
      select count(*) into v_inter from unnest(v_names) a(n) where a.n = any (v_theirs);
      select count(*) into v_union from (select unnest(v_names) union select unnest(v_theirs)) u;
      if v_union > 0 and v_inter::numeric / v_union >= 0.8 then
        v_out := v_out || jsonb_build_array(public.recipe_view_json(r.id, p_user_id));
      end if;
    end if;
  end loop;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- save_recipe: create or update recipes + recipe_ingredients + recipe_steps + tags + a new recipe_versions row,
-- atomically. p_input is the web RecipeInput (camelCase jsonb). Returns the recipe view, or NULL when p_mode =
-- 'update' and the recipe does not exist in the household (or is archived).
--   * originalText is write-once: the earliest non-blank value ever stored wins (later input is ignored)
--   * ingredientId not sent back -> carried over from the previous line with the same name
--   * ingredient ids unknown to public.ingredients are stored as NULL (line kept, unmatched)
--   * editing the ingredient lines drops the recipe's calculated nutrition cache (the engine recomputes it)
-- ---------------------------------------------------------------------------
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
           where i.id::text = coalesce(
                   case when lower(e.value ->> 'ingredientId') ~ v_uuid_re then lower(e.value ->> 'ingredientId') end,
                   v_prev ->> (e.value ->> 'name'))),
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

-- ---------------------------------------------------------------------------
-- Meal plans. PlanDoc (web) <-> meal_plans + planned_meals.
--   * week = start_date .. start_date + 6; PlanDoc.mealTypes / proposalId live in meal_plans.constraints
--   * one managed planned_meal per (date, meal_type) at position 0; saves UPDATE in place (ids survive, so shopping
--     provenance links to planned_meals are kept), insert new slots, delete slots no longer in the doc
--   * another live plan for the same household + week is ARCHIVED (history kept), not deleted
-- ---------------------------------------------------------------------------
create or replace function public.save_meal_plan(p_household_id uuid, p_user_id uuid, p_doc jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id     uuid := (p_doc ->> 'id')::uuid;
  v_start  date := (p_doc ->> 'weekStart')::date;
  v_status public.meal_plan_status := (p_doc ->> 'status')::public.meal_plan_status;
  v_actor  uuid := coalesce(p_user_id, auth.uid());
  e        record;
  v_kind   public.planned_meal_kind;
  v_recipe uuid;
  v_serv   integer;
  v_date   date;
  v_type   public.meal_type;
  v_note   text;
begin
  insert into public.meal_plans (id, household_id, start_date, end_date, budget_target_pence, planning_prompt, constraints,
                                 status, approved_at, approved_by, created_by)
  values (v_id, p_household_id, v_start, v_start + 6, (p_doc ->> 'budgetPence')::integer, nullif(p_doc ->> 'prompt', ''),
          jsonb_strip_nulls(jsonb_build_object('mealTypes', p_doc -> 'mealTypes', 'proposalId', p_doc -> 'proposalId')),
          v_status, case when v_status = 'approved' then now() end, case when v_status = 'approved' then v_actor end, v_actor)
  on conflict (id) do update set
    start_date = excluded.start_date, end_date = excluded.end_date,
    budget_target_pence = excluded.budget_target_pence, planning_prompt = excluded.planning_prompt,
    constraints = excluded.constraints, status = excluded.status,
    approved_at = case when excluded.status = 'approved' then coalesce(public.meal_plans.approved_at, now()) end,
    approved_by = case when excluded.status = 'approved' then coalesce(public.meal_plans.approved_by, v_actor) end
  where public.meal_plans.household_id = excluded.household_id;

  if not exists (select 1 from public.meal_plans where id = v_id and household_id = p_household_id) then
    raise exception 'meal plan % belongs to another household', v_id using errcode = 'insufficient_privilege';
  end if;

  update public.meal_plans set status = 'archived'
   where household_id = p_household_id and start_date = v_start and id <> v_id and status <> 'archived';

  -- drop slots that are no longer in the doc
  delete from public.planned_meals pm
   where pm.meal_plan_id = v_id and pm.household_id = p_household_id and pm.position = 0
     and not exists (select 1 from jsonb_each(coalesce(p_doc -> 'entries', '{}'::jsonb)) en
                      where split_part(en.key, '|', 1)::date = pm.meal_date
                        and split_part(en.key, '|', 2) = pm.meal_type::text);

  for e in select en.key, en.value from jsonb_each(coalesce(p_doc -> 'entries', '{}'::jsonb)) en loop
    v_date := split_part(e.key, '|', 1)::date;
    v_type := split_part(e.key, '|', 2)::public.meal_type;
    v_kind := case e.value ->> 'kind' when 'recipe' then 'recipe' when 'leftovers' then 'leftovers' else 'eating_out' end;
    v_recipe := case when v_kind = 'recipe' then (e.value ->> 'recipeId')::uuid end;
    v_serv := case when v_kind = 'recipe' then (e.value ->> 'servings')::integer else 1 end;
    v_note := nullif(e.value ->> 'note', '');
    update public.planned_meals set kind = v_kind, recipe_id = v_recipe, servings = v_serv, approved = (v_status = 'approved'), notes = v_note
     where meal_plan_id = v_id and household_id = p_household_id and position = 0 and meal_date = v_date and meal_type = v_type;
    if not found then
      insert into public.planned_meals (meal_plan_id, household_id, meal_date, meal_type, kind, recipe_id, servings, approved, notes, position)
      values (v_id, p_household_id, v_date, v_type, v_kind, v_recipe, v_serv, v_status = 'approved', v_note, 0);
    end if;
  end loop;
end
$$;

-- Live (non-archived) plans as [{plan, meals[]}], newest week first. Filters are optional.
create or replace function public.select_meal_plans(p_household_id uuid, p_id uuid default null, p_start_date date default null)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'plan', to_jsonb(p),
           'meals', coalesce((select jsonb_agg(to_jsonb(m) order by m.meal_date, m.meal_type, m.position)
                                from public.planned_meals m
                               where m.meal_plan_id = p.id and m.household_id = p.household_id and m.position = 0), '[]'::jsonb))
         order by p.start_date desc, p.updated_at desc), '[]'::jsonb)
    from public.meal_plans p
   where p.household_id = p_household_id and p.status <> 'archived'
     and (p_id is null or p.id = p_id)
     and (p_start_date is null or p.start_date = p_start_date)
$$;

-- ---------------------------------------------------------------------------
-- Pantry: atomic replace of the household's stock (the engine produces whole-list results).
-- Rows absent from p_items are deleted; present rows are upserted (id-keyed, household-guarded). Columns the engine
-- does not model (notes, product_pack_id, receipt_line_id, created_by) are preserved on existing rows.
-- ---------------------------------------------------------------------------
create or replace function public.replace_pantry_items(p_household_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.pantry_items pi
   where pi.household_id = p_household_id
     and pi.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x);

  insert into public.pantry_items (id, household_id, ingredient_id, display_name, quantity_kind, quantity_value, quantity_min,
                                   quantity_max, unit, approx_label, original_text, expires_on, source, source_event_ids, stock_updated_at)
  select x.id, p_household_id,
         (select i.id from public.ingredients i where i.id = x.ingredient_id),
         x.display_name, x.quantity_kind, x.quantity_value, x.quantity_min, x.quantity_max, x.unit, x.approx_label,
         coalesce(x.original_text, ''), x.expires_on, x.source, coalesce(x.source_event_ids, '{}'), coalesce(x.stock_updated_at, now())
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(
      id uuid, ingredient_id uuid, display_name text, quantity_kind public.quantity_kind, quantity_value numeric,
      quantity_min numeric, quantity_max numeric, unit public.unit, approx_label text, original_text text,
      expires_on date, source public.pantry_source, source_event_ids uuid[], stock_updated_at timestamptz)
  on conflict (id) do update set
    ingredient_id = excluded.ingredient_id, display_name = excluded.display_name, quantity_kind = excluded.quantity_kind,
    quantity_value = excluded.quantity_value, quantity_min = excluded.quantity_min, quantity_max = excluded.quantity_max,
    unit = excluded.unit, approx_label = excluded.approx_label, original_text = excluded.original_text,
    expires_on = excluded.expires_on, source = excluded.source, source_event_ids = excluded.source_event_ids,
    stock_updated_at = excluded.stock_updated_at
  where public.pantry_items.household_id = excluded.household_id;
end
$$;

grant execute on function
  public.recipe_view_json(uuid, uuid),
  public.get_recipes(uuid, uuid, uuid[]),
  public.list_recipes(uuid, uuid, text, text, public.meal_type, integer, public.diet_category, text[], text, text, integer, integer),
  public.recipe_facets(uuid),
  public.find_recipe_duplicates(uuid, uuid, text, text[], uuid),
  public.save_recipe(uuid, uuid, uuid, jsonb, text),
  public.save_meal_plan(uuid, uuid, jsonb),
  public.select_meal_plans(uuid, uuid, date),
  public.replace_pantry_items(uuid, jsonb)
to authenticated;
