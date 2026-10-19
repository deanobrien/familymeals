-- PRJ-018 schema v1 — 0011 realtime publication (Supabase). Realtime respects RLS for postgres_changes.
-- Guarded so the migration is a no-op where the supabase_realtime publication does not exist (plain Postgres / CI).
-- Clients must still resync on reconnect (BRIEF §13) — realtime is a hint, the tables are the truth.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.shopping_lists,
      public.shopping_list_items,
      public.purchase_events,
      public.meal_plans,
      public.planned_meals,
      public.pantry_items;
  end if;
end
$$;
