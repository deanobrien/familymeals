import { expect, test } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers';

// D129: allergy exclusions withheld because the recorder's consent is missing/withdrawn show a notice (a count only,
// no health detail) on the planner, discover and settings pages. Mock mode fakes the withheld count through the
// dev-only seed endpoint in an isolated sandbox household.

const PAGES = [
  { path: '/plan', heading: 'Meal planner' },
  { path: '/recipes/discover', heading: 'Discover recipes' },
  { path: '/settings', heading: 'Settings' },
] as const;

test.describe('consent notice for withheld allergy exclusions', () => {
  test('no notice when nothing is withheld', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('consent-none'));
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(page.getByTestId('consent-notice')).toHaveCount(0);
    }
  });

  test('notice with the count and a link to Settings on planner, discover and settings', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('consent-some'));
    const seeded = await context.request.post('/api/dev/seed', { data: { kind: 'withheld-exclusions', count: 2 } });
    expect(seeded.ok()).toBe(true);
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      const notice = page.getByTestId('consent-notice');
      await expect(notice).toContainText("2 allergy exclusions aren't being applied because consent hasn't been given");
      await expect(notice.getByRole('link', { name: 'review in Settings' })).toHaveAttribute('href', '/settings#h-diet');
    }
    // The link lands on the allergies section that holds the consent checkbox.
    await page.goto('/plan');
    await page.getByTestId('consent-notice').getByRole('link', { name: 'review in Settings' }).click();
    await expect(page).toHaveURL(/\/settings#h-diet$/);
    await expect(page.getByRole('heading', { name: 'Allergies and foods to avoid' })).toBeVisible();
  });

  test('singular wording for one withheld exclusion', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('consent-one'));
    await context.request.post('/api/dev/seed', { data: { kind: 'withheld-exclusions', count: 1 } });
    await page.goto('/plan');
    await expect(page.getByTestId('consent-notice')).toContainText("1 allergy exclusion isn't being applied");
  });
});
