// P2-B (D400-D409): price comparison per shop and budget tracking. Each test uses its own sandbox household (mock auth,
// `fr_household` cookie) so lists, prices and spend never leak into other specs. Dates are relative to the real clock
// (UK date) because the server uses it.
import { expect, test, type BrowserContext } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const sandbox = (name: string) => `e2e-p2b-${name}-${Date.now().toString(36)}`;
const useHousehold = async (context: BrowserContext, id: string) =>
  context.addCookies([{ name: 'fr_household', value: id, domain: 'localhost', path: '/' }]);
const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const daysAgo = (n: number) => new Date(Date.parse(`${ukToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test.describe('spending page', () => {
  test.beforeEach(async ({ context }) => useHousehold(context, sandbox('spend')));

  test('shows budget, planned estimate and actual separately, takes a manual entry and exports CSV', async ({ page, context }) => {
    await page.goto('/spending');
    await expect(page.getByRole('heading', { level: 1, name: 'Spending' })).toBeVisible();
    await expect(page.getByTestId('budget-value')).toContainText('£');
    await expect(page.getByTestId('planned-value')).toContainText('No approved plan');
    await expect(page.getByTestId('spend-chart')).toBeVisible();
    await expect(page.getByRole('list', { name: 'How to read this page' })).toContainText('Planned figures are estimates');

    const before = await page.getByTestId('actual-value').innerText();
    await page.getByLabel('Amount (£)').fill('12.50');
    await page.getByLabel('Shop name').fill('Market stall');
    await page.getByLabel('Category').selectOption('Fruit & veg');
    await page.getByLabel('Note').fill('berries');
    await page.getByRole('button', { name: 'Add spending' }).click();
    const row = page.getByTestId('spend-row').filter({ hasText: 'Market stall' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('£12.50');
    await expect(row).toContainText('Entered by hand');
    await expect(page.getByTestId('actual-value')).not.toHaveText(before);
    await expect(page.getByTestId('category-breakdown')).toContainText('Fruit & veg');

    // bad amount is refused with a message, nothing is added
    await page.getByLabel('Amount (£)').fill('abc');
    await page.getByRole('button', { name: 'Add spending' }).click();
    await expect(page.getByTestId('add-spend-form').getByRole('alert')).toContainText('Enter an amount');

    // chart has a table alternative
    await page.getByText('View as a table').click();
    await expect(page.getByRole('table', { name: /Per week/ })).toBeVisible();

    const csv = await context.request.get('/api/money/spending/csv?weeks=4');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toBe('Date,Week starting,Source,Shop,Category,Amount (GBP),Note');
    expect(text).toContain('Market stall,Fruit & veg,12.50,berries');

    await row.getByRole('button', { name: /Delete/ }).click();
    await expect(page.getByTestId('spend-row').filter({ hasText: 'Market stall' })).toHaveCount(0);
  });

  test('the Home widget and the nav link show spending', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('spending-widget')).toContainText('Spending this week');
    await expect(page.getByTestId('widget-actual')).toContainText('£');
    await page.getByRole('link', { name: 'Open spending' }).click();
    await expect(page).toHaveURL(/\/spending$/);
  });
});

test.describe('price comparison per shop', () => {
  test.beforeEach(async ({ context }) => useHousehold(context, sandbox('prices')));

  test('cheapest-at badge on the list, the where-is-cheapest panel, and the price history with a price you saw', async ({ page, context }) => {
    const found = await context.request.get('/api/catalogue/search?q=basmati');
    const candidates = ((await found.json()) as { candidates: { id: string; name: string }[] }).candidates;
    const rice = candidates[0]!;
    expect(rice).toBeTruthy();

    const price = (retailer: string, pricePence: number, packValue: number, packUnit: string, observedOn: string) =>
      context.request.post('/api/money/prices', { data: { action: 'add', ingredientId: rice.id, retailer, pricePence, packValue, packUnit, observedOn } });
    expect((await price('ALDI', 150, 500, 'g', daysAgo(3))).status()).toBe(200); // £3.00 per kg
    // one shop only: nothing to compare yet
    const hist = await context.request.get(`/api/money/prices?ingredientId=${rice.id}`);
    expect(((await hist.json()) as { view: { comparison: { badge: string | null } } }).view.comparison.badge).toBeNull();
    expect((await price('LIDL', 230, 1, 'kg', daysAgo(5))).status()).toBe(200); // £2.30 per kg
    expect((await price('Tesco', 90, 250, 'g', daysAgo(200))).status()).toBe(200); // old: shown but never ranked

    const seeded = await context.request.post('/api/dev/seed', { data: { kind: 'shopping-item', name: rice.name, value: 1000, unit: 'g' } });
    expect(seeded.ok()).toBeTruthy();
    await context.request.post('/api/dev/seed', { data: { kind: 'shopping-item', name: 'saffron threads xyz', value: 1, unit: 'item' } });

    await page.goto('/shopping');
    const badge = page.getByTestId('cheapest-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Cheapest at LIDL');
    await expect(badge).toContainText('£2.30 per kg');
    await expect(badge).toContainText('5 days ago');

    await page.getByTestId('compare-panel').locator('summary').click();
    const rows = page.getByTestId('compare-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'LIDL' })).toContainText('1 of 2 items');
    await expect(rows.filter({ hasText: 'LIDL' })).toContainText('£2.30');
    await expect(rows.filter({ hasText: 'ALDI' })).toContainText('£3.00');
    await expect(page.getByTestId('compare-like')).toContainText('Cheapest here: LIDL');

    // the badge opens the history
    await badge.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('prices by shop');
    await expect(page.getByTestId('price-badge')).toContainText('Cheapest at LIDL');
    const shops = page.getByTestId('shop-prices');
    await expect(shops.getByRole('row').filter({ hasText: 'Tesco' })).toContainText('not used for the comparison');
    await expect(page.getByTestId('price-history').getByRole('listitem')).toHaveCount(3);

    // a price you saw changes the answer
    await page.getByLabel('Shop name').fill('Corner shop');
    await page.getByLabel('Price (£)').fill('0.80');
    await page.getByLabel('Pack size').fill('500');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByTestId('price-badge')).toContainText('Cheapest at Corner shop');
    await expect(page.getByTestId('price-history').getByRole('listitem')).toHaveCount(4);
  });

  test('refuses a bad price and says when there is nothing to compare', async ({ page, context }) => {
    const found = await context.request.get('/api/catalogue/search?q=basmati');
    const rice = ((await found.json()) as { candidates: { id: string }[] }).candidates[0]!;
    const bad = await context.request.post('/api/money/prices', { data: { action: 'add', ingredientId: rice.id, retailer: 'ALDI', pricePence: 0, packValue: 1, packUnit: 'kg' } });
    expect(bad.status()).toBe(422);
    await page.goto(`/spending/prices/${rice.id}`);
    await expect(page.getByTestId('price-note')).toContainText('No shop prices yet');
    await page.goto('/shopping');
    await expect(page.getByTestId('cheapest-badge')).toHaveCount(0);
  });
});
