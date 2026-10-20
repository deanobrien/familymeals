import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cronSecretMatches, runStorageCleanup, type CleanupDb } from './cleanup';
import { fakeStorage } from './fake-storage';
import { LocalImageStore } from './local-store';
import { imagePath, imageSrc, isStoragePath, parseImagePath } from './paths';
import { SupabaseImageStore } from './supabase-store';
import { acceptsBearer, isPublicPath } from '../auth/routes';
import { DiskUploadFiles } from '../uploads/dev-store';

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const OTHER = 'bb000000-0000-4000-8000-0000000000bb';
const ID = '11111111-2222-4333-8444-555555555555';
const bytes = (...n: number[]) => new Uint8Array(n);

describe('image paths', () => {
  it('builds and parses <household>/<kind>/<id>/<file>', () => {
    const p = imagePath(HH, 'cover', ID, 'cover.jpg');
    expect(p).toBe(`${HH}/cover/${ID}/cover.jpg`);
    expect(parseImagePath(p)).toEqual({ householdId: HH, kind: 'cover', id: ID, file: 'cover.jpg' });
    expect(imagePath(HH, 'receipt', ID, 'receipt.jpg')).toBe(`${HH}/receipt/${ID}/receipt.jpg`);
  });
  it('rejects traversal, wrong kinds, wrong file names and extra segments', () => {
    for (const bad of [
      `${HH}/cover/${ID}/../x.jpg`, `${HH}/cover/${ID}/page-1.jpg`, `${HH}/page/${ID}/cover.jpg`, `${HH}/other/${ID}/cover.jpg`,
      `${HH}/cover/not-a-uuid/cover.jpg`, `../${HH}/cover/${ID}/cover.jpg`, `${HH}/cover/${ID}/cover.jpg/x`, '', 'a/b',
    ]) expect(parseImagePath(bad), bad).toBeNull();
    expect(() => imagePath(HH, 'cover', '../x', 'cover.jpg')).toThrow();
    expect(() => imagePath('nope', 'cover', ID, 'cover.jpg')).toThrow();
  });
  it('imageSrc maps storage paths to the authenticated route and leaves other URLs alone', () => {
    expect(imageSrc(`${HH}/cover/${ID}/cover.jpg`)).toBe(`/api/images/${HH}/cover/${ID}/cover.jpg`);
    expect(imageSrc('https://www.themealdb.com/x.jpg')).toBe('https://www.themealdb.com/x.jpg');
    expect(imageSrc(`/api/uploads/${ID}/cover.jpg`)).toBe(`/api/uploads/${ID}/cover.jpg`);
    expect(imageSrc(null)).toBeNull();
    expect(imageSrc('')).toBeNull();
    expect(isStoragePath(`${HH}/cover/${ID}/cover.jpg`)).toBe(true);
    expect(isStoragePath('https://x/y')).toBe(false);
  });
});

describe('SupabaseImageStore (recorded client)', () => {
  it('uploads private objects into the household folder of the right bucket and returns the path', async () => {
    const fake = fakeStorage();
    const store = new SupabaseImageStore(fake, HH);
    const cover = await store.put('cover', ID, 'cover.jpg', bytes(1, 2, 3));
    const page = await store.put('page', ID, 'page-2.jpg', bytes(4));
    const receipt = await store.put('receipt', ID, 'receipt.jpg', bytes(5));
    expect(cover).toBe(`${HH}/cover/${ID}/cover.jpg`);
    expect(page).toBe(`${HH}/page/${ID}/page-2.jpg`);
    expect(receipt).toBe(`${HH}/receipt/${ID}/receipt.jpg`);
    expect([...fake.objects.keys()].sort()).toEqual([
      `receipt-images/${HH}/receipt/${ID}/receipt.jpg`,
      `recipe-images/${HH}/cover/${ID}/cover.jpg`,
      `recipe-images/${HH}/page/${ID}/page-2.jpg`,
    ]);
    expect(fake.calls[0]).toMatchObject({ op: 'upload', args: [cover, 3, { contentType: 'image/jpeg', upsert: true }] });
  });
  it('surfaces upload failures and refuses bad references before calling storage', async () => {
    const fake = fakeStorage();
    const store = new SupabaseImageStore(fake, HH);
    fake.failNextUpload = 'row violates policy';
    await expect(store.put('cover', ID, 'cover.jpg', bytes(1))).rejects.toThrow(/row violates policy/);
    await expect(store.put('cover', '../x', 'cover.jpg', bytes(1))).rejects.toThrow(/bad image reference/);
    expect(fake.calls.filter((c) => c.op === 'upload')).toHaveLength(1);
  });
  it('reads back and signs short-lived URLs; missing objects are undefined', async () => {
    const fake = fakeStorage();
    const store = new SupabaseImageStore(fake, HH);
    await store.put('cover', ID, 'cover.jpg', bytes(9, 8));
    expect([...(await store.get('cover', ID, 'cover.jpg'))!]).toEqual([9, 8]);
    expect(await store.get('cover', ID, 'missing.jpg').catch(() => 'threw')).toBe('threw'); // invalid file name
    expect(await store.signedUrl('cover', ID, 'cover.jpg')).toMatch(/exp=300$/);
    expect(await store.signedUrl('cover', ID, 'cover.jpg', 60)).toMatch(/exp=60$/);
    const other = new SupabaseImageStore(fake, OTHER); // same bucket data, different household folder: not found
    expect(await other.signedUrl('cover', ID, 'cover.jpg')).toBeUndefined();
    expect(await other.get('cover', ID, 'cover.jpg')).toBeUndefined();
  });
  it('finishUpload deletes only the temporary page photos', async () => {
    const fake = fakeStorage();
    const store = new SupabaseImageStore(fake, HH);
    await store.put('page', ID, 'page-1.jpg', bytes(1));
    await store.put('page', ID, 'page-2.jpg', bytes(2));
    await store.put('cover', ID, 'cover.jpg', bytes(3));
    await store.finishUpload(ID, 2);
    expect([...fake.objects.keys()]).toEqual([`recipe-images/${HH}/cover/${ID}/cover.jpg`]);
  });
});

describe('LocalImageStore (current dev behaviour)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fr-images-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('keeps the /api/uploads URLs and refuses receipts', async () => {
    const store = new LocalImageStore(new DiskUploadFiles(dir));
    expect(await store.put('page', ID, 'page-1.jpg', bytes(1))).toBe(`/api/uploads/${ID}/page-1.jpg`);
    expect(await store.put('cover', ID, 'cover.jpg', bytes(2))).toBe(`/api/uploads/${ID}/cover.jpg`);
    expect([...(await store.get('page', ID, 'page-1.jpg'))!]).toEqual([1]);
    expect(await store.signedUrl('cover', ID, 'cover.jpg')).toBe(`/api/uploads/${ID}/cover.jpg`);
    expect(await store.signedUrl('cover', ID, 'cover.jpg')).toBeDefined();
    await expect(store.put('receipt', ID, 'receipt.jpg', bytes(3))).rejects.toThrow();
  });
});

describe('storage cleanup job', () => {
  interface Rec { fn?: string; args?: unknown; updates: { values: Record<string, unknown>; ids: string[] }[]; removed: Record<string, string[]> }
  function db(claims: { id: string; bucket: string; object_path: string }[][], opts: { removeError?: string; rpc?: Record<string, number> } = {}) {
    const rec: Rec = { updates: [], removed: {} };
    const queue = [...claims];
    const d: CleanupDb = {
      rpc: async (fn) => {
        if (fn === 'claim_storage_cleanup') return { data: queue.shift() ?? [], error: null };
        return { data: opts.rpc?.[fn] ?? 0, error: null };
      },
      storage: {
        from: (bucket) => ({
          remove: async (paths) => {
            rec.removed[bucket] = [...(rec.removed[bucket] ?? []), ...paths];
            return { error: opts.removeError ? { message: opts.removeError } : null };
          },
        }),
      },
      from: () => ({ update: (values) => ({ in: async (_c, ids) => { rec.updates.push({ values, ids }); return { error: null }; } }) }),
    };
    return { d, rec };
  }

  it('expires receipts, queues stale uploads, deletes claimed objects per bucket and marks them processed', async () => {
    const { d, rec } = db(
      [[{ id: 'q1', bucket: 'recipe-images', object_path: `${HH}/cover/${ID}/cover.jpg` }, { id: 'q2', bucket: 'receipt-images', object_path: `${HH}/receipt/${ID}/receipt.jpg` }]],
      { rpc: { purge_old_receipt_images: 2, enqueue_stale_uploads: 3 } },
    );
    const s = await runStorageCleanup(d, { batchSize: 5 });
    expect(s).toEqual({ receiptImagesExpired: 2, staleQueued: 3, deleted: 2, failed: 0 });
    expect(rec.removed).toEqual({ 'recipe-images': [`${HH}/cover/${ID}/cover.jpg`], 'receipt-images': [`${HH}/receipt/${ID}/receipt.jpg`] });
    expect(rec.updates.map((u) => u.ids)).toEqual([['q1'], ['q2']]);
    expect(rec.updates.every((u) => typeof u.values.processed_at === 'string')).toBe(true);
  });
  it('leaves failed deletes pending with last_error', async () => {
    const { d, rec } = db([[{ id: 'q1', bucket: 'recipe-images', object_path: 'p' }]], { removeError: 'storage down' });
    const s = await runStorageCleanup(d, { batchSize: 5 });
    expect(s.failed).toBe(1);
    expect(s.deleted).toBe(0);
    expect(rec.updates[0]!.values).toEqual({ last_error: 'storage down' });
  });
  it('does nothing when the queue is empty', async () => {
    const { d, rec } = db([]);
    expect(await runStorageCleanup(d)).toEqual({ receiptImagesExpired: 0, staleQueued: 0, deleted: 0, failed: 0 });
    expect(rec.updates).toEqual([]);
  });
  it('compares the cron secret in a way that refuses weak, missing and wrong values', () => {
    const secret = 'a-long-enough-cron-secret';
    expect(cronSecretMatches(secret, secret)).toBe(true);
    expect(cronSecretMatches('wrong', secret)).toBe(false);
    expect(cronSecretMatches(null, secret)).toBe(false);
    expect(cronSecretMatches(secret, undefined)).toBe(false);
    expect(cronSecretMatches('short', 'short')).toBe(false); // configured secret under 16 chars is never accepted
  });
});

describe('route classification', () => {
  it('the cleanup endpoint is reachable without a session (it checks its own secret); image routes are not public', () => {
    expect(isPublicPath('/api/jobs/storage-cleanup')).toBe(true);
    expect(isPublicPath(`/api/images/${HH}/cover/${ID}/cover.jpg`)).toBe(false);
    expect(isPublicPath(`/api/uploads/${ID}/cover.jpg`)).toBe(false);
  });
  it('the Android app can fetch images with a bearer token', () => {
    expect(acceptsBearer(`/api/images/${HH}/cover/${ID}/cover.jpg`, 'Bearer abc')).toBe(true);
    expect(acceptsBearer(`/api/images/${HH}/cover/${ID}/cover.jpg`, null)).toBe(false);
  });
});
