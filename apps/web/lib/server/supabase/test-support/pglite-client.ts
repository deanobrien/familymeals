// TEST SUPPORT: a supabase-js lookalike backed by PGlite running the real migrations, so the repositories' RPC calls and
// table operations execute against the actual SQL (argument names, jsonb shapes, RLS as a real `authenticated` member).
// It emulates only the PostgREST surface the repositories use; it is NOT a general PostgREST implementation.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..'); // repo root
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { message: string; code?: string } | null };

const JSONB_ARGS = new Set(['p_input', 'p_doc', 'p_items', 'p_command', 'p_result', 'p_qty', 'p_receipt', 'p_lines', 'p_config', 'p_keys']);
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

class Builder implements PromiseLike<Res> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private rows: Row[] = [];
  private values: Row = {};
  private wheres: Array<{ col: string; op: 'eq' | 'neq' | 'in' | 'gt'; val: unknown }> = [];
  private orders: string[] = [];
  private lo?: number;
  private hi?: number;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private returning = false;
  private single: 'maybe' | 'one' | null = null;

  constructor(
    private readonly db: PGlite,
    private readonly table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.upsertOpts = opts;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: unknown) {
    this.wheres.push({ col, op: 'eq', val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.wheres.push({ col, op: 'neq', val });
    return this;
  }
  gt(col: string, val: unknown) {
    this.wheres.push({ col, op: 'gt', val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.wheres.push({ col, op: 'in', val });
    return this;
  }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.orders.push(`${q(col)} ${o.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  range(from: number, to: number) {
    this.lo = from;
    this.hi = to;
    return this;
  }
  maybeSingle() {
    this.single = 'maybe';
    return this;
  }

  private where(params: unknown[]): string {
    if (this.wheres.length === 0) return '';
    const parts = this.wheres.map((w) => {
      if (w.op === 'in') {
        params.push(w.val);
        return `${q(w.col)} = any($${params.length})`;
      }
      params.push(w.val);
      return `${q(w.col)} ${w.op === 'eq' ? '=' : w.op === 'gt' ? '>' : '<>'} $${params.length}`;
    });
    return ` where ${parts.join(' and ')}`;
  }

  private async run(): Promise<Res> {
    const t = `public.${q(this.table)}`;
    const params: unknown[] = [];
    let sql: string;
    const ret = this.op === 'select' || this.returning ? ` returning ${this.cols}` : '';
    switch (this.op) {
      case 'select': {
        sql = `select ${this.cols} from ${t}${this.where(params)}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''}`;
        if (this.lo !== undefined && this.hi !== undefined) sql += ` limit ${this.hi - this.lo + 1} offset ${this.lo}`;
        break;
      }
      case 'insert':
      case 'upsert': {
        const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const tuples = this.rows.map((r) => `(${cols.map((c) => (params.push(r[c] ?? null), `$${params.length}`)).join(', ')})`);
        sql = `insert into ${t} (${cols.map(q).join(', ')}) values ${tuples.join(', ')}`;
        if (this.op === 'upsert') {
          const target = (this.upsertOpts.onConflict ?? '').split(',').map((c) => q(c.trim())).join(', ');
          const sets = cols.filter((c) => !(this.upsertOpts.onConflict ?? '').split(',').map((x) => x.trim()).includes(c));
          sql += this.upsertOpts.ignoreDuplicates || sets.length === 0
            ? ` on conflict (${target}) do nothing`
            : ` on conflict (${target}) do update set ${sets.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
        }
        sql += ret;
        break;
      }
      case 'update': {
        const entries = Object.entries(this.values);
        const sets = entries.map(([c, v]) => (params.push(v), `${q(c)} = $${params.length}`));
        sql = `update ${t} set ${sets.join(', ')}${this.where(params)}${ret}`;
        break;
      }
      case 'delete':
        sql = `delete from ${t}${this.where(params)}${ret}`;
        break;
    }
    try {
      const res = await this.db.query<Row>(sql, params);
      if (this.single === 'maybe') return { data: res.rows[0] ?? null, error: null };
      return { data: this.op === 'select' || this.returning ? res.rows : null, error: null };
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { data: null, error: { message: err.message, ...(err.code ? { code: err.code } : {}) } };
    }
  }

  then<R1 = Res, R2 = never>(ok?: ((v: Res) => R1 | PromiseLike<R1>) | null, bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
    return this.run().then(ok, bad);
  }
}

export interface PgliteSupabase {
  client: SupabaseClient;
  db: PGlite;
  /** Become this member (an `authenticated` JWT sub), or `null` for the superuser/service role. */
  actAs(userId: string | null): Promise<void>;
  /** Superuser SQL (fixtures). */
  admin(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createPgliteSupabase(): Promise<PgliteSupabase> {
  // PostgREST returns date / timestamp columns as strings (not JS Dates): keep the raw text like it does.
  const raw = (v: string) => v;
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto }, parsers: { 1082: raw, 1114: raw, 1184: raw } });
  const sqlFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await db.exec(readFileSync(join(root, 'packages', 'db', 'tests', 'support', 'supabase-stub.sql'), 'utf8'));
  const migrations = join(root, 'supabase', 'migrations');
  for (const f of sqlFiles(migrations)) await db.exec(readFileSync(join(migrations, f), 'utf8'));

  const client = {
    from: (table: string) => new Builder(db, table),
    rpc: async (fn: string, args: Row = {}): Promise<Res> => {
      const names = Object.keys(args);
      const params = names.map((n) => {
        const v = args[n];
        // PostgREST types arguments from the function signature; here jsonb parameters are named explicitly
        return JSONB_ARGS.has(n) && v !== null ? JSON.stringify(v) : v;
      });
      const call = `select public.${q(fn)}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as data`;
      try {
        const res = await db.query<{ data: unknown }>(call, params);
        const data = res.rows[0]?.data;
        return { data: data === '' ? null : (data ?? null), error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, ...(err.code ? { code: err.code } : {}) } };
      }
    },
  } as unknown as SupabaseClient;

  return {
    client,
    db,
    admin: async (sql) => {
      await db.exec('reset role');
      await db.exec(sql);
    },
    actAs: async (userId) => {
      await db.exec('reset role');
      if (userId === null) {
        await db.exec(`select set_config('request.jwt.claims', '', false)`);
        return;
      }
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
      await db.exec('set role authenticated');
    },
    close: () => db.close(),
  };
}
