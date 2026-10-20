import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST, GET } from '../../../app/api/jobs/purge/route';
import type { ObjectRemover } from '../objects/port';
import { runPurgeJob, type PurgeJobDb } from './purge-job';
import { checkJobsSecret, MIN_JOBS_SECRET_LENGTH } from './secret';

const SECRET = 'x'.repeat(MIN_JOBS_SECRET_LENGTH);
const hdr = (h: Record<string, string>) => new Headers(h);

describe('jobs secret', () => {
  it('is disabled (never open) without a long enough JOBS_SECRET', () => {
    expect(checkJobsSecret(hdr({ 'x-jobs-secret': 'anything' }), undefined)).toBe('unconfigured');
    expect(checkJobsSecret(hdr({ 'x-jobs-secret': 'short' }), 'short')).toBe('unconfigured');
    expect(checkJobsSecret(hdr({}), '   ')).toBe('unconfigured');
  });
  it('accepts the header or a bearer token, refuses anything else', () => {
    expect(checkJobsSecret(hdr({ 'x-jobs-secret': SECRET }), SECRET)).toBe('ok');
    expect(checkJobsSecret(hdr({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe('ok');
    expect(checkJobsSecret(hdr({}), SECRET)).toBe('unauthorized');
    expect(checkJobsSecret(hdr({ 'x-jobs-secret': SECRET.slice(1) }), SECRET)).toBe('unauthorized');
    expect(checkJobsSecret(hdr({ 'x-jobs-secret': `${SECRET}y` }), SECRET)).toBe('unauthorized');
    expect(checkJobsSecret(hdr({ authorization: `Basic ${SECRET}` }), SECRET)).toBe('unauthorized');
  });
});

describe('POST /api/jobs/purge', () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (h: Record<string, string> = {}) => new Request('http://localhost/api/jobs/purge', { method: 'POST', headers: h });

  it('503 when JOBS_SECRET is unset, 401 without/with a wrong secret', async () => {
    vi.stubEnv('JOBS_SECRET', '');
    expect((await POST(req({ 'x-jobs-secret': SECRET }))).status).toBe(503);
    vi.stubEnv('JOBS_SECRET', SECRET);
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req({ 'x-jobs-secret': 'nope' }))).status).toBe(401);
  });

  it('with the secret but no Supabase backend: 200 and nothing done', async () => {
    vi.stubEnv('JOBS_SECRET', SECRET);
    vi.stubEnv('DATA_BACKEND', '');
    const res = await POST(req({ 'x-jobs-secret': SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: 'no_supabase_backend' });
  });

  it('GET is not allowed', async () => {
    expect(GET().status).toBe(405);
  });
});

function fakeDb(over: Partial<PurgeJobDb> = {}): PurgeJobDb & { calls: string[] } {
  const calls: string[] = [];
  const db: PurgeJobDb = {
    async purgeDue() {
      calls.push('purgeDue');
      return { purged: 2, replayed: 1 };
    },
    async dueAccounts() {
      calls.push('dueAccounts');
      return [
        { userId: 'u-ready', replay: false },
        { userId: 'u-blocked', replay: false },
        { userId: 'u-replay', replay: true },
      ];
    },
    async prepareAccount(id) {
      calls.push(`prepare:${id}`);
      return id === 'u-blocked' ? 'blocked_owner' : 'ready';
    },
    async completeAccount(id) {
      calls.push(`complete:${id}`);
    },
    async claimCleanup() {
      calls.push('claim');
      return [
        { id: 'q1', bucket: 'recipe-images', objectPath: 'h/recipes/1.jpg' },
        { id: 'q2', bucket: 'recipe-images', objectPath: 'h/recipes/2.jpg' },
        { id: 'q3', bucket: 'receipt-images', objectPath: 'h/receipts/1.jpg' },
        { id: 'q4', bucket: 'local-uploads', objectPath: '33333333-3333-4333-8333-333333333333' },
      ];
    },
    async completeCleanup(ids) {
      calls.push(`completeCleanup:${ids.join(',')}`);
    },
    async failCleanup(id) {
      calls.push(`fail:${id}`);
    },
    async status() {
      return { cleanupPending: 0 };
    },
    ...over,
  };
  return Object.assign(db, { calls });
}

const okRemover = (seen: string[]): ObjectRemover => ({
  async remove(paths) {
    seen.push(...paths);
    return { removed: paths, failed: [] };
  },
});

describe('runPurgeJob', () => {
  it('purges households before accounts, skips blocked accounts, deletes objects per bucket', async () => {
    const db = fakeDb();
    const deleted: string[] = [];
    const seen: string[] = [];
    const out = await runPurgeJob({
      db,
      deleteAuthUser: async (id) => {
        deleted.push(id);
        return 'deleted';
      },
      removers: { 'recipe-images': okRemover(seen), 'receipt-images': okRemover(seen) },
    });
    expect(db.calls[0]).toBe('purgeDue');
    expect(db.calls.indexOf('purgeDue')).toBeLessThan(db.calls.indexOf('dueAccounts'));
    expect(deleted).toEqual(['u-ready', 'u-replay']);
    expect(db.calls).not.toContain('complete:u-blocked');
    expect(out.households).toEqual({ purged: 2, replayed: 1 });
    expect(out.accounts).toEqual({ deleted: 1, replayed: 1, blocked: 1, failed: 0 });
    expect(seen).toEqual(['h/recipes/1.jpg', 'h/recipes/2.jpg', 'h/receipts/1.jpg']);
    expect(db.calls).toContain('completeCleanup:q1,q2');
    expect(db.calls).toContain('fail:q4'); // no local remover on this instance: left for later, not marked done
    expect(out.storage).toEqual({ removed: 3, failed: 0, skipped: 1 });
    expect(out.ok).toBe(true);
    // counts only: no ids or paths in the result
    expect(JSON.stringify(out)).not.toMatch(/u-ready|recipes\/1|q1/);
  });

  it('a failed auth deletion leaves the ledger pending (retried next run) and reports not ok', async () => {
    const db = fakeDb({ claimCleanup: async () => [] });
    const out = await runPurgeJob({
      db,
      deleteAuthUser: async (id) => {
        if (id === 'u-ready') throw new Error('500');
        return 'not_found';
      },
      removers: {},
    });
    expect(db.calls).not.toContain('complete:u-ready');
    expect(db.calls).toContain('complete:u-replay');
    expect(out.accounts.failed).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(['accounts']);
  });

  it('storage removal failures are recorded per row and the run is not ok', async () => {
    const db = fakeDb({ dueAccounts: async () => [] });
    const out = await runPurgeJob({
      db,
      deleteAuthUser: async () => 'deleted',
      removers: {
        'recipe-images': { remove: async (paths) => ({ removed: [paths[0]!], failed: [{ path: paths[1]!, error: 'boom' }] }) },
        'receipt-images': okRemover([]),
        'local-uploads': okRemover([]),
      },
    });
    expect(db.calls).toContain('completeCleanup:q1');
    expect(db.calls).toContain('fail:q2');
    expect(out.storage).toEqual({ removed: 3, failed: 1, skipped: 0 });
    expect(out.ok).toBe(false);
  });

  it('a household step failure does not stop the other steps', async () => {
    const db = fakeDb({
      purgeDue: async () => {
        throw new Error('db down');
      },
      dueAccounts: async () => [],
      claimCleanup: async () => [],
    });
    const out = await runPurgeJob({ db, deleteAuthUser: async () => 'deleted', removers: {} });
    expect(out.errors).toEqual(['households']);
    expect(out.status).toEqual({ cleanupPending: 0 });
  });
});
