import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers';

// P0-D (D350-D352): Settings preferences and allergies/consent actually persist (mock mode: in-memory store, per sandbox
// household), and withdrawing consent stops the exclusions applying and shows the consent notice.

const save = (page: Page, name: string) => page.getByRole('button', { name }).click();

test.describe('settings persistence', () => {
  test('preferences persist across a reload and show on the API the Android app calls', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('settings-prefs'));
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await page.getByLabel('Default servings').fill('6');
    await page.getByLabel('Weekly food budget (£)').fill('70');
    await page.getByLabel('Show units as').selectOption('imperial');
    await page.getByLabel('Locale').selectOption('en-IE');
    await save(page, 'Save preferences');
    await expect(page.getByText('Preferences saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Default servings')).toHaveValue('6');
    await expect(page.getByLabel('Weekly food budget (£)')).toHaveValue('70');
    await expect(page.getByLabel('Show units as')).toHaveValue('imperial');
    await expect(page.getByLabel('Locale')).toHaveValue('en-IE');

    // The same module answers the JSON route (cookie session here, Bearer on Android).
    const api = await context.request.get('/api/settings');
    expect(api.status()).toBe(200);
    expect((await api.json()).settings).toMatchObject({ defaultServings: 6, weeklyBudgetPence: 7000 });
  });

  test('allergies need consent, persist, and withdrawing consent stops them applying (notice shown)', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('settings-diet'));
    await page.goto('/settings');
    await expect(page.getByTestId('consent-notice')).toHaveCount(0);

    await page.getByLabel('peanuts', { exact: true }).check();
    await page.getByLabel('sesame', { exact: true }).check();
    await save(page, 'Save dietary information');
    await expect(page.getByText(/tick the box to agree/)).toBeVisible();
    await page.getByLabel('I agree to this use of my dietary information.').check();
    await save(page, 'Save dietary information');
    await expect(page.getByText('Dietary information saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('peanuts', { exact: true })).toBeChecked();
    await expect(page.getByLabel('sesame', { exact: true })).toBeChecked();
    await expect(page.getByLabel('I agree to this use of my dietary information.')).toBeChecked();
    await expect(page.getByTestId('consent-notice')).toHaveCount(0);

    // Withdraw consent: the list stays on file but is not applied, and the notice (a count only) says so everywhere.
    await save(page, 'Withdraw consent');
    await expect(page.getByText(/Consent withdrawn/)).toBeVisible();
    await expect(page.getByTestId('consent-notice')).toContainText("2 allergy exclusions aren't being applied because consent hasn't been given");
    await page.goto('/plan');
    await expect(page.getByTestId('consent-notice')).toContainText("2 allergy exclusions aren't being applied");
    await page.goto('/settings');
    await expect(page.getByLabel('peanuts', { exact: true })).toBeChecked();
    await expect(page.getByLabel('I agree to this use of my dietary information.')).not.toBeChecked();

    // Remove everything: list and notice are gone.
    await save(page, 'Remove all dietary information');
    await page.getByRole('dialog').getByRole('button', { name: 'Remove everything' }).click();
    await expect(page.getByText('All dietary information removed')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('peanuts', { exact: true })).not.toBeChecked();
    await expect(page.getByTestId('consent-notice')).toHaveCount(0);
  });
});
