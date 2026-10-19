/**
 * Placeholder for the generated Supabase types.
 *
 * TODO: once a Supabase stack exists (local `pnpm exec supabase start` needs Docker, or a linked cloud project),
 * regenerate with:
 *   pnpm exec supabase gen types typescript --local > packages/db/src/database.types.ts
 * (or `--project-id <ref>` for cloud) and delete this stub. Until then the hand-written zod row schemas in
 * `@fr/domain` (entities.ts) are the typed contract for table rows, and `pnpm --filter @fr/db test` applies every
 * migration to an in-process Postgres (PGlite) and runs the SQL RLS scripts in `tests/rls`.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}
