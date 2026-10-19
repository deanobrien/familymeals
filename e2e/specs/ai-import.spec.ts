// Photo import polish + Settings > AI provider (mock provider; no key is ever saved by these tests).
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import sharp from 'sharp';
import { FIXTURES_DIR } from '../support/helpers.js';

const img = (f: string) => join(FIXTURES_DIR, 'recipes', f);

test.describe('Settings > AI provider', () => {
  test('shows the fields for each provider, a write-only key input, and tests the connection', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('heading', { level: 2, name: 'AI provider' });
    await expect(section).toBeVisible();
    await expect(page.getByTestId('ai-active')).toContainText('Currently using');

    const provider = page.getByLabel('Provider', { exact: true });
    await provider.selectOption('openai');
    await expect(page.getByLabel('Endpoint (base URL)')).toHaveValue('https://api.openai.com/v1');
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-4.1');
    const key = page.getByLabel('API key', { exact: true });
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');

    await provider.selectOption('azure');
    await expect(page.getByLabel('Azure endpoint')).toBeVisible();
    await expect(page.getByLabel('Deployment name')).toBeVisible();
    await expect(page.getByLabel('API version')).toHaveValue('2024-10-21');

    await provider.selectOption('anthropic');
    await expect(page.getByLabel('Model', { exact: true })).toBeVisible();

    // A real provider cannot be saved without a key (nothing is stored by this test).
    await provider.selectOption('openai');
    await page.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /API key/i })).toBeVisible();

    await provider.selectOption('mock');
    await expect(page.getByText(/fixed sample recipe/i)).toBeVisible();
  });

  test('test connection reports success for the sample-data provider', async ({ page }) => {
    await page.goto('/settings');
    const active = await page.getByTestId('ai-active').innerText();
    test.skip(!/Sample data/i.test(active), 'a real provider is configured on this server; do not make a live call from e2e');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByTestId('ai-notice')).toContainText('Connection works');
  });
});

test.describe('photo import polish', () => {
  test('names the provider, rotates a sideways photo before upload, and shows progress', async ({ page }) => {
    await page.goto('/recipes/import');
    await expect(page.getByTestId('import-provider')).toContainText('Reading with');
    await expect(page.getByTestId('mock-banner')).toBeVisible();

    const sideways = await sharp({ create: { width: 640, height: 300, channels: 3, background: '#cc8844' } }).jpeg().toBuffer();
    await page.getByTestId('photo-input').setInputFiles({ name: 'sideways.jpg', mimeType: 'image/jpeg', buffer: sideways });
    const preview = page.getByRole('img', { name: 'Preview of page 1' });
    const dims = () => preview.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
    await expect.poll(dims).toEqual([640, 300]);

    await page.getByRole('button', { name: 'Rotate page 1 clockwise' }).click();
    await expect.poll(dims).toEqual([300, 640]);
    // rotated file is what gets uploaded
    await expect(page.getByTestId('page-item').first()).toContainText('sideways.jpg');
  });

  test('a meal-kit card shows printed nutrition, allergens, staples and the base quantities, then opens with a cover image', async ({ page }) => {
    await page.goto('/recipes/import');
    await page.getByTestId('photo-input').setInputFiles([img('03-beef-stew-two-page-p1.png'), img('03-beef-stew-two-page-p2.png')]);
    // the mock returns its two-sided meal-kit card when the hint mentions a meal kit
    await page.getByLabel('Recipe name (optional)').fill('Meal kit wraps e2e');
    await page.getByRole('button', { name: 'Extract recipe' }).click();

    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    await expect(page.getByTestId('review-provider')).toContainText('Read by');
    await expect(page.getByTestId('review-source')).toContainText('Example Meal Kit Co');
    const nutrition = page.getByTestId('printed-nutrition');
    await expect(nutrition).toContainText('per person');
    await expect(nutrition).toContainText('from recipe card');
    await expect(nutrition).toContainText('Calories');
    await expect(nutrition).toContainText('640 kcal');
    await expect(page.getByTestId('printed-allergens')).toContainText('A1: gluten');
    await expect(page.getByTestId('pantry-staple-badge')).toHaveCount(2);
    // base quantity kept, bracketed alternative explained, nothing blocking
    await expect(page.getByLabel('Ingredient 3 amount')).toHaveValue('200');
    await expect(page.getByText(/\[400ml\]/).first()).toBeVisible();
    await expect(page.getByTestId('extraction-warnings')).toContainText('brackets');
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeEnabled();
    // cover picker previews a stored page photo
    const cover = page.getByRole('img', { name: /Cover photo preview/ });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

    await page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    // detail: cover image served from the local upload store, printed data labelled as source-provided
    const hero = page.locator('img[src^="/api/uploads/"]').first();
    await expect(hero).toBeVisible();
    await expect.poll(() => hero.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const src = await hero.getAttribute('src');
    const res = await page.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/jpeg');
    await expect(page.getByTestId('printed-nutrition')).toContainText('not calculated by this app');
    await expect(page.getByTestId('printed-allergens')).toContainText('A7: milk');

    // library card shows the cover too
    await page.goto('/recipes?q=wraps+e2e');
    await expect(page.locator('img[src^="/api/uploads/"]').first()).toBeVisible();
  });

  test('the upload route refuses anything but its own files', async ({ request }) => {
    for (const path of ['/api/uploads/not-an-id/cover.jpg', '/api/uploads/11111111-2222-3333-4444-555555555555/cover.jpg', '/api/uploads/11111111-2222-3333-4444-555555555555/..%2Fapp-secret']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});
