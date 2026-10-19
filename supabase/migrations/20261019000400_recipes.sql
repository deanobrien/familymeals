-- PRJ-018 schema v1 — 0004 recipes:
-- recipes (no `method` column — steps only, per review), recipe_versions (jsonb original/corrected),
-- recipe_images, recipe_ingredients (quantity_kind + min/max), recipe_steps, recipe_tags/links,
-- recipe_favourites, recipe_ratings, and search (full-text + trigram over title/ingredients/tags).
--
-- Child tables carry household_id with a composite FK (recipe_id, household_id) -> recipes(id, household_id)
-- so a row can never point at another household's recipe even if a policy were mis-written.

create table public.recipes (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  title               text not null check (char_length(btrim(title)) between 1 and 200),
  description         text check (description is null or char_length(description) <= 4000),
  cover_image_path    text,
  source_url          text check (source_url is null or source_url ~* '^https?://'),
  source_attribution  text check (source_attribution is null or char_length(source_attribution) <= 300),
  prep_minutes        integer check (prep_minutes is null or prep_minutes between 0 and 10080),
  cook_minutes        integer check (cook_minutes is null or cook_minutes between 0 and 10080),
  default_servings    smallint not null default 4 check (default_servings between 1 and 100),
  cuisine             text check (cuisine is null or char_length(cuisine) <= 60),
  meal_type           public.meal_type,
  diet_category       public.diet_category,
  status              public.recipe_status not null default 'draft',
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- denormalised search inputs maintained by triggers on recipe_ingredients / recipe_tag_links
  search_ingredients  text not null default '',
  search_tags         text not null default '',
  search_tsv          tsvector generated always as (
      setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
   || setweight(to_tsvector('english'::regconfig, search_ingredients), 'B')
   || setweight(to_tsvector('english'::regconfig, search_tags), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'C')
  ) stored,
  unique (id, household_id),
  check (cover_image_path is null or cover_image_path like household_id::text || '/%')
);
create index recipes_household_idx on public.recipes (household_id, status, updated_at desc);
create index recipes_household_title_idx on public.recipes (household_id, lower(title)); -- duplicate detection
create index recipes_search_tsv_idx on public.recipes using gin (search_tsv);
create index recipes_title_trgm_idx on public.recipes using gin (title extensions.gin_trgm_ops);
create index recipes_ingredients_trgm_idx on public.recipes using gin (search_ingredients extensions.gin_trgm_ops);
create index recipes_tags_trgm_idx on public.recipes using gin (search_tags extensions.gin_trgm_ops);
create trigger recipes_set_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_versions (
  id                  uuid primary key default gen_random_uuid(),
  recipe_id           uuid not null,
  household_id        uuid not null,
  version_no          integer not null check (version_no >= 1),
  original            jsonb check (original is null or jsonb_typeof(original) = 'object'),  -- raw AI extraction (null = manual entry)
  corrected           jsonb not null check (jsonb_typeof(corrected) = 'object'),            -- what the user confirmed
  source_image_paths  text[] not null default '{}',
  extraction_model    text,
  extracted_at        timestamptz,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  unique (recipe_id, version_no),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  check ((original is null) = (extracted_at is null))
);
create index recipe_versions_household_idx on public.recipe_versions (household_id);

create table public.recipe_images (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null,
  household_id  uuid not null,
  storage_path  text not null unique,
  kind          public.recipe_image_kind not null default 'source',
  page_order    smallint not null default 1 check (page_order between 1 and 50),
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  bytes         integer check (bytes is null or bytes between 1 and 20971520),
  width         integer check (width is null or width > 0),
  height        integer check (height is null or height > 0),
  created_at    timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  check (storage_path like household_id::text || '/%')
);
create index recipe_images_recipe_idx on public.recipe_images (recipe_id, kind, page_order);
create index recipe_images_household_idx on public.recipe_images (household_id);

create table public.recipe_ingredients (
  id              uuid primary key default gen_random_uuid(),
  recipe_id       uuid not null,
  household_id    uuid not null,
  ingredient_id   uuid references public.ingredients (id) on delete set null, -- NULL = unmatched; line is kept
  original_text   text not null check (char_length(original_text) between 1 and 500),
  quantity_kind   public.quantity_kind not null,
  quantity_value  numeric(12,3),
  quantity_min    numeric(12,3),
  quantity_max    numeric(12,3),
  unit            public.unit,
  approx_label    text check (approx_label is null or char_length(approx_label) <= 40), -- 'pinch', 'handful' — never a weight
  preparation     text check (preparation is null or char_length(preparation) <= 200),
  group_label     text check (group_label is null or char_length(group_label) <= 80),   -- e.g. 'For the sauce'
  optional        boolean not null default false,
  position        integer not null check (position >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, household_id),
  unique (recipe_id, position) deferrable initially deferred,
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  check (public.quantity_is_valid(quantity_kind, quantity_value, quantity_min, quantity_max, unit))
);
create index recipe_ingredients_household_idx on public.recipe_ingredients (household_id);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);
create trigger recipe_ingredients_set_updated_at before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

create table public.recipe_steps (
  id                uuid primary key default gen_random_uuid(),
  recipe_id         uuid not null,
  household_id      uuid not null,
  step_number       integer not null check (step_number >= 1),
  instructions      text not null check (char_length(btrim(instructions)) between 1 and 4000),
  duration_minutes  integer check (duration_minutes is null or duration_minutes between 0 and 10080),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (recipe_id, step_number) deferrable initially deferred,
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_steps_household_idx on public.recipe_steps (household_id);
create trigger recipe_steps_set_updated_at before update on public.recipe_steps
  for each row execute function public.set_updated_at();

create table public.recipe_tags (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  created_at    timestamptz not null default now(),
  unique (id, household_id)
);
create unique index recipe_tags_household_name_uq on public.recipe_tags (household_id, lower(name));

create table public.recipe_tag_links (
  recipe_id     uuid not null,
  tag_id        uuid not null,
  household_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (recipe_id, tag_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  foreign key (tag_id, household_id) references public.recipe_tags (id, household_id) on delete cascade
);
create index recipe_tag_links_tag_idx on public.recipe_tag_links (tag_id);
create index recipe_tag_links_household_idx on public.recipe_tag_links (household_id);

-- Member-specific favourites and ratings (household-visible, self-writable).
create table public.recipe_favourites (
  recipe_id     uuid not null,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  household_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (recipe_id, user_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_favourites_household_user_idx on public.recipe_favourites (household_id, user_id);

create table public.recipe_ratings (
  recipe_id     uuid not null,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  household_id  uuid not null,
  rating        smallint not null check (rating between 1 and 5),
  notes         text check (notes is null or char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (recipe_id, user_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_ratings_household_idx on public.recipe_ratings (household_id);
create trigger recipe_ratings_set_updated_at before update on public.recipe_ratings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Search maintenance. SECURITY DEFINER so the denormalised columns update regardless of the caller's
-- column grants; it only ever touches the recipe the child row already belongs to.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_recipe_search(p_recipe_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.recipes r set
    search_ingredients = coalesce((
      select string_agg(coalesce(i.name || ' ', '') || ri.original_text, ' ' order by ri.position)
        from public.recipe_ingredients ri
        left join public.ingredients i on i.id = ri.ingredient_id
       where ri.recipe_id = p_recipe_id), ''),
    search_tags = coalesce((
      select string_agg(t.name, ' ' order by t.name)
        from public.recipe_tag_links l join public.recipe_tags t on t.id = l.tag_id
       where l.recipe_id = p_recipe_id), '')
  where r.id = p_recipe_id
$$;
revoke all on function public.refresh_recipe_search(uuid) from public;

create or replace function public.recipe_children_refresh_search()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_recipe_search(old.recipe_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id) then
    perform public.refresh_recipe_search(new.recipe_id);
  end if;
  return null;
end
$$;
create trigger recipe_ingredients_refresh_search after insert or update or delete on public.recipe_ingredients
  for each row execute function public.recipe_children_refresh_search();
create trigger recipe_tag_links_refresh_search after insert or update or delete on public.recipe_tag_links
  for each row execute function public.recipe_children_refresh_search();

-- Tag rename must refresh every recipe carrying it.
create or replace function public.recipe_tags_refresh_search()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare r uuid;
begin
  if new.name is distinct from old.name then
    for r in select l.recipe_id from public.recipe_tag_links l where l.tag_id = new.id loop
      perform public.refresh_recipe_search(r);
    end loop;
  end if;
  return null;
end
$$;
create trigger recipe_tags_refresh_search after update on public.recipe_tags
  for each row execute function public.recipe_tags_refresh_search();

-- Ranked household recipe search (SECURITY INVOKER: RLS on recipes applies).
create or replace function public.search_recipes(p_household_id uuid, p_query text, p_limit int default 50)
returns setof public.recipes
language sql stable
set search_path = ''
as $$
  select r.* from public.recipes r
   where r.household_id = p_household_id
     and r.status <> 'archived'
     and (
       coalesce(btrim(p_query), '') = ''
       or r.search_tsv @@ pg_catalog.websearch_to_tsquery('english'::regconfig, p_query)
       or extensions.word_similarity(p_query, r.title) > 0.3
       or extensions.word_similarity(p_query, r.search_ingredients) > 0.4
       or extensions.word_similarity(p_query, r.search_tags) > 0.4
     )
   order by
     pg_catalog.ts_rank(r.search_tsv, pg_catalog.websearch_to_tsquery('english'::regconfig, coalesce(p_query, ''))) desc,
     extensions.similarity(p_query, r.title) desc,
     r.updated_at desc
   limit least(greatest(p_limit, 1), 200)
$$;
grant execute on function public.search_recipes(uuid, text, int) to authenticated;
