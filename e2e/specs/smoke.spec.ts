import { expect, test } from '@playwright/test';

const ROUTES = [
  { path: '/recipes', nav: 'Recipes', heading: 'Recipes' },
  { path: '/plan', nav: 'Meal planner', heading: 'Meal planner' },
  { path: '/shopping', nav: 'Shopping list', heading: 'Shopping list' },
  { path: '/household', nav: 'Household', heading: 'Household' },
] as const;

test('home page renders the app shell with main navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main', exact: true });
  for (const label of ['Home', ...ROUTES.map((r) => r.nav), 'Settings']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
});

for (const r of ROUTES) {
  test(`${r.path} placeholder page renders with empty state`, async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('link', { name: r.nav })
      .click();
    await expect(page).toHaveURL(new RegExp(`${r.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: r.heading })).toBeVisible();
    // /recipes is a real library now (L12); only the remaining placeholders show an empty state.
    if (r.path !== '/recipes') await expect(page.locator('.fr-state')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: r.nav }),
    ).toHaveAttribute('aria-current', 'page');
  });
}

test('mobile viewport shows the bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const bottom = page.getByRole('navigation', { name: 'Main (mobile)' });
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole('link', { name: 'Recipes' })).toBeVisible();
});
