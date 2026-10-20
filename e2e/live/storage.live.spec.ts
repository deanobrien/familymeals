// Live Supabase: private Storage uploads (ST1, D190). Photo import -> cover in recipe-images -> signed URL -> other
// household refused -> cleanup job. Receipt photo -> receipt-images. Local stack only (see support/live.ts).
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../support/helpers.js';
import { adminClient, supabaseUrl, userClient, userWithHousehold, householdIdOf } from './support/live.js';

const img = (f: string) => join(FIXTURES_DIR, 'recipes', f);
const receiptImg = join(FIXTURES_DIR, 'receipts', 'r1-weekly-shop.png');
const PATH_RE = /^[0-9a-f-]{36}\/(cover|page|receipt)\/[0-9a-f-]{36}\/[\w.-]+\.jpg$/;

async function accessToken(user: { email: string; password: string }): Promise<string> {
  const c = await userClient(user);
  const { data } = await c.auth.getSession();
  if (!data.session) throw new Error('no session');
  return data.session.access_token;
}

test('recipe photo import stores a private cover, serves it by signed URL, isolates households and cleans up', async ({ browser }) => {
  const a = await userWithHousehold(browser, 'st1-a', 'ST1 Home A');
  const b = await userWithHousehold(browser, 'st1-b', 'ST1 Home B');
  const anon = await browser.newContext();
  const admin = adminClient();
  try {
    // ---- import two pages, preview the stored cover, save ----
    await a.page.goto('/recipes/import');
    await a.page.getByTestId('photo-input').setInputFiles([img('03-beef-stew-two-page-p1.png'), img('03-beef-stew-two-page-p2.png')]);
    await a.page.getByRole('button', { name: 'Extract recipe' }).click();
    await expect(a.page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    const preview = a.page.getByRole('img', { name: /Cover photo preview/ });
    await expect(preview).toBeVisible();
    // the preview URL is the authenticated upload route; the browser follows its 302 to a signed Storage URL
    await expect.poll(() => preview.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await a.page.getByLabel('Title', { exact: true }).fill('ST1 Stored Cover Stew');
    await a.page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(a.page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const recipeId = a.page.url().split('/').pop()!;
    const origin = new URL(a.page.url()).origin;
    const hh = await householdIdOf(a.user);

    // ---- the recipe stores a storage PATH; the page renders it through /api/images ----
    const ca = await userClient(a.user);
    const { data: row } = await ca.from('recipes').select('cover_image_path').eq('id', recipeId).single();
    const coverPath = row?.cover_image_path as string;
    expect(coverPath).toMatch(PATH_RE);
    expect(coverPath.startsWith(`${hh}/cover/`)).toBe(true);
    const hero = a.page.locator('img[src^="/api/images/"]').first();
    await expect(hero).toBeVisible();
    await expect.poll(() => hero.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const src = (await hero.getAttribute('src'))!;
    expect(src).toBe(`/api/images/${coverPath}`);

    // ---- Storage: the cover exists in the private bucket, the temporary page photos are gone ----
    const uploadId = coverPath.split('/')[2]!;
    const { data: covers } = await admin.storage.from('recipe-images').list(`${hh}/cover/${uploadId}`);
    expect(covers?.map((o) => o.name)).toEqual(['cover.jpg']);
    const { data: pages } = await admin.storage.from('recipe-images').list(`${hh}/page/${uploadId}`);
    expect(pages ?? []).toHaveLength(0);

    // ---- short-lived signed URL, never public ----
    const redirect = await a.page.request.get(src, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    const location = redirect.headers().location!;
    expect(location).toMatch(/\/storage\/v1\/object\/sign\/recipe-images\/.+token=/);
    const signed = await fetch(location);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('content-type')).toContain('image/jpeg');
    const exp = JSON.parse(Buffer.from(new URL(location).searchParams.get('token')!.split('.')[1]!, 'base64url').toString()).exp as number;
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    const publicTry = await fetch(`${supabaseUrl()}/storage/v1/object/public/recipe-images/${coverPath}`);
    expect(publicTry.ok).toBe(false);

    // ---- RLS isolation: another household (and anonymous) gets nothing ----
    expect((await b.page.request.get(src, { maxRedirects: 0 })).status()).toBe(404);
    expect((await anon.request.get(src, { maxRedirects: 0 })).status()).toBe(401);
    const cb = await userClient(b.user);
    expect((await cb.storage.from('recipe-images').download(coverPath)).error).not.toBeNull();
    expect((await cb.storage.from('recipe-images').createSignedUrl(coverPath, 60)).error).not.toBeNull();
    expect((await cb.storage.from('recipe-images').upload(`${hh}/cover/${uploadId}/evil.jpg`, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })).error).not.toBeNull();
    expect((await cb.storage.from('recipe-images').remove([coverPath])).data ?? []).toHaveLength(0);
    // the Android app: bearer token works for the owner, a foreign household's token gets 404
    const tokenA = await accessToken(a.user);
    const tokenB = await accessToken(b.user);
    expect((await fetch(`${origin}${src}`, { headers: { authorization: `Bearer ${tokenA}` }, redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${origin}${src}`, { headers: { authorization: `Bearer ${tokenB}` }, redirect: 'manual' })).status).toBe(404);
    expect((await a.page.request.get(`/api/images/${hh}/cover/${uploadId}/../../x.jpg`, { maxRedirects: 0 })).status()).toBe(404);

    // ---- "delete" (archive) releases the cover; the cleanup job removes the object ----
    await a.page.goto(`/recipes/${recipeId}`);
    await a.page.getByRole('button', { name: 'Delete', exact: true }).click();
    await a.page.getByRole('dialog').getByRole('button', { name: 'Delete recipe' }).click();
    await expect(a.page).toHaveURL(/\/recipes\?deleted=1/);
    const { data: queued } = await admin.from('storage_cleanup_queue').select('id, processed_at').eq('object_path', coverPath);
    expect(queued?.filter((q) => q.processed_at === null)).toHaveLength(1);

    const secret = process.env.CRON_SECRET!;
    const url = `${origin}/api/jobs/storage-cleanup`;
    expect((await anon.request.post(url)).status()).toBe(401);
    expect((await anon.request.post(url, { headers: { 'x-cron-secret': 'definitely-the-wrong-secret' } })).status()).toBe(401);
    expect((await anon.request.get(url, { headers: { 'x-cron-secret': secret } })).status()).toBe(405);
    const run = await anon.request.post(url, { headers: { 'x-cron-secret': secret } });
    expect(run.status()).toBe(200);
    const summary = (await run.json()) as { ok: boolean; deleted: number; failed: number };
    expect(summary.ok).toBe(true);
    expect(summary.deleted).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);
    const { data: gone } = await admin.storage.from('recipe-images').list(`${hh}/cover/${uploadId}`);
    expect(gone ?? []).toHaveLength(0);
    const { data: done } = await admin.from('storage_cleanup_queue').select('processed_at').eq('object_path', coverPath);
    expect(done?.every((q) => q.processed_at !== null)).toBe(true);
    // the recipe no longer shows an image, and another run is a clean no-op for it
    expect((await anon.request.post(url, { headers: { 'x-cron-secret': secret } })).status()).toBe(200);
  } finally {
    await anon.close();
    await a.context.close();
    await b.context.close();
  }
});

test('receipt photo is kept privately in receipt-images and only the household can open it', async ({ browser }) => {
  const a = await userWithHousehold(browser, 'st1-ra', 'ST1 Receipts A');
  const b = await userWithHousehold(browser, 'st1-rb', 'ST1 Receipts B');
  const admin = adminClient();
  try {
    await a.page.goto('/receipts');
    await a.page.getByLabel('Receipt photo').setInputFiles(receiptImg);
    await a.page.getByRole('button', { name: 'Scan receipt' }).click();
    await a.page.waitForURL(/\/receipts\/[^/]+\/review$/, { timeout: 60_000 });
    const receiptId = a.page.url().split('/').at(-2)!;
    const hh = await householdIdOf(a.user);

    const link = a.page.getByTestId('receipt-photo-link');
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    const { data: r } = await (await userClient(a.user)).from('receipts').select('image_paths').eq('id', receiptId).single();
    const paths = r?.image_paths as string[];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe(`${hh}/receipt/${receiptId}/receipt.jpg`);
    expect(href).toBe(`/api/images/${paths[0]}`);
    const { data: obj } = await admin.storage.from('receipt-images').list(`${hh}/receipt/${receiptId}`);
    expect(obj?.map((o) => o.name)).toEqual(['receipt.jpg']);

    const redirect = await a.page.request.get(href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    const signed = await fetch(redirect.headers().location!);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('content-type')).toContain('image/jpeg');

    expect((await b.page.request.get(href, { maxRedirects: 0 })).status()).toBe(404);
    const cb = await userClient(b.user);
    expect((await cb.storage.from('receipt-images').createSignedUrl(paths[0]!, 60)).error).not.toBeNull();
    // B cannot even see A's receipt row, so no path to guess from
    const { data: seen } = await cb.from('receipts').select('id').eq('id', receiptId);
    expect(seen ?? []).toHaveLength(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
