// Photo capture must be a primary, obvious entry point: Recipes + Pantry headers, mobile FABs, Home tiles.
import { expect, test } from '@playwright/test';

test('Recipes header: primary "Add from photo" beside secondary New recipe / Discover', async ({ page }) => {
  await page.goto('/recipes');
  const photo = page.getByTestId('add-from-photo');
  await expect(photo).toHaveAttribute('href', '/recipes/import');
  await expect(photo).toHaveClass(/fr-btn--primary/);
  await expect(page.getByRole('link', { name: 'New recipe' })).toHaveClass(/fr-btn--secondary/);
  await expect(page.getByTestId('add-from-photo-fab')).toBeHidden();
});

test('Pantry header: primary scan button', async ({ page }) => {
  await page.goto('/pantry');
  const scan = page.getByTestId('scan-groceries');
  await expect(scan).toHaveClass(/fr-btn--primary/);
  await expect(scan).toContainText('photo, video or barcode');
  await expect(scan).toHaveAttribute('href', '/pantry/scan');
});

test('Home shows two prominent capture tiles', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tile-recipe-photo')).toHaveAttribute('href', '/recipes/import');
  await expect(page.getByTestId('tile-scan-groceries')).toHaveAttribute('href', '/pantry/scan');
  await expect(page.getByRole('link', { name: 'Add a recipe from a photo' })).toBeVisible();
});

test.describe('mobile 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('floating actions are visible, 44px, and clear of the bottom nav', async ({ page }) => {
    for (const [path, id, href] of [
      ['/recipes', 'add-from-photo-fab', '/recipes/import'],
      ['/pantry', 'scan-groceries-fab', '/pantry/scan'],
    ] as const) {
      await page.goto(path);
      const fab = page.getByTestId(id);
      await expect(fab).toBeVisible();
      await expect(fab).toHaveAttribute('href', href);
      const box = (await fab.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      const nav = (await page.locator('.fr-bottomnav').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    // Bottom nav still has only the original items.
    expect(await page.locator('.fr-bottomnav li').count()).toBe(7);
  });

  test('Home tiles fit at 375', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tile-scan-groceries')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
