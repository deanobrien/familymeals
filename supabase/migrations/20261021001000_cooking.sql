-- PRJ-018 P1-A Cooking (D360-D369): cooked history, per-cook notes (private or household) and "don't suggest again".
-- Additive only. A member's current rating stays in recipe_ratings (household mean = recipes.rating, sorting by rating);
-- marking a recipe cooked with a rating upserts it there, so nothing about ratings changes for existing readers.
--
--   recipe_cooked       {recipe, member, cooked_at, servings, rating?}     household-visible history, self-written
--   recipe_cook_notes   {cooked event, note, is_private}                   private notes are readable only by their author
--   recipe_dont_suggest {recipe, member}                                   the planner skips these recipes (soft hide)
--
-- Composite FKs (recipe_id, household_id) keep every row in the recipe's own household. Writes need a writable household
-- (not pending deletion); a member who leaves takes their cooking rows with them (trigger below), like favourites.

create table public.recipe_cooked (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id    uuid not null,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cooked_at    timestamptz not null default now(),
  servings     smallint not null check (servings between 1 and 100),
  rating       smallint check (rating is null or rating between 1 and 5),
  created_at   timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  unique (id, household_id)
);
create index recipe_cooked_recipe_idx on public.recipe_cooked (household_id, recipe_id, cooked_at desc);
create index recipe_cooked_user_idx on public.recipe_cooked (household_id, user_id);

create table public.recipe_cook_notes (
  cooked_id    uuid primary key,
  household_id uuid not null,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note         text not null check (char_length(btrim(note)) between 1 and 1000),
  is_private   boolean not null default true,
  created_at   timestamptz not null default now(),
  foreign key (cooked_id, household_id) references public.recipe_cooked (id, household_id) on delete cascade
);
create index recipe_cook_notes_household_idx on public.recipe_cook_notes (household_id, user_id);

create table public.recipe_dont_suggest (
  recipe_id    uuid not null,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  household_id uuid not null,
  created_at   timestamptz not null default now(),
  primary key (recipe_id, user_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_dont_suggest_household_idx on public.recipe_dont_suggest (household_id);

alter table public.recipe_cooked enable row level security;
alter table public.recipe_cook_notes enable row level security;
alter table public.recipe_dont_suggest enable row level security;
revoke all on public.recipe_cooked, public.recipe_cook_notes, public.recipe_dont_suggest from anon;
grant select, insert, update, delete on public.recipe_cooked, public.recipe_cook_notes, public.recipe_dont_suggest to authenticated;

-- History and the "don't suggest" flag are household-visible and self-written (the planner needs everyone's flags).
do $$
declare t text;
begin
  foreach t in array array['recipe_cooked', 'recipe_dont_suggest'] loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (user_id = auth.uid() and public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                     using (user_id = auth.uid() and public.is_household_writable(household_id))
                     with check (user_id = auth.uid() and public.is_household_writable(household_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (user_id = auth.uid() and public.is_household_writable(household_id))$f$, t);
  end loop;
end
$$;

-- Notes: a private note is visible to its author only; a household note to every member.
create policy recipe_cook_notes_select on public.recipe_cook_notes for select to authenticated
  using (public.is_household_member(household_id) and (not is_private or user_id = auth.uid()));
create policy recipe_cook_notes_insert on public.recipe_cook_notes for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_writable(household_id)
              and exists (select 1 from public.recipe_cooked c where c.id = cooked_id and c.household_id = recipe_cook_notes.household_id and c.user_id = auth.uid()));
create policy recipe_cook_notes_update on public.recipe_cook_notes for update to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id))
  with check (user_id = auth.uid() and public.is_household_writable(household_id));
create policy recipe_cook_notes_delete on public.recipe_cook_notes for delete to authenticated
  using (user_id = auth.uid() and public.is_household_writable(household_id));

-- One round trip for the cards: how often and when each recipe was last cooked (household-wide). SECURITY INVOKER: RLS
-- applies, and the household id is also checked, so a service-role caller stays household-scoped.
create or replace function public.recipe_cook_summaries(p_household_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('recipeId', s.recipe_id, 'cookedCount', s.n, 'lastCookedAt', s.last_at) order by s.recipe_id), '[]'::jsonb)
    from (select c.recipe_id, count(*)::int as n, max(c.cooked_at) as last_at
            from public.recipe_cooked c where c.household_id = p_household_id group by c.recipe_id) s
$$;
revoke all on function public.recipe_cook_summaries(uuid) from public;
grant execute on function public.recipe_cook_summaries(uuid) to authenticated;

-- A member who leaves (or is removed, or deletes their account) takes their cooking rows with them: history, notes (private
-- ones especially) and flags. Fires on the status change every leave / removal / deletion path already makes.
create or replace function public.cooking_member_left()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.recipe_cook_notes where household_id = new.household_id and user_id = new.user_id;
  delete from public.recipe_cooked where household_id = new.household_id and user_id = new.user_id;
  delete from public.recipe_dont_suggest where household_id = new.household_id and user_id = new.user_id;
  return new;
end
$$;
revoke all on function public.cooking_member_left() from public, anon, authenticated;
create trigger household_members_cooking_left after update of status on public.household_members
  for each row when (old.status is distinct from new.status and new.status in ('left', 'revoked'))
  execute function public.cooking_member_left();
