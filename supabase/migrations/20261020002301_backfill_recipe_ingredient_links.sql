-- IL1 (D225): one-off, idempotent, conservative backfill of canonical ingredient links on EXISTING household recipes.
-- Recipes saved through the form before IL1 carry display_name only (ingredient_id NULL), so they cost partially,
-- show unknown nutrition and fail safe in the planner when allergies are set. Link a NULL line ONLY when its
-- lower-cased, trimmed display name equals EXACTLY ONE ingredient (by name or alias, case-insensitive). Anything
-- ambiguous, plural-only ("onions") or fuzzy is left alone: the app's "Re-match ingredients" action (engine matcher,
-- D225) handles those and a person confirms the rest. Existing links and explicit "not in list" lines that were
-- re-saved are never touched by a second run beyond the same exact rule (an unlinked line that exactly equals a
-- catalogue name can only be there because the catalogue grew since it was saved). Nutrition caches of changed
-- recipes are dropped so the engine recomputes them.
with candidates as (
  select ri.id as line_id, ri.recipe_id, ri.household_id, i.id as ingredient_id,
         count(*) over (partition by ri.id) as n
    from public.recipe_ingredients ri
    join (
      select lower(btrim(name)) as k, id from public.ingredients
      union
      select lower(btrim(alias)), ingredient_id from public.ingredient_aliases
    ) i on i.k = lower(btrim(ri.display_name))
   where ri.ingredient_id is null
), unique_hits as (
  select line_id, recipe_id, household_id, ingredient_id from candidates where n = 1
), linked as (
  update public.recipe_ingredients ri
     set ingredient_id = u.ingredient_id
    from unique_hits u
   where ri.id = u.line_id
  returning ri.recipe_id, ri.household_id
)
delete from public.nutrition_profiles np
 using (select distinct recipe_id, household_id from linked) l
 where np.recipe_id = l.recipe_id and np.household_id = l.household_id;
