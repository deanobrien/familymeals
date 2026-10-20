import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST, GET } from '../../../app/api/jobs/purge/route';
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
    async status() {
      calls.push('status');
      return { cleanupPending: 0 };
    },
    ...over,
  };
  return Object.assign(db, { calls });
}

describe('runPurgeJob', () => {
  it('purges households, then accounts (blocked skipped), then storage, then status', async () => {
    const db = fakeDb();
    const deleted: string[] = [];
    const out = await runPurgeJob({
      db,
      deleteAuthUser: async (id) => {
        deleted.push(id);
        return 'deleted';
      },
      storageCleanup: async () => {
        db.calls.push('storage');
        return { deleted: 3, failed: 0 };
      },
    });
    expect(db.calls[0]).toBe('purgeDue');
    expect(db.calls.indexOf('dueAccounts')).toBeLessThan(db.calls.indexOf('storage'));
    expect(db.calls.indexOf('storage')).toBeLessThan(db.calls.indexOf('status'));
    expect(deleted).toEqual(['u-ready', 'u-replay']);
    expect(db.calls).not.toContain('complete:u-blocked');
    expect(out.households).toEqual({ purged: 2, replayed: 1 });
    expect(out.accounts).toEqual({ deleted: 1, replayed: 1, blocked: 1, failed: 0 });
    expect(out.storage).toEqual({ deleted: 3, failed: 0 });
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/u-ready|u-replay/); // counts only
  });

  it('a failed auth deletion leaves the ledger pending (retried next run) and reports not ok', async () => {
    const db = fakeDb();
    const out = await runPurgeJob({
      db,
      deleteAuthUser: async (id) => {
        if (id === 'u-ready') throw new Error('500');
        return 'not_found';
      },
      storageCleanup: async () => ({ deleted: 0, failed: 0 }),
    });
    expect(db.calls).not.toContain('complete:u-ready');
    expect(db.calls).toContain('complete:u-replay');
    expect(out.accounts.failed).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(['accounts']);
  });

  it('storage failures (or a throwing cleanup) mark the run not ok but never stop the other steps', async () => {
    const out1 = await runPurgeJob({ db: fakeDb({ dueAccounts: async () => [] }), deleteAuthUser: async () => 'deleted', storageCleanup: async () => ({ deleted: 1, failed: 2 }) });
    expect(out1.storage).toEqual({ deleted: 1, failed: 2 });
    expect(out1.errors).toEqual(['storage']);
    const db = fakeDb({
      purgeDue: async () => {
        throw new Error('db down');
      },
      dueAccounts: async () => [],
    });
    const out2 = await runPurgeJob({
      db,
      deleteAuthUser: async () => 'deleted',
      storageCleanup: async () => {
        throw new Error('storage down');
      },
    });
    expect(out2.errors).toEqual(['households', 'storage']);
    expect(out2.status).toEqual({ cleanupPending: 0 });
  });
});
