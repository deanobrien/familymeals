// Continuous barcode scanning in /pantry/scan (BS1). Runs in the `chromium-camera` project: Chromium's fake camera plays a
// generated video of barcodes (e2e/support/fake-camera.ts: BEANS, gap, BEANS again, gap, FUSILLI, gap, an UNKNOWN code, gap,
// looping), so getUserMedia, the frame loop and the real zxing-wasm decoder all run (headless Chromium has no BarcodeDetector).
// Product data is the offline mock provider: no network.
import { expect, test, type Page } from '@playwright/test';
import { CAMERA_CODES } from '../support/fake-camera';

test.describe.configure({ mode: 'serial' });

const { beans: BEANS, fusilli: FUSILLI, unknown: UNKNOWN } = CAMERA_CODES;
const rowOf = (page: Page, code: string) => page.locator(`[data-testid="tally-row"][data-barcode="${code}"]`);
const countOf = (page: Page, code: string) => rowOf(page, code).getByTestId('tally-count');

async function openRapid(page: Page, query = '') {
  await page.goto(`/pantry/scan${query}`);
  const open = page.getByTestId('rapid-open');
  if (await open.count()) {
    // A click before hydration is lost: retry until the scanner appears.
    await expect(async () => {
      await open.click();
      await expect(page.getByTestId('rapid-step')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  }
  await expect(page.getByTestId('rapid-step')).toBeVisible();
}

async function typeCode(page: Page, code: string) {
  const input = page.getByTestId('rapid-ean-input');
  const add = page.getByTestId('rapid-ean-add');
  await expect(async () => {
    await input.fill(code);
    await expect(add).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await add.click();
}

test('a fake camera feed is decoded continuously: counts once while held, again after moving away, tallies progressively, then review and confirm', async ({ page }) => {
  await openRapid(page, '?decoder=wasm');
  // Count green flashes (they last a third of a second: observe the DOM rather than poll for them).
  await page.evaluate(() => {
    (window as unknown as { __flashes: number }).__flashes = 0;
    new MutationObserver((ms) => {
      for (const m of ms) m.addedNodes.forEach((n) => { if ((n as HTMLElement).dataset?.testid === 'scan-flash') (window as unknown as { __flashes: number }).__flashes++; });
    }).observe(document.body, { childList: true, subtree: true });
  });

  const start = page.getByTestId('rapid-start');
  await expect(async () => {
    if ((await start.count()) && (await start.isEnabled())) await start.click(); // a click before hydration is lost
    await expect(page.getByTestId('rapid-scanner')).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('rapid-scanner')).toHaveAttribute('data-decoder', 'wasm', { timeout: 30_000 });
  await expect(page.getByTestId('rapid-video')).toBeVisible();

  // The first read adds the product at once ("looking up" or already named), count 1, announced for screen readers...
  await expect(countOf(page, BEANS)).toHaveText('×1', { timeout: 60_000 });
  await expect(page.getByTestId('rapid-announce')).toContainText(/Added .*1 item scanned/);
  // ...and holding the pack in view (2.5 s of video) is still one.
  await page.waitForTimeout(1500);
  await expect(countOf(page, BEANS)).toHaveText('×1');
  // The name resolves in the background without blocking the scanning.
  await expect(rowOf(page, BEANS).getByTestId('tally-name')).toHaveText('Hearth & Field Baked Beans in Tomato Sauce', { timeout: 20_000 });

  // The pack goes away and comes back: a deliberate re-scan counts.
  await expect(countOf(page, BEANS)).toHaveText(/×[2-9]/, { timeout: 30_000 });
  await expect(rowOf(page, FUSILLI)).toBeVisible({ timeout: 30_000 });
  await expect(rowOf(page, UNKNOWN).getByTestId('tally-name')).toHaveText('Unknown product', { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __flashes: number }).__flashes)).toBeGreaterThanOrEqual(4);

  // Accessibility: every control is named and at least 44px; the tally is a labelled list.
  await expect(page.getByRole('list', { name: 'Scanned products' })).toBeVisible();
  for (const b of [page.getByTestId('rapid-pause'), page.getByTestId('rapid-undo'), page.getByTestId('rapid-done'), rowOf(page, BEANS).getByTestId('tally-minus'), rowOf(page, BEANS).getByTestId('tally-plus')]) {
    const box = await b.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect(box!.width).toBeGreaterThanOrEqual(43.5);
  }
  await expect(page.getByRole('button', { name: /^Add one Hearth & Field Baked Beans/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Remove one Hearth & Field Baked Beans/ })).toBeVisible();

  // Pause stops counting (the video keeps looping behind it).
  await page.getByTestId('rapid-pause').click();
  await expect(page.getByTestId('rapid-scanner')).toHaveAttribute('data-paused', 'true');
  const frozen = await page.getByTestId('rapid-counter').innerText();
  await page.waitForTimeout(6000);
  expect(await page.getByTestId('rapid-counter').innerText()).toBe(frozen);

  // Done -> the existing review: dates empty and optional, the unknown product needs a name, merge preview, confirm all.
  await page.getByTestId('rapid-done').click();
  await expect(page.getByTestId('rapid-review-note')).toContainText('Add dates later');
  const beans = page.getByRole('listitem', { name: /Scanned item: Hearth & Field Baked Beans/ });
  await expect(beans.getByLabel('Count')).toHaveValue(/^[2-9]$/);
  await expect(beans.getByTestId('match-badge')).toContainText('Matched: baked beans');
  await expect(beans.getByLabel('Use by')).toBeHidden(); // dates are collapsed...
  await beans.getByText('Dates and close-up (optional)').click();
  await expect(beans.getByLabel('Best before')).toHaveValue(''); // ...and empty
  await expect(page.getByRole('listitem', { name: /Scanned item: Hearth & Field Wholewheat Fusilli/ })).toBeVisible();
  const unknown = page.locator('[data-testid="scan-row"]').filter({ hasText: UNKNOWN });
  await expect(unknown.getByTestId('lookup-note')).toContainText('Not found');
  await expect(page.getByRole('button', { name: /^Add \d+ items? to pantry$/ })).toBeDisabled(); // unknown row has no name yet
  await unknown.getByLabel('Name', { exact: true }).fill('Gran’s chutney');
  await expect(page.getByTestId('merge-preview')).toContainText('Gran’s chutney');
  await expect(page.getByTestId('merge-preview')).toContainText('baked beans');

  await page.getByRole('button', { name: /^Add 3 items to pantry$/ }).click();
  await expect(page.getByTestId('scan-done')).toContainText('Added 3 items to your pantry');
  // The tally is cleared after confirming.
  await page.getByRole('button', { name: 'Scan more' }).click();
  await expect(page.getByTestId('rapid-open')).toHaveText('Scan barcodes continuously');
  await page.goto('/pantry');
  await expect(page.getByRole('list', { name: 'Tinned and jarred' })).toContainText('baked beans');
});

test('typed codes, + / - / undo, and a refresh restores the tally; nothing is written before confirm', async ({ page }) => {
  await openRapid(page);
  await typeCode(page, BEANS);
  await expect(countOf(page, BEANS)).toHaveText('×1');
  await expect(rowOf(page, BEANS).getByTestId('tally-name')).toHaveText(/Baked Beans/, { timeout: 20_000 });
  await typeCode(page, BEANS); // typing is deliberate: counts straight away
  await expect(countOf(page, BEANS)).toHaveText('×2');
  await rowOf(page, BEANS).getByTestId('tally-plus').click();
  await expect(countOf(page, BEANS)).toHaveText('×3');
  await rowOf(page, BEANS).getByTestId('tally-minus').click();
  await expect(countOf(page, BEANS)).toHaveText('×2');
  await typeCode(page, FUSILLI);
  await expect(page.getByTestId('rapid-counter')).toContainText('3 items scanned');
  await page.getByTestId('rapid-undo').click(); // undo the fusilli
  await expect(rowOf(page, FUSILLI)).toHaveCount(0);
  await expect(page.getByTestId('rapid-counter')).toContainText('2 items scanned');

  await page.getByTestId('rapid-ean-input').fill('1234');
  await page.getByTestId('rapid-ean-add').click();
  await expect(page.getByText('Enter the 8, 12 or 13 digits')).toBeVisible();

  // An accidental refresh: back in the scanner with the tally, and lookups resolve again.
  await page.reload();
  await expect(page.getByTestId('rapid-restored')).toContainText('We kept your 2 scanned items');
  await expect(countOf(page, BEANS)).toHaveText('×2');
  await expect(rowOf(page, BEANS).getByTestId('tally-name')).toHaveText(/Baked Beans/, { timeout: 20_000 });

  await page.getByTestId('rapid-clear').click();
  await expect(page.getByTestId('rapid-empty')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('rapid-open')).toBeVisible(); // nothing restored
});

test('lookups resolve progressively: Done does not wait, rows fill in later, and an item can be named by hand meanwhile', async ({ page }) => {
  // The first poll for BEANS answers "pending" (as when Open Food Facts is rate limited); later polls go to the real mock.
  let calls = 0;
  await page.route('**/api/products', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as { codes: string[] };
    if (body.codes.includes(BEANS) && ++calls <= 6) {
      const real = await route.fetch();
      const json = (await real.json()) as { results: Record<string, unknown> };
      json.results[BEANS] = { status: 'pending' };
      return route.fulfill({ response: real, json });
    }
    return route.fallback();
  });
  await openRapid(page, '?mode=rapid');
  await typeCode(page, BEANS);
  await typeCode(page, FUSILLI);
  await expect(rowOf(page, BEANS).getByTestId('tally-name')).toHaveText('Looking up...');
  await expect(page.getByTestId('rapid-counter')).toContainText('looking up');
  await page.getByTestId('rapid-done').click();

  // Review opens at once; the unresolved row is a placeholder and confirm waits for it.
  const pending = page.locator('[data-testid="scan-row"][data-lookup="pending"]');
  await expect(pending).toHaveCount(1);
  await expect(page.getByTestId('rapid-waiting')).toContainText('Still looking up 1 product');
  await expect(page.getByRole('button', { name: /^Add \d+ items? to pantry$/ })).toBeDisabled();
  await expect(pending.getByRole('status')).toContainText('Looking this product up');

  // ...and it fills itself in when the lookup lands, keeping what was set.
  await expect(page.getByRole('listitem', { name: /Scanned item: Hearth & Field Baked Beans/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('listitem', { name: /Scanned item: Hearth & Field Baked Beans/ }).getByTestId('match-badge')).toContainText('baked beans');
  await expect(page.getByRole('button', { name: /^Add 2 items to pantry$/ })).toBeEnabled();
});
