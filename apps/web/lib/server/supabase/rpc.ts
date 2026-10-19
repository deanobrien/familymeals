// Thin helpers over @supabase/supabase-js shared by the Supabase repositories (lane S1, DECISIONS D50-D59).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@fr/db';

export type { SupabaseClient };

/** PostgREST / Postgres error surfaced by a repository call. `code` is the SQLSTATE (e.g. 23505) when present. */
export class SupabaseRepositoryError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    readonly code?: string,
  ) {
    super(`${operation}: ${message}${code ? ` (${code})` : ''}`);
    this.name = 'SupabaseRepositoryError';
  }
}

export interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** Throws on error, returns `data` (which may legitimately be null). */
export function unwrap<T>(operation: string, res: PgResult<T>): T | null {
  if (res.error) throw new SupabaseRepositoryError(operation, res.error.message, res.error.code);
  return res.data;
}

type PublicFunctions = Database['public']['Functions'];
/** A SQL function in `public`, checked against the generated types (`supabase gen types`, D141). */
export type RpcName = keyof PublicFunctions & string;
/** The function's argument names (values stay `unknown`: jsonb args take domain objects). */
export type RpcArgs<F extends RpcName> = { [K in keyof PublicFunctions[F]['Args']]: unknown };

/**
 * Calls a SQL function (all multi-table reads/writes go through RPC; see migration 0015). The function name and
 * argument names are type-checked against the generated `Database` types; the result shape is the caller's `T`.
 */
export function callRpc<T>(client: SupabaseClient) {
  return async <F extends RpcName>(fn: F, args: RpcArgs<F>): Promise<T | null> => {
    const res = (await client.rpc(fn, args as Record<string, unknown>)) as PgResult<T>;
    return unwrap(`rpc ${fn}`, res);
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Normalise a Postgres timestamptz string to the `toISOString()` form the web app uses everywhere. */
export function toIso(v: unknown): string {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** PostgREST caps a response at 1000 rows by default; read a whole result by paging with `range`. */
export async function selectAll<Row>(
  operation: string,
  page: (from: number, to: number) => PromiseLike<PgResult<Row[]>>,
  pageSize = 1000,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const rows = unwrap(operation, await page(from, from + pageSize - 1)) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
