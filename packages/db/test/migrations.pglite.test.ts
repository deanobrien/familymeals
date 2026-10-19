/**
 * Applies tests/support/supabase-stub.sql + migrations/*.sql to an in-process Postgres (PGlite, PG 17 WASM)
 * and runs every tests/rls/*.sql script. Each RLS script asserts with RAISE EXCEPTION, so a thrown error = failure.
 * The same SQL scripts can be run with psql against a local Supabase stack (skip the stub there).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // packages/db
const migrationsDir = join(root, '..', '..', 'supabase', 'migrations');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const sqlFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const migrations = sqlFiles(migrationsDir);
const rlsScripts = sqlFiles(join(root, 'tests', 'rls')).filter((f) => !f.startsWith('000_'));

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(read('tests', 'support', 'supabase-stub.sql'));
  for (const m of migrations) {
    try {
      await db.exec(readFileSync(join(migrationsDir, m), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${m} failed: ${(e as Error).message}`);
    }
  }
  await db.exec(read('tests', 'rls', '000_helpers.sql'));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('migrations', () => {
  it('apply cleanly and enable RLS on every public table', async () => {
    const res = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(res.rows).toEqual([]);
    const tables = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(tables.rows[0]!.n).toBeGreaterThanOrEqual(30);
  });

  it('creates private storage buckets', async () => {
    const res = await db.query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets order by id`,
    );
    expect(res.rows).toEqual([
      { id: 'receipt-images', public: false },
      { id: 'recipe-images', public: false },
    ]);
  });

  it('has no Recipe.method column (steps only)', async () => {
    const res = await db.query(
      `select 1 from information_schema.columns where table_name = 'recipes' and column_name = 'method'`,
    );
    expect(res.rows).toHaveLength(0);
  });

  it('cascades every household_id to household deletion (except service queue/ledger)', async () => {
    const res = await db.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
         join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
        where c.table_schema = 'public' and c.column_name = 'household_id'
          and c.table_name not in ('storage_cleanup_queue', 'deletion_ledger')
          and not exists (
            select 1 from pg_constraint k
              join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
             where k.conrelid = ('public.' || c.table_name)::regclass and k.contype = 'f'
               and k.confdeltype = 'c' and a.attname = 'household_id')
        order by 1`,
    );
    expect(res.rows).toEqual([]);
  });

  it('pins search_path on every SECURITY DEFINER function', async () => {
    const res = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(res.rows).toEqual([]);
  });

  it('every write policy gates on is_household_writable, not bare membership (grace-period read-only)', async () => {
    const res = await db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
        where schemaname in ('public', 'storage') and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and (coalesce(qual, '') ~ 'is_household_member\\(' or coalesce(with_check, '') ~ 'is_household_member\\(')`,
    );
    expect(res.rows).toEqual([]);
  });

  it('purchase_events actors are nullable with ON DELETE SET NULL and a display-name snapshot column', async () => {
    const cols = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_name = 'purchase_events' and column_name in ('created_by', 'created_by_display_name', 'voided_by')
        order by 1`,
    );
    expect(cols.rows).toEqual([
      { column_name: 'created_by', is_nullable: 'YES' },
      { column_name: 'created_by_display_name', is_nullable: 'YES' },
      { column_name: 'voided_by', is_nullable: 'YES' },
    ]);
    const fks = await db.query<{ attname: string; confdeltype: string }>(
      `select a.attname, k.confdeltype from pg_constraint k
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
        where k.conrelid = 'public.purchase_events'::regclass and k.contype = 'f'
          and a.attname in ('created_by', 'voided_by') order by 1`,
    );
    expect(fks.rows).toEqual([
      { attname: 'created_by', confdeltype: 'n' },
      { attname: 'voided_by', confdeltype: 'n' },
    ]);
  });
});

describe('RLS scripts (tests/rls)', () => {
  for (const f of rlsScripts) {
    it(f, async () => {
      try {
        await db.exec(read('tests', 'rls', f));
      } catch (e) {
        await db.exec('rollback').catch(() => undefined);
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    });
  }
});
