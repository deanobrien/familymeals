// Barcode scanning in /pantry/scan (X2) with the offline MOCK product provider: no network. Camera detection is not
// available in headless Chromium, so the flow is driven by manual EAN entry (the documented fallback); the detection
// loop itself is unit-tested. Fixture barcodes are fictional products with valid check digits (packages/product-sources).
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const BEANS = '5009000000015';
const FUSILLI = '5009000000046';
const MYSTERY = '5009000000053';
const row = (page: Page, name: string) => page.getByRole('listitem', { name: `Scanned item: ${name}` });

async function lookup(page: Page, digits: string) {
  const input = page.getByTestId('ean-input');
  const button = page.getByTestId('ean-lookup');
  // A value typed before hydration is lost to React state: retry the fill until the button enables.
  await expect(async () => {
    await input.fill(digits);
    await expect(button).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await button.click();
}

test('manual EAN entry fills a review row from the product; dates are left for the owner; nothing is written until confirm', async ({ page }) => {
  await page.goto('/pantry/scan');
  await expect(page.getByRole('heading', { name: 'Scan a barcode' })).toBeVisible();
  await lookup(page, BEANS);
  await expect(page.getByTestId('barcode-status')).toContainText('Found: Hearth & Field Baked Beans');
  await page.getByTestId('review-barcodes').click();

  const beans = row(page, 'Hearth & Field Baked Beans in Tomato Sauce');
  await expect(beans.getByTestId('barcode-badge')).toContainText(`From barcode ${BEANS}`);
  await expect(beans.getByTestId('match-badge')).toContainText('Matched: baked beans');
  await expect(beans.getByLabel('Count')).toHaveValue('1');
  await expect(beans.getByLabel('Quantity')).toHaveValue('1');
  await expect(beans.getByLabel('Unit')).toHaveValue('can');
  await expect(beans).toContainText('415 g each');
  await expect(beans.getByLabel('Use by')).toHaveValue('');
  await expect(beans.getByLabel('Best before')).toHaveValue('');

  // Provenance, allergens and attribution shown with the product data.
  const info = beans.getByTestId('product-info');
  await expect(info.getByTestId('product-allergens')).toContainText('No allergens listed (check the pack)');
  await expect(info.getByTestId('product-attribution')).toContainText('Product data © Open Food Facts contributors, ODbL');
  await expect(info.getByRole('link', { name: 'This product on Open Food Facts' })).toHaveAttribute('href', new RegExp(`/product/${BEANS}$`));
  await info.getByText('Nutrition per 100 g').click();
  await expect(info.getByTestId('product-nutrition')).toContainText('78 kcal');

  // Not in the pantry yet.
  const other = await page.context().newPage();
  await other.goto('/pantry');
  await expect(other.getByRole('list', { name: 'Tinned and jarred' })).not.toContainText('baked beans');
  await other.close();

  // A date can be typed in the review (it is not on the barcode).
  await beans.getByLabel('Best before').fill('2027-03-01');
  await page.getByRole('button', { name: 'Add 1 item to pantry' }).click();
  await expect(page.getByTestId('scan-done')).toContainText('Added 1 item to your pantry');
  await page.getByRole('link', { name: 'Back to pantry' }).click();
  const tins = page.getByRole('list', { name: 'Tinned and jarred' });
  await expect(tins).toContainText('baked beans');
  await expect(tins).toContainText('1 can');
});

test('the same barcode twice adds to the count; allergens and unknown data are shown honestly', async ({ page }) => {
  await page.goto('/pantry/scan');
  await lookup(page, FUSILLI);
  await expect(page.getByTestId('barcode-status')).toContainText('Wholewheat Fusilli');
  await lookup(page, FUSILLI.replace(/(\d{4})(\d{4})(\d{5})/, '$1 $2 $3')); // spaces are tolerated
  await lookup(page, MYSTERY);
  await expect(page.getByTestId('barcode-status')).toContainText('Mystery Sauce');
  await page.getByTestId('review-barcodes').click();
  await expect(page.getByTestId('scan-row')).toHaveCount(2);

  const pasta = row(page, 'Hearth & Field Wholewheat Fusilli');
  await expect(pasta.getByLabel('Count')).toHaveValue('2');
  await expect(pasta.getByLabel('Quantity')).toHaveValue('1000');
  await expect(pasta.getByLabel('Unit')).toHaveValue('g');
  await expect(pasta.getByTestId('product-allergens')).toContainText('Contains Cereals containing gluten');
  await expect(pasta.getByTestId('product-allergens')).toContainText('May contain Eggs');

  // No ingredient match is pre-selected: the owner must choose an ingredient or name it, and no allergen data is flagged.
  const mystery = row(page, 'Hearth & Field Mystery Sauce');
  await expect(mystery.getByTestId('match-badge')).toHaveCount(0);
  await expect(mystery.getByTestId('product-allergens')).toContainText('No allergen information on this record: check the pack');
  await mystery.getByText('Nutrition per 100 ml').click();
  await expect(mystery.getByTestId('product-nutrition')).toContainText('not on the record');
});

test('bad, unknown and unreadable barcodes give a clear message and add nothing', async ({ page }) => {
  await page.goto('/pantry/scan');
  await lookup(page, '1234');
  await expect(page.getByTestId('barcode-error')).toContainText('8, 12 or 13 digits');
  await lookup(page, '5009000000011'); // right length, wrong check digit
  await expect(page.getByTestId('barcode-error')).toContainText('not a valid barcode');
  await lookup(page, '4006381333931'); // valid, not in the fixtures
  await expect(page.getByTestId('barcode-error')).toContainText('could not find that product');
  await expect(page.getByTestId('review-barcodes')).toHaveCount(0);
  // Camera scanning is a progressive enhancement; manual entry is always there.
  await expect(page.getByTestId('ean-input')).toBeVisible();
});

test('the lookup API is gated, and the sources page carries the Open Food Facts attribution', async ({ page, request }) => {
  const res = await request.get(`/api/products/${BEANS}`);
  expect(res.status()).toBe(200); // mock-auth demo household
  const body = await res.json();
  expect(body.product.source.publisher).toBe('Open Food Facts');
  expect((await request.get('/api/products/123')).status()).toBe(400);

  await page.goto('/about/sources');
  await expect(page.getByRole('heading', { level: 1, name: 'Data sources' })).toBeVisible();
  await expect(page.getByTestId('off-attribution')).toContainText('Product data © Open Food Facts contributors, ODbL');
  await page.goto('/privacy');
  await expect(page.getByText('Open Food Facts:').first()).toBeVisible();
});
