-- PRJ-018 schema v1 — 0009 row-level security.
-- Model (see SCHEMA.md §RLS):
--   * RLS enabled on EVERY table in public.
--   * Household-scoped tables: access iff public.is_household_member(household_id).
--   * Membership & invitations: readable by members, writable by owners only (self may leave / rename).
--   * Reference tables: read-only to authenticated; written only by service role (bypasses RLS).
--   * Shared-or-own tables (product_packs, ingredient_prices): household_id NULL rows read-only to all
--     authenticated users; household rows behave like household-scoped tables.
--   * anon gets nothing.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants (RLS still filters rows). anon has no table access at all.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on
  public.ingredients, public.ingredient_aliases, public.ingredient_densities,
  public.ingredient_unit_weights, public.ingredient_nutrients, public.ingredient_allergens, public.ai_usage
  from authenticated;
revoke delete on public.purchase_events, public.recipe_versions from authenticated;
revoke update on public.recipe_versions from authenticated;
grant select on public.shopping_list_item_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Generic household-scoped tables: member CRUD
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'person_profiles', 'household_exclusions',
    'recipes', 'recipe_images', 'recipe_ingredients', 'recipe_steps', 'recipe_tags', 'recipe_tag_links',
    'meal_plans', 'planned_meals',
    'shopping_lists', 'shopping_list_items', 'shopping_list_item_sources',
    'receipts', 'receipt_lines', 'pantry_items',
    'nutrition_profiles', 'nutrition_profile_values'
  ] loop
    execute format($f$create policy %1$s_member_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_insert on public.%1$I for insert to authenticated
                     with check (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_update on public.%1$I for update to authenticated
                     using (public.is_household_member(household_id))
                     with check (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_delete on public.%1$I for delete to authenticated
                     using (public.is_household_member(household_id))$f$, t);
  end loop;
end
$$;

-- recipe_versions: immutable history (select + insert only)
create policy recipe_versions_member_select on public.recipe_versions for select to authenticated
  using (public.is_household_member(household_id));
create policy recipe_versions_member_insert on public.recipe_versions for insert to authenticated
  with check (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id) or created_by = auth.uid()); -- creator clause makes INSERT ... RETURNING work
create policy households_insert on public.households for insert to authenticated
  with check (created_by = auth.uid());
create policy households_owner_update on public.households for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));
create policy households_owner_delete on public.households for delete to authenticated
  using (public.is_household_owner(id));

-- ---------------------------------------------------------------------------
-- household_members: members read; owners write; a member may update/delete their OWN row
-- (rename, leave). The trigger below stops non-owners escalating role or reactivating themselves.
-- ---------------------------------------------------------------------------
create policy household_members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id) or user_id = auth.uid());
create policy household_members_owner_insert on public.household_members for insert to authenticated
  with check (public.is_household_owner(household_id));
create policy household_members_update on public.household_members for update to authenticated
  using (public.is_household_owner(household_id) or (user_id = auth.uid() and status = 'active'))
  with check (public.is_household_owner(household_id) or user_id = auth.uid());
create policy household_members_delete on public.household_members for delete to authenticated
  using (public.is_household_owner(household_id) or user_id = auth.uid());

create or replace function public.household_members_guard_self_service()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only direct API calls by end users are restricted. Service role / migrations (no JWT) and SECURITY DEFINER
  -- RPCs such as accept_invitation() (current_user = definer) pass through, as do owners.
  if auth.uid() is null or current_user <> 'authenticated' or public.is_household_owner(old.household_id) then
    return new;
  end if;
  if new.role <> old.role then
    raise exception 'only owners can change roles' using errcode = 'insufficient_privilege';
  end if;
  if new.status <> old.status and new.status <> 'left' then
    raise exception 'members may only leave a household' using errcode = 'insufficient_privilege';
  end if;
  if new.invitation_id is distinct from old.invitation_id then
    raise exception 'invitation_id is not member-editable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger household_members_guard_self_service before update on public.household_members
  for each row execute function public.household_members_guard_self_service();

-- ---------------------------------------------------------------------------
-- invitations: owners only (raw tokens never stored; acceptance via accept_invitation()).
-- ---------------------------------------------------------------------------
create policy invitations_owner_select on public.invitations for select to authenticated
  using (public.is_household_owner(household_id));
create policy invitations_owner_insert on public.invitations for insert to authenticated
  with check (public.is_household_owner(household_id) and invited_by = auth.uid());
create policy invitations_owner_update on public.invitations for update to authenticated
  using (public.is_household_owner(household_id)) with check (public.is_household_owner(household_id));
create policy invitations_owner_delete on public.invitations for delete to authenticated
  using (public.is_household_owner(household_id));

-- ---------------------------------------------------------------------------
-- Member-specific rows: household-visible, self-writable
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['recipe_favourites', 'recipe_ratings'] loop
    execute format($f$create policy %1$s_member_select on public.%1$I for select to authenticated
                     using (public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_self_insert on public.%1$I for insert to authenticated
                     with check (user_id = auth.uid() and public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_self_update on public.%1$I for update to authenticated
                     using (user_id = auth.uid() and public.is_household_member(household_id))
                     with check (user_id = auth.uid() and public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_self_delete on public.%1$I for delete to authenticated
                     using (user_id = auth.uid() and public.is_household_member(household_id))$f$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- purchase_events: append-only. Insert as yourself; the only update is a void (trigger-enforced shape).
-- ---------------------------------------------------------------------------
create policy purchase_events_member_select on public.purchase_events for select to authenticated
  using (public.is_household_member(household_id));
create policy purchase_events_member_insert on public.purchase_events for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid()
              and voided_by is null and voided_at is null);
create policy purchase_events_member_void on public.purchase_events for update to authenticated
  using (public.is_household_member(household_id) and voided_at is null)
  with check (public.is_household_member(household_id) and voided_by = auth.uid());

-- ---------------------------------------------------------------------------
-- ai_usage: members read their household's ledger; writes are server-side (service role) only.
-- ---------------------------------------------------------------------------
create policy ai_usage_member_select on public.ai_usage for select to authenticated
  using (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Reference tables: read-only to authenticated
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ingredients', 'ingredient_aliases', 'ingredient_densities', 'ingredient_unit_weights', 'ingredient_nutrients',
    'ingredient_allergens'
  ] loop
    execute format($f$create policy %1$s_read on public.%1$I for select to authenticated using (true)$f$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Shared-or-own: product_packs, ingredient_prices
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['product_packs', 'ingredient_prices'] loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                     using (household_id is null or public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_insert on public.%1$I for insert to authenticated
                     with check (household_id is not null and public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_update on public.%1$I for update to authenticated
                     using (household_id is not null and public.is_household_member(household_id))
                     with check (household_id is not null and public.is_household_member(household_id))$f$, t);
    execute format($f$create policy %1$s_member_delete on public.%1$I for delete to authenticated
                     using (household_id is not null and public.is_household_member(household_id))$f$, t);
  end loop;
end
$$;

-- Safety net: fail the migration if any public table was left without RLS.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS not enabled on: %', missing;
  end if;
end
$$;
