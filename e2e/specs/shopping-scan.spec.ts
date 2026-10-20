// Handwritten shopping list scan (SL1, D260-D267) with the mock AI provider: a fixed sample list, no live model call.
// Each test uses its own sandbox household (mock auth cookie), so the in-memory lists never collide.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { enterHousehold, newHouseholdId } from '../support/helpers';

const photo = (color: string) =>
  sharp({ create: { width: 480, height: 640, channels: 3, background: color } }).jpeg().toBuffer()
    .then((buffer) => ({ name: `${color.slice(1)}.jpg`, mimeType: 'image/jpeg', buffer }));
const row = (page: Page, text: string) => page.getByRole('listitem', { name: `Line from your list: ${text}` });

async function seedItem(context: BrowserContext, name: string, value: number, unit: string) {
  const res = await context.request.post('/api/dev/seed', { data: { kind: 'shopping-item', name, value, unit } });
  expect(res.ok()).toBe(true);
}

async function startScan(page: Page, context: BrowserContext, household: string) {
  await enterHousehold(context, household);
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

async function readList(page: Page) {
  await page.getByTestId('photo-input').setInputFiles([await photo('#c8b88a')]);
  await expect(page.getByTestId('thumb')).toHaveCount(1);
  await page.getByRole('button', { name: /Read my list/ }).click();
  await expect(page.getByTestId('scan-row')).toHaveCount(11);
}

test('the shopping page offers a prominent scan button and an empty-state entry', async ({ page, context }) => {
  await startScan(page, context, newHouseholdId('sl1a'));
  await expect(page.getByTestId('empty-scan-link')).toBeVisible();
  const scan = page.getByTestId('scan-list-link');
  await expect(scan).toHaveText(/Scan a handwritten list/);
  await scan.click();
  await expect(page).toHaveURL(/\/shopping\/scan$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Scan a handwritten list' })).toBeVisible();
  await expect(page.getByTestId('mock-banner')).toBeVisible();
  await expect(page.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
});

test('photo -> review -> add to the existing list: quantities combine, nothing is written before confirm', async ({ page, context }) => {
  const household = newHouseholdId('sl1b');
  await enterHousehold(context, household);
  await seedItem(context, 'banana', 3, 'item');
  await seedItem(context, 'plain flour', 250, 'g');
  await page.goto('/shopping/scan');
  await page.route('**/api/shopping/scan', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await page.getByTestId('photo-input').setInputFiles([await photo('#c8b88a')]);
  await page.getByRole('button', { name: /Read my list/ }).click();
  await expect(page.getByTestId('scanning')).toContainText('Reading your list');
  await expect(page.getByTestId('scan-row')).toHaveCount(11);
  await expect(page.getByText('Nothing has been added yet')).toBeVisible();

  // Transcription next to the parsed item.
  const spuds = row(page, '1kg spuds');
  await expect(spuds.getByTestId('match-badge')).toContainText('Read as: potato');
  await expect(spuds.getByLabel('Quantity')).toHaveValue('1');
  await expect(spuds.getByLabel('Unit')).toHaveValue('kg');
  await expect(row(page, 'eggs').getByLabel('Quantity')).toHaveValue('');
  await expect(row(page, 'cheddar - if on offer').getByLabel('Note')).toHaveValue('if on offer');
  // Crossed-out and illegible lines start excluded, with badges.
  await expect(row(page, 'butter').getByTestId('crossed-badge')).toBeVisible();
  await expect(row(page, 'butter').getByRole('checkbox', { name: /Include butter/ })).not.toBeChecked();
  await expect(row(page, 'choc b???').getByTestId('illegible-badge')).toBeVisible();
  await expect(row(page, 'choc b???').getByRole('checkbox')).not.toBeChecked();
  await expect(row(page, 'eggs').getByRole('checkbox')).toBeChecked();
  // Unmatched food-ish name is free text under the Household aisle.
  await expect(row(page, 'washing up liquid').getByLabel('Item name')).toHaveValue('washing up liquid');
  await expect(row(page, 'washing up liquid').getByLabel('Aisle')).toHaveValue('Household');

  // Merge preview: before -> after.
  await expect(page.getByTestId('dest-current')).toBeChecked();
  const preview = page.getByTestId('merge-preview');
  const banana = preview.getByTestId('preview-line').filter({ hasText: 'banana' });
  await expect(banana).toContainText('3');
  await expect(banana).toContainText('9');
  await expect(banana).toContainText('Combined with your list');
  await expect(preview.getByTestId('preview-line').filter({ hasText: 'plain flour' })).toContainText('750 g');

  // Nothing written yet: the list still has only the two seeded items.
  const before = await context.newPage();
  await before.goto('/shopping');
  await expect(before.locator('[data-item-name]')).toHaveCount(2);
  await before.close();

  // Edit a quantity in review, then confirm.
  await row(page, '2 x milk').getByLabel('Quantity').fill('3');
  await page.getByTestId('confirm-scan').click();
  await expect(page.getByTestId('scan-done')).toContainText('combined 2 with items already on the list');
  await page.getByRole('link', { name: 'Go to my shopping list' }).click();
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
  const item = (name: string) => page.locator(`[data-item-name="${name}"]`);
  await expect(item('banana')).toHaveCount(1);
  await expect(item('banana')).toContainText('9');
  await expect(item('plain flour')).toContainText('750 g');
  await expect(item('milk')).toContainText('3');
  await expect(item('butter')).toHaveCount(0); // crossed out: left out
  await expect(page.getByTestId('list-name')).toHaveText('Shopping list');
});

test('photo -> review -> create a new list: old list kept, new list has only the scanned items, switch back', async ({ page, context }) => {
  const household = newHouseholdId('sl1c');
  await enterHousehold(context, household);
  await seedItem(context, 'banana', 3, 'item');
  await page.goto('/shopping/scan');
  await readList(page);
  await page.getByTestId('dest-new').check();
  const name = page.getByTestId('new-list-name');
  await expect(name).toHaveValue(/^Shopping list - \d{1,2} [A-Z][a-z]{2}$/);
  await name.fill('Saturday shop');
  await expect(page.getByText('The new list "Saturday shop"')).toBeVisible();
  // A new list starts empty: banana is new (6), not merged into the old 3.
  await expect(page.getByTestId('merge-preview').getByTestId('preview-line').filter({ hasText: 'banana' })).toContainText('New');
  await page.getByTestId('confirm-scan').click();
  await expect(page.getByTestId('scan-done')).toContainText('Created "Saturday shop"');
  await page.getByRole('link', { name: 'Go to my shopping list' }).click();
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.getByTestId('list-name')).toHaveText('Saturday shop');
  await expect(page.locator('[data-item-name="banana"]')).toContainText('6');

  // The old list is kept: switch back from the Lists sheet.
  await page.getByTestId('lists-button').click();
  const archived = page.getByTestId('archived-lists');
  await expect(archived).toContainText('Shopping list');
  await archived.getByRole('button', { name: 'Switch to Shopping list' }).click();
  await expect(page.getByTestId('list-name')).toHaveText('Shopping list');
  await expect(page.locator('[data-item-name="banana"]')).toContainText('3');
});

test('a double submit of confirm does not add twice', async ({ page, context }) => {
  await enterHousehold(context, newHouseholdId('sl1d'));
  await seedItem(context, 'banana', 3, 'item');
  await page.goto('/shopping/scan');
  await readList(page);
  const confirm = page.getByTestId('confirm-scan');
  await confirm.dblclick();
  await expect(page.getByTestId('scan-done')).toBeVisible();
  await page.getByRole('link', { name: 'Go to my shopping list' }).click();
  await expect(page.locator('[data-item-name="banana"]')).toContainText('9');
  await expect(page.locator('[data-item-name="banana"]')).toHaveCount(1);
});

test('review step: no serious/critical axe violations and 44px targets at 375px', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await enterHousehold(context, newHouseholdId('sl1e'));
  await page.goto('/shopping/scan');
  await readList(page);
  await page.getByTestId('dest-new').check();
  await expect(page.getByTestId('merge-preview')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))).toEqual([]);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type=hidden]), summary')) {
      if (el.closest('.fr-visually-hidden') || el.classList.contains('fr-visually-hidden') || /^Skip to/.test(el.textContent ?? '')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = el.closest('label');
      const box = label && el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? label.getBoundingClientRect() : r;
      if (box.height < 43.5 || box.width < 43.5) out.push(`${el.tagName} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return out;
  });
  expect(small, small.join(' | ')).toEqual([]);
});

test('capture step: rotate and remove photos; at most four', async ({ page, context }) => {
  await enterHousehold(context, newHouseholdId('sl1f'));
  await page.goto('/shopping/scan');
  const files = await Promise.all(['#c8b88a', '#aabbcc', '#ccbbaa', '#99aa88', '#887766'].map(photo));
  await page.getByTestId('photo-input').setInputFiles(files);
  await expect(page.getByTestId('thumb')).toHaveCount(4);
  await expect(page.getByTestId('capture-notice')).toContainText('up to 4');
  await page.getByRole('button', { name: 'Rotate photo 1 clockwise' }).click();
  await expect(page.getByTestId('capture-working')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove photo 2' }).click();
  await expect(page.getByTestId('thumb')).toHaveCount(3);
});
