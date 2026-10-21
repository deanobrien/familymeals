// P3-C (D445-D449): installable PWA + offline shopping list, and "use my phone as the scanner" with a second browser context as the
// phone. Mock auth / mock AI; sandbox households (cookie `fr_household=e2e-*`). Run with --workers=2.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let seq = 0;
const newHousehold = () => `e2e-p3c-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 6)}`;

async function open(context: BrowserContext, household: string, path: string): Promise<Page> {
  await context.addCookies([{ name: 'fr_household', value: household, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

const tickBox = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });

const PASTA = '00000000-0000-4000-8000-000000000001';
const BEEF_STEW = '00000000-0000-4000-8000-000000000003';
const CHICKPEA_STEW = '00000000-0000-4000-8000-000000000008';
const WEEK_PLAN = [
  { recipeId: PASTA, servings: 4 },
  { recipeId: CHICKPEA_STEW, servings: 4 },
  { recipeId: BEEF_STEW, servings: 6 },
];

async function generate(page: Page) {
  const res = await page.context().request.post('/api/dev/seed', { data: { kind: 'approved-plan', entries: WEEK_PLAN } });
  expect(res.ok()).toBe(true);
  const { planId } = (await res.json()) as { planId: string };
  await page.goto(`/shopping?plan=${planId}`);
  await expect(tickBox(page, 'Onion')).toBeVisible();
  await expect(page).toHaveURL(/\/shopping$/, { timeout: 45_000 });
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

test.describe('installable PWA', () => {
  test('manifest, icons and the manifest link', async ({ page, request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = (await res.json()) as { name: string; display: string; start_url: string; theme_color: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/shopping');
    expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    await page.goto('/sign-in');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
});

test.describe('offline shopping list', () => {
  test('a list opened online reopens offline, keeps offline ticks across reloads, and replays them once on reconnect', async ({ browser }) => {
    const household = newHousehold();
    const ctx = await browser.newContext();
    const other = await browser.newContext();
    try {
      const page = await open(ctx, household, '/shopping');
      await generate(page);
      // The worker controls the page and has kept the page + the assets it loaded.
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect(async () => {
        const kept = await page.evaluate(async () => {
          const keys = await caches.keys();
          const pages = keys.includes('fr-pages-v1') ? (await (await caches.open('fr-pages-v1')).keys()).map((r) => new URL(r.url).pathname) : [];
          const statics = keys.includes('fr-static-v1') ? (await (await caches.open('fr-static-v1')).keys()).length : 0;
          return { pages, statics };
        });
        expect(kept.pages).toContain('/shopping');
        expect(kept.statics).toBeGreaterThan(3);
      }).toPass({ timeout: 30_000 });
      // The snapshot is on the device (IndexedDB) too.
      await expect(async () => {
        const has = await page.evaluate(() => new Promise<boolean>((resolve) => {
          const req = indexedDB.open('fr-offline');
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('kv')) { resolve(false); return; }
            const get = db.transaction('kv').objectStore('kv').get('shopping.snapshot.v1');
            get.onsuccess = () => resolve(!!get.result);
            get.onerror = () => resolve(false);
          };
          req.onerror = () => resolve(false);
        }));
        expect(has).toBe(true);
      }).toPass({ timeout: 30_000 });

      await ctx.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Shopping list' })).toBeVisible();
      await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
      await expect(page.getByTestId('offline-banner')).toBeVisible();
      await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline');
      await expect(tickBox(page, 'Garlic')).toBeVisible(); // the last list this device saw

      // Tick and edit offline: queued with the engine's command ids, shown at once, kept in IndexedDB.
      await tickBox(page, 'Garlic').click();
      await expect(tickBox(page, 'Garlic')).toHaveCount(0);
      await expect(page.getByTestId('offline-banner')).toContainText('1 waiting');

      // A reload while still offline: the queued tick is restored from IndexedDB and still shows.
      await page.reload();
      await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
      await expect(page.getByTestId('offline-banner')).toContainText('1 waiting');
      await expect(tickBox(page, 'Garlic')).toHaveCount(0);

      // Back online: replayed, confirmed by the server, banner gone.
      await ctx.setOffline(false);
      await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced', { timeout: 30_000 });
      await expect(page.getByTestId('offline-banner')).toHaveCount(0);

      // Another device of the same household sees exactly one purchase.
      const second = await open(other, household, '/shopping');
      await expect(second.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
      await second.getByLabel('Show completed items').check();
      await expect(second.getByTestId('purchase-row').filter({ hasText: 'Garlic' })).toHaveCount(1);
    } finally {
      await ctx.close();
      await other.close();
    }
  });

  test('a page that was never opened online gives a plain offline notice, not a browser error page', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await open(ctx, newHousehold(), '/sign-in'); // registers nothing for the shopping page
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
      await ctx.setOffline(true);
      await page.goto('/recipes').catch(() => undefined);
      await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe('phone as the scanner', () => {
  const BEANS = '5009000000015';
  const FUSILLI = '5009000000046';
  const jpeg = readFileSync(fileURLToPath(new URL('../fixtures/receipts/r1-weekly-shop.png', import.meta.url)));

  async function startSession(desktop: Page): Promise<string> {
    // A click before hydration is lost, and the first call to a route compiles it (dev): click again only while nothing happened.
    await expect(async () => {
      if ((await desktop.getByTestId('phone-qr').count()) === 0) await desktop.getByTestId('use-my-phone').click({ timeout: 2_000 }).catch(() => undefined);
      await expect(desktop.getByTestId('phone-qr')).toBeVisible({ timeout: 8_000 });
    }).toPass({ timeout: 60_000 });
    const link = await desktop.getByTestId('phone-scanner').getAttribute('data-link');
    expect(link).toMatch(/\/scan\/phone\?s=[0-9a-f-]{36}#t=[A-Za-z0-9_-]{43}$/);
    return link!;
  }

  test('barcodes and a photo from the phone appear on the desktop; nothing is saved; a second phone and a stopped session are refused', async ({ browser }) => {
    const household = newHousehold();
    const desk = await browser.newContext();
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 800 } }); // no cookies: the phone is not signed in
    const intruder = await browser.newContext();
    try {
      const desktop = await open(desk, household, '/pantry/scan');
      const link = await startSession(desktop);
      // The token is only in the fragment: the desktop page's own address and the server never see it.
      expect(desktop.url()).not.toContain(link.split('#t=')[1]!);

      const phone = await phoneCtx.newPage();
      await phone.goto(link);
      await expect(phone.getByRole('heading', { name: 'Scanning for your pantry' })).toBeVisible({ timeout: 20_000 });
      expect(phone.url()).not.toContain('#t='); // the secret is removed from the phone's address bar once read
      await expect(desktop.getByTestId('phone-status')).toContainText('Phone connected', { timeout: 20_000 });

      for (const code of [BEANS, FUSILLI]) {
        await phone.getByTestId('phone-ean-input').fill(code);
        await phone.getByTestId('phone-ean-add').click();
      }
      await expect(phone.getByTestId('phone-sent')).toContainText('2 sent', { timeout: 20_000 });

      // Live on the desktop: the continuous-scan tally shows both, counted once each.
      const tally = desktop.getByTestId('rapid-tally');
      await expect(tally.locator(`[data-barcode="${BEANS}"] [data-testid="tally-count"]`)).toHaveText('×1', { timeout: 20_000 });
      await expect(tally.locator(`[data-barcode="${FUSILLI}"]`)).toBeVisible();
      await expect(desktop.getByTestId('phone-status')).toContainText('2 scans received');

      // The same pack again from the phone adds one (the desktop counts it like a camera read).
      await phone.getByTestId('phone-ean-input').fill(BEANS);
      await phone.getByTestId('phone-ean-add').click();
      await expect(tally.locator(`[data-barcode="${BEANS}"] [data-testid="tally-count"]`)).toHaveText('×2', { timeout: 20_000 });

      // A photo from the phone joins the photos to scan on the desktop.
      await phone.getByTestId('phone-photo-input').setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: jpeg });
      await expect(phone.getByTestId('phone-photo-note')).toContainText(/Photo sent|could not be shrunk/, { timeout: 20_000 });
      await expect(desktop.getByTestId('phone-status')).toContainText('4 scans received', { timeout: 20_000 });

      // A second phone with the same code is refused while the first is connected.
      const other = await intruder.newPage();
      await other.goto(link);
      await expect(other.getByTestId('phone-fatal')).toContainText('Another phone is already scanning');

      // Nothing was written to the pantry: the desktop review has not been confirmed.
      const pantry = await desk.request.get('/api/pantry');
      expect(pantry.ok()).toBe(true);

      // "Stop" on the desktop ends the session: the phone's next scan says so, and nothing more is accepted.
      await desktop.getByTestId('phone-stop').click();
      await phone.getByTestId('phone-ean-input').fill(FUSILLI);
      await phone.getByTestId('phone-ean-add').click();
      await expect(phone.getByTestId('phone-message')).toContainText('ended this scanning session', { timeout: 20_000 });
    } finally {
      await desk.close();
      await phoneCtx.close();
      await intruder.close();
    }
  });

  test('a photo from the phone becomes the receipt photo on the desktop', async ({ browser }) => {
    const household = newHousehold();
    const desk = await browser.newContext();
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    try {
      const desktop = await open(desk, household, '/receipts');
      const link = await startSession(desktop);
      const phone = await phoneCtx.newPage();
      await phone.goto(link);
      await expect(phone.getByRole('heading', { name: 'Photographing a receipt' })).toBeVisible({ timeout: 20_000 });
      await expect(phone.getByTestId('phone-ean-input')).toHaveCount(0); // barcodes make no sense for a receipt
      await phone.getByTestId('phone-photo-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: jpeg });
      await expect(desktop.getByTestId('receipt-from-phone')).toBeVisible({ timeout: 30_000 });
      const files = await desktop.locator('#receipt-file').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
      expect(files).toBe(1);
    } finally {
      await desk.close();
      await phoneCtx.close();
    }
  });

  test('bad or missing links explain themselves and an unknown session is refused without detail', async ({ page }) => {
    await page.goto('/scan/phone');
    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
    await page.goto('/scan/phone?s=3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f#t=abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE');
    await expect(page.getByTestId('phone-fatal')).toContainText('not valid', { timeout: 20_000 });
    // The public routes answer the same 403 for a wrong token as for an unknown session.
    const res = await page.request.post('/api/scanner/phone/connect', { data: { sessionId: '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f', token: 'x'.repeat(43), device: 'device-one-0123456789' } });
    expect(res.status()).toBe(403);
  });
});
