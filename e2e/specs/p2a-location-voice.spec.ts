import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// P2-A (D390-D399): store locations, "Detect my store" and voice add on the web. Mock mode: each test has its own sandbox
// household. Geolocation is mocked by the browser context; speech is mocked by an init script (no microphone, no network).

let seq = 0;
const newHousehold = () => `e2e-p2a-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
const SHOP = { latitude: 54.9783, longitude: -1.6178, accuracy: 15 };

async function openPage(context: BrowserContext, household: string, path: string): Promise<Page> {
  await context.addCookies([{ name: 'fr_household', value: household, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function addStoreWithLocation(page: Page, name: string) {
  await page.goto('/settings/stores');
  await page.getByLabel('Store name').fill(name);
  await page.getByRole('button', { name: 'Add store' }).click();
  const card = page.getByTestId(`store-${name}`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Use my current location' }).click();
  await expect(card.getByText(/Saved from your position in the shop/)).toBeVisible({ timeout: 60_000 });
}

test.describe('store locations and detection', () => {
  test.use({ permissions: ['geolocation'], geolocation: SHOP });

  test('save a store location from the current position, detect it on the shopping page, then remove it', async ({ context }) => {
    const h = newHousehold();
    const page = await openPage(context, h, '/settings/stores');
    await addStoreWithLocation(page, 'Tesco Extra');
    await addStoreWithLocation(page, 'ALDI Far');
    // make ALDI far away: save it again from a position 5 km off
    await context.setGeolocation({ latitude: 55.02, longitude: -1.55, accuracy: 15 });
    const aldi = page.getByTestId('store-ALDI Far');
    const saved = page.waitForResponse((r) => r.url().includes('/api/stores/locations') && r.request().method() === 'POST');
    await aldi.getByRole('button', { name: 'Use my current location' }).click();
    await saved;
    await expect(aldi.getByText(/Saved from your position/)).toBeVisible();

    // back in the Tesco car park
    await context.setGeolocation(SHOP);
    await page.goto('/shopping');
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-store', '');
    await page.getByTestId('detect-store').click();
    await expect(page.getByTestId('detect-message')).toContainText('Tesco Extra', { timeout: 30_000 });
    await expect(page.getByLabel('Shopping at')).toHaveValue(/.+/);
    await expect(page.getByLabel('Shopping at').locator('option:checked')).toHaveText('Tesco Extra');

    // away from every store: nothing is selected for you, and it says so
    await context.setGeolocation({ latitude: 51.5, longitude: -0.12, accuracy: 15 });
    await page.getByLabel('Shopping at').selectOption({ label: 'No store: group by category' });
    await page.getByTestId('detect-store').click();
    await expect(page.getByTestId('detect-message')).toContainText('No saved store is near you');
    await expect(page.getByLabel('Shopping at').locator('option:checked')).toHaveText('No store: group by category');

    // remove a location
    await page.goto('/settings/stores');
    const card = page.getByTestId('store-Tesco Extra');
    await card.getByRole('button', { name: 'Remove location' }).click();
    await expect(card.getByText(/No location yet/)).toBeVisible();
  });

  test('a position that is too imprecise is refused, with a way out', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/settings/stores');
    await context.setGeolocation({ ...SHOP, accuracy: 900 });
    await page.getByLabel('Store name').fill('Lidl');
    await page.getByRole('button', { name: 'Add store' }).click();
    const card = page.getByTestId('store-Lidl');
    await card.getByRole('button', { name: 'Use my current location' }).click();
    await expect(card.getByTestId('location-error')).toContainText('too rough', { timeout: 30_000 });
    await expect(card.getByText(/No location yet/)).toBeVisible();
  });

  test('a postcode that is not shaped like one is refused without a lookup', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/settings/stores');
    await page.getByLabel('Store name').fill('Co-op');
    await page.getByRole('button', { name: 'Add store' }).click();
    const card = page.getByTestId('store-Co-op');
    await card.getByLabel('Or a postcode').fill('hello');
    await card.getByRole('button', { name: 'Look up postcode' }).click();
    await expect(card.getByTestId('location-error')).toContainText('UK postcode', { timeout: 30_000 });
  });

  test('denied location permission explains what to do', async ({ browser }) => {
    const context = await browser.newContext({ permissions: [] });
    const page = await openPage(context, newHousehold(), '/settings/stores');
    await page.getByLabel('Store name').fill('Spar');
    await page.getByRole('button', { name: 'Add store' }).click();
    const card = page.getByTestId('store-Spar');
    await card.getByRole('button', { name: 'Use my current location' }).click();
    await expect(card.getByTestId('location-error')).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});

const FAKE_SPEECH = `
  window.SpeechRecognition = class {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; }
    start() { setTimeout(() => { this.onresult && this.onresult({ results: [[{ transcript: 'add milk, two tins of tomatoes and eggs' }]] }); this.onend && this.onend(); }, 30); }
    stop() { this.onend && this.onend(); }
    abort() {}
  };`;

test.describe('voice add', () => {
  test('speak, review chips, add (twice-safe), items land on the list', async ({ context }) => {
    await context.addInitScript(FAKE_SPEECH);
    const page = await openPage(context, newHousehold(), '/shopping');
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await page.getByTestId('voice-add-button').click();
    await page.getByTestId('voice-mic').click();
    await expect(page.getByTestId('voice-text')).toHaveValue(/milk, two tins of tomatoes and eggs/);
    await page.getByTestId('voice-read').click();
    await expect(page.getByTestId('voice-chips').getByRole('button')).toHaveCount(3, { timeout: 60_000 });
    // leave the eggs out
    await page.getByTestId('voice-chip-v3').click();
    await page.getByTestId('voice-add').click();
    await expect(page.getByRole('checkbox', { name: /^Milk/i })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('checkbox', { name: /Tomato/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Egg/i })).toHaveCount(0);
  });

  test('without speech support the typed box still works', async ({ context }) => {
    await context.addInitScript('window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;');
    const page = await openPage(context, newHousehold(), '/shopping');
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await page.getByTestId('voice-add-button').click();
    await expect(page.getByTestId('voice-unsupported')).toBeVisible();
    await page.getByTestId('voice-text').fill('bananas and 2 pints of milk');
    await page.getByTestId('voice-read').click();
    await expect(page.getByTestId('voice-chips').getByRole('button')).toHaveCount(2, { timeout: 60_000 });
    await page.getByTestId('voice-add').click();
    await expect(page.getByRole('checkbox', { name: /Banana/i })).toBeVisible({ timeout: 60_000 });
  });

  test('microphone denied shows a typed fallback message', async ({ context }) => {
    await context.addInitScript(`
      window.SpeechRecognition = class { start() { setTimeout(() => { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); }, 20); } stop() {} abort() {} };`);
    const page = await openPage(context, newHousehold(), '/shopping');
    await page.getByTestId('voice-add-button').click();
    await page.getByTestId('voice-mic').click();
    await expect(page.getByTestId('voice-error')).toContainText('microphone is blocked');
    await page.getByTestId('voice-text').fill('rice');
    await expect(page.getByTestId('voice-read')).toBeEnabled();
  });
});
