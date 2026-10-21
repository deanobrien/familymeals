// P3-A (D420-D429): the shared family cookbook between two households (link, read-only preview, save a copy, counts, switch off) and
// kids' mode (PIN, profile, a vote the kids answer with no typing, PIN-only exit, results). In-memory mode, mock auth, sandbox households.
import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId, secondSession } from '../support/helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const title = `E2E Shared Chilli ${Date.now().toString(36)}`;

async function createRecipe(page: Page) {
  await page.goto('/recipes/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByLabel('Servings', { exact: true }).fill('4');
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('butter');
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).blur();
  await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('100');
  await page.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('g');
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Melt the butter.');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
}

test.describe('shared cookbook', () => {
  const hhA = newHouseholdId('p3a-a');
  const hhB = newHouseholdId('p3a-b');
  let link = '';

  test('household A makes a link for one recipe', async ({ context, page }) => {
    await enterHousehold(context, hhA);
    await createRecipe(page);
    await page.getByTestId('share-panel').locator('summary').click();
    await page.getByTestId('create-share').click();
    const box = page.getByTestId('new-share-link');
    await expect(box).toContainText('only time the link is shown');
    link = await page.getByTestId('share-link-input').inputValue();
    expect(link).toMatch(/\/s\/[0-9a-f]{64}$/);
    await box.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('new-share-link')).toHaveCount(0);
    await expect(page.getByTestId('share-list')).toContainText('expires');
  });

  test('household B reads it read-only, attributed, and saves a copy', async ({ browser }) => {
    const { context, page } = await secondSession(browser, hhB);
    try {
      await page.goto(new URL(link).pathname);
      await expect(page.getByTestId('share-title')).toHaveText(title);
      await expect(page.getByTestId('share-attribution')).toContainText("Shared by Alice Smith's household");
      await expect(page.getByText('Melt the butter.')).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0); // a bare page: no app navigation around a share
      await page.getByRole('button', { name: 'Save a copy to my household' }).click();
      await expect(page.getByTestId('share-saved')).toContainText('Saved to your household');
      await page.getByRole('link', { name: 'Open your copy' }).click();
      await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText(/Shared by Alice Smith's household/)).toBeVisible();
      // it is B's own recipe now: not a favourite, no rating, no cooking history
      await expect(page.getByRole('button', { name: 'Favourite', exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('a made-up link says only "not available"', async ({ browser }) => {
    const { context, page } = await secondSession(browser, hhB);
    try {
      await page.goto(`/s/${'0'.repeat(64)}`);
      await expect(page.getByTestId('share-unavailable')).toContainText('not available');
      await page.goto('/s/not-a-token');
      await expect(page.getByTestId('share-unavailable')).toContainText('not available');
    } finally {
      await context.close();
    }
  });

  test('A sees counts only, switches the link off, and then it stops working for B', async ({ context, page, browser }) => {
    await enterHousehold(context, hhA);
    await page.goto('/recipes/shared');
    const list = page.getByTestId('share-list');
    await expect(list).toContainText('Opened by 1 person');
    await expect(list).toContainText('1 saved');
    await list.getByRole('button', { name: /Switch off the link for/ }).click();
    await list.getByRole('button', { name: 'Yes, switch off' }).click();
    await expect(list).toContainText('Switched off');

    const { context: ctxB, page: pageB } = await secondSession(browser, hhB);
    try {
      await pageB.goto(new URL(link).pathname);
      await expect(pageB.getByTestId('share-unavailable')).toBeVisible();
    } finally {
      await ctxB.close();
    }
  });

  test('a collection can be shared from the Shared page', async ({ context, page }) => {
    await enterHousehold(context, hhA);
    await page.goto('/recipes/shared');
    await page.getByLabel('Collection', { exact: true }).selectOption('favourites');
    await page.getByTestId('create-share').click();
    await expect(page.getByTestId('new-share-link')).toBeVisible();
    expect(await page.getByTestId('share-link-input').inputValue()).toMatch(/\/s\/[0-9a-f]{64}$/);
  });
});

test.describe("kids' mode", () => {
  const hh = newHouseholdId('p3a-kids');
  test.beforeEach(async ({ context }) => enterHousehold(context, hh));

  test('PIN, profile and a vote the kids answer with no typing; only the PIN leaves; results land on the parent page', async ({ page }) => {
    await page.goto('/plan');
    await page.getByTestId('kids-link').click();
    await expect(page.getByRole('heading', { level: 1, name: /Kids' mode/ })).toBeVisible();

    await page.getByTestId('pin-input').fill('2468');
    await page.getByTestId('save-pin').click();
    await expect(page.getByTestId('pin-status')).toContainText('PIN saved on this device');

    await page.getByTestId('kid-name').fill('Mia');
    await page.getByTestId('add-kid').click();
    await expect(page.getByTestId('kid-list')).toContainText('Mia');

    const recipes = page.getByTestId('round-recipes').getByRole('checkbox');
    await recipes.nth(0).check();
    await recipes.nth(1).check();
    await expect(page.getByTestId('open-round')).toBeDisabled(); // 3 to 6 meals
    await recipes.nth(2).check();
    await page.getByTestId('open-round').click();
    await expect(page.getByTestId('round-list')).toContainText('Open');

    await page.getByRole('link', { name: 'Let the kids vote' }).click();
    await expect(page).toHaveURL(/\/kids\/play\?round=/);
    await expect(page.getByTestId('kid-screen')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.locator('input, textarea')).toHaveCount(0); // nothing to type into

    await page.getByRole('button', { name: 'Mia' }).click();
    const cards = page.locator('[data-testid^="kid-card-"]');
    await expect(cards).toHaveCount(3);
    await cards.nth(0).getByRole('button', { name: /^Thumbs up for/ }).click();
    await cards.nth(1).getByRole('button', { name: /^Heart for/ }).click();
    await expect(cards.nth(0).getByRole('button', { name: /^Thumbs up for/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('input, textarea')).toHaveCount(0);
    await page.getByTestId('kid-done').click();
    await expect(page.getByText(/Thank you/)).toBeVisible();

    // the way out is the PIN
    await page.getByTestId('kid-exit').click();
    for (const d of '1111') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('pin-message')).toContainText('not the PIN');
    await expect(page).toHaveURL(/\/kids\/play/);
    for (const d of '2468') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page).toHaveURL(/\/kids$/);

    // results: Mia's thumbs up and heart are counted; closing finishes the vote with a winner
    const round = page.getByTestId('round-list').locator('li[data-testid^="round-"]').first();
    await expect(round).toContainText('👍 1');
    await expect(round).toContainText('❤️ 1');
    await round.getByRole('button', { name: 'Close the vote' }).click();
    await expect(round).toContainText('Finished');
    await expect(round).toContainText('🏆');
  });
});
