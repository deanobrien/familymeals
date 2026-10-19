// BRIEF section 15 end-to-end journey, run in mock-auth / in-memory mode:
//  - "sign-in" is the dev mock identity (Alice) and the household is an isolated `fr_household=e2e-*` sandbox, so
//    the whole journey is deterministic and independent of the other specs.
//  - AI is the mock provider: photo import always returns the fixed "Nana's Lentil Soup" extraction (the recipe name
//    hint becomes the title) and the receipt scan always returns RED LENTILS 500G / BRITISH ONIONS 1KG / 2 x MILK.
//  - A second browser context in the same household stands in for the second household member; it sees updates by
//    polling (there is no Supabase Realtime in mock mode).
// Steps that need a real auth server (sign-up, invitations, a two-member list) run in e2e/live/ (pnpm test:e2e:live, D143).
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import sharp from 'sharp';
import { FIXTURES_DIR, SEED, enterHousehold, newHouseholdId, secondSession, seedApprovedPlan } from '../support/helpers.js';
import { MealPlanPage, ReceiptPage, RecipeImportPage, RecipeLibraryPage, RecipeReviewPage, ShoppingListPage } from '../support/pages.js';

const recipeImg = (f: string) => join(FIXTURES_DIR, 'recipes', f);
const receiptImg = (f: string) => join(FIXTURES_DIR, 'receipts', f);

const SOUP = 'Journey Lentil Soup';
const WEEK = '2026-12-07';
const [MON, TUE, WED] = ['2026-12-07', '2026-12-08', '2026-12-09'];

test.describe.serial('Main journey (BRIEF s15)', () => {
  const household = newHouseholdId('journey');

  test.beforeEach(async ({ context }) => {
    await enterHousehold(context, household);
  });

  test('1. sign in (mock-auth identity) lands in the app shell with the demo banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('mock-auth-banner')).toContainText('Alice Smith');
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
  });

  test('2. the household is selected and household management is shown as unavailable in mock mode', async ({ page }) => {
    await page.goto('/household');
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible();
    await expect(page.getByText('Local mock auth')).toBeVisible();
    // the sandbox household starts with an empty shopping list and no plan
    await page.goto('/shopping');
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
  });

  test('3. add a recipe from a test image (deterministic mock extraction)', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await expect(page.getByTestId('mock-banner')).toBeVisible();
    await imp.fileInput().setInputFiles(recipeImg('01-tomato-pasta.png'));
    await imp.hint().fill(SOUP);
    await imp.extract().click();
    const review = new RecipeReviewPage(page);
    await expect(review.heading()).toBeVisible();
    await expect(review.title()).toHaveValue(SOUP);
    await expect(review.servings()).toHaveValue('4');
    await expect(review.ingredientRows()).toHaveCount(6);
    // nothing is saved until the user saves it
    await page.goto('/recipes?q=journey+lentil');
    await expect(new RecipeLibraryPage(page).card(SOUP)).toHaveCount(0);
  });

  test('4. correct and save the recipe (edit servings, fix a line, save) and see it in the library', async ({ page }) => {
    // Saves as the sandbox household (D161): the library the plan step below reads from is this household's own (D160).
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles(recipeImg('01-tomato-pasta.png'));
    await imp.hint().fill(SOUP);
    await imp.extract().click();
    const review = new RecipeReviewPage(page);
    await expect(review.heading()).toBeVisible();
    await review.servings().fill('6');
    await page.getByLabel('Ingredient 1 name', { exact: true }).fill('red lentils');
    await page.getByLabel('Ingredient 1 amount').fill('300');
    await expect(review.save()).toBeEnabled();
    await review.save().click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: SOUP })).toBeVisible();
    await expect(page.getByTestId('ingredient-qty').first()).toHaveText('300 g');

    await page.goto('/recipes?q=journey+lentil');
    await expect(new RecipeLibraryPage(page).card(SOUP)).toBeVisible();
  });

  test('5. add several recipes to a weekly plan, save and approve it', async ({ page }) => {
    const plan = new MealPlanPage(page);
    await page.goto(`/plan?week=${WEEK}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Meal planner' })).toBeVisible();
    for (const [day, title] of [[MON, SOUP], [TUE, 'Sunday Tomato Pasta'], [WED, 'Smoky Chickpea Stew']] as const) {
      await plan.addToSlot(day, 'dinner').click();
      await plan.pick(title);
      await expect(plan.slot(day, 'dinner')).toContainText(title);
    }
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByTestId('plan-message')).toContainText('Plan saved');
    await plan.approve().click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('week-cost')).toContainText('estimate');
  });

  test('6. generate a combined shopping list (same ingredient merged, provenance kept)', async ({ page }) => {
    const plan = new MealPlanPage(page);
    await page.goto(`/plan?week=${WEEK}`);
    await plan.generateList().click();
    await page.getByRole('link', { name: 'Open shopping list' }).click();
    const list = new ShoppingListPage(page);
    await list.root().waitFor();
    await expect(page).toHaveURL(/\/shopping$/);
    await expect(list.tick('Onion')).toHaveCount(1); // onion is needed by several recipes but listed once
    await page.getByRole('button', { name: 'From plan: where Onion comes from' }).click();
    const pop = page.getByRole('dialog', { name: /where Onion comes from/ });
    await expect(pop).toContainText(SOUP);
    await expect(pop).toContainText('Sunday Tomato Pasta');
    await page.keyboard.press('Escape');
    await expect(list.tick('Red lentils')).toHaveCount(1);
  });

  test('7. quantities are shown and costs are labelled as estimates', async ({ page }) => {
    const list = new ShoppingListPage(page);
    await list.gotoHydrated();
    // 300 g for 6 servings, planned at the default 4 servings, scales to 200 g
    await expect(list.item('Red lentils')).toContainText('200 g');
    await expect(list.basketTotal()).toContainText('£');
    await expect(list.basketTotal()).toContainText('estimate');
    await expect(list.progress()).toContainText(/^0 of \d+ items done/);
  });

  test('8. tick off a purchase (creates a purchase event)', async ({ page }) => {
    const list = new ShoppingListPage(page);
    await list.gotoHydrated();
    await list.tick('Pasta').click();
    await expect(list.tick('Pasta')).toHaveCount(0);
    await expect(list.purchase('Pasta')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: 'Bought Pasta.' })).toBeVisible();
    await expect(list.progress()).toContainText(/^1 of \d+ items done/);
    await expect(list.syncIndicator()).toHaveText('All changes saved'); // server-confirmed (data-status stays 'synced' while a tick is still queued) before the next step
  });

  test('9. a second session in the household sees the update without reloading (polling sync)', async ({ browser, page }) => {
    const second = await secondSession(browser, household);
    try {
      const theirs = new ShoppingListPage(second.page);
      await theirs.gotoHydrated();
      await expect(theirs.purchase('Pasta')).toHaveCount(1); // the step-8 purchase is already on the server
      const mine = new ShoppingListPage(page);
      await mine.gotoHydrated();
      await expect(theirs.tick('Garlic')).toBeVisible();
      await mine.tick('Garlic').click();
      await expect(mine.purchase('Garlic')).toHaveCount(1);
      // no reload on their side: the poll picks it up
      await expect(theirs.tick('Garlic')).toHaveCount(0, { timeout: 15_000 });
      await expect(theirs.purchase('Garlic')).toHaveCount(1);
      await expect(theirs.syncIndicator()).toHaveAttribute('data-status', 'synced');
    } finally {
      await second.context.close();
    }
  });

  test('9b. an offline tick replays idempotently on reconnect (exactly one purchase)', async ({ browser }) => {
    const second = await secondSession(browser, household);
    try {
      const theirs = new ShoppingListPage(second.page);
      await theirs.gotoHydrated();
      await expect(theirs.tick('Red pepper')).toBeVisible();
      await second.context.setOffline(true);
      await theirs.tick('Red pepper').click();
      await expect(theirs.syncIndicator()).toHaveAttribute('data-status', 'offline');
      await second.page.getByLabel('Show completed items').check();
      await expect(second.page.getByTestId('pending-badge')).toBeVisible();
      await second.context.setOffline(false);
      await expect(second.page.getByTestId('pending-badge')).toHaveCount(0, { timeout: 15_000 });
      await expect(theirs.syncIndicator()).toHaveAttribute('data-status', 'synced');
      // exactly one PurchaseEvent, also after a fresh load (it is on the server)
      await second.page.reload();
      await expect(theirs.purchase('Red pepper')).toHaveCount(1);
    } finally {
      await second.context.close();
    }
  });

  test('10. reconcile a receipt: suggestions are never auto-confirmed, unmatched lines stay unmatched', async ({ page }) => {
    const rc = new ReceiptPage(page);
    await rc.goto();
    await rc.fileInput().setInputFiles(receiptImg('r1-weekly-shop.png'));
    await rc.scan().click();
    await expect(page).toHaveURL(/\/receipts\/[^/]+\/review$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
    await expect(page.getByTestId('receipt-line')).toHaveCount(3);
    await expect(page.getByTestId('total-ok')).toBeVisible();

    // the lentils line is suggested from the list but needs an explicit confirm
    await expect(rc.matchSelect('RED LENTILS 500G').locator('option:checked')).toContainText('red lentil');
    await expect(rc.confirmBox('RED LENTILS 500G')).not.toBeChecked();
    await expect(page.getByTestId('confirm-summary')).toContainText('0 purchases');
    await expect(page.getByRole('button', { name: 'Save receipt' })).toBeDisabled();
    // milk is not on the planned list, so it has no list match to offer
    await expect(rc.line('MILK')).not.toContainText('bought:');

    await page.getByLabel(/Quantity bought/).first().fill('500');
    await rc.confirmBox('RED LENTILS 500G').check();
    await page.getByRole('button', { name: 'Confirm 1 purchase' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 purchase(s) recorded' })).toBeVisible();
    await expect(rc.line('RED LENTILS 500G')).toContainText('bought: red lentil');
    await expect(rc.line('MILK')).toContainText('not matched');
  });

  test('11. purchase history carries the receipt price and the remaining requirements are correct', async ({ page }) => {
    const list = new ShoppingListPage(page);
    await list.gotoHydrated();
    // receipt purchase: actual price (189p), kept as an append-only purchase row
    await expect(list.purchase('Red lentils')).toContainText('£1.89');
    await expect(list.tick('Red lentils')).toHaveCount(0);
    // earlier ticks are all in history, once each
    for (const name of ['Pasta', 'Garlic', 'Red pepper']) await expect(list.purchase(name)).toHaveCount(1);
    // unbought items remain required
    await expect(list.tick('Onion')).toBeVisible();
    await expect(list.progress()).toContainText(/^4 of \d+ items done/);
  });

  // 12. the member list shows both members: e2e/live/auth.live.spec.ts (invite test, `pnpm test:e2e:live`, D143).
});

test.describe('Pantry scan photo path (in the journey household)', () => {
  test('scan photos, review, confirm, and the pantry shows the stock', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('journey-pantry'));
    const photo = (color: string) =>
      sharp({ create: { width: 480, height: 360, channels: 3, background: color } }).jpeg().toBuffer()
        .then((buffer) => ({ name: `${color.slice(1)}.jpg`, mimeType: 'image/jpeg', buffer }));
    await page.goto('/pantry/scan');
    await page.getByTestId('photo-input').setInputFiles([await photo('#88aa44'), await photo('#aa8844')]);
    await page.getByRole('button', { name: 'Scan 2 images' }).click();
    await expect(page.getByTestId('scan-row')).toHaveCount(6);
    await expect(page.getByText('Nothing has been added yet')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Include kohlrabi' }).uncheck();
    await page.getByRole('checkbox', { name: 'Include pepper' }).uncheck();
    await page.getByRole('button', { name: 'Add 4 items to pantry' }).click();
    await expect(page.getByTestId('scan-done')).toContainText('Added 4 items to your pantry');
    await page.getByRole('link', { name: 'Back to pantry' }).click();
    await expect(page.getByRole('list', { name: 'Fruit and veg' })).toContainText('banana');
    await expect(page.getByRole('list', { name: 'Meat and poultry' })).toContainText('chicken breast');
  });
});

test.describe('Extraction edge cases (mock extraction)', () => {
  test('two-page recipe: upload both pages, they are merged into a single recipe to review', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles([recipeImg('03-beef-stew-two-page-p1.png'), recipeImg('03-beef-stew-two-page-p2.png')]);
    await expect(page.getByTestId('page-item')).toHaveCount(2);
    await imp.extract().click();
    const review = new RecipeReviewPage(page);
    await expect(review.heading()).toBeVisible();
    await expect(review.title()).toHaveValue("Nana's Lentil Soup");
    await expect(review.ingredientRows()).toHaveCount(6);
  });

  test('approximate, to-taste and optional lines are preserved, never converted to weights', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles(recipeImg('04-fractions-ranges.png'));
    await imp.extract().click();
    const review = new RecipeReviewPage(page);
    await expect(review.heading()).toBeVisible();
    await expect(page.getByLabel('Ingredient 5 quantity type')).toHaveValue('approximate');
    await expect(page.getByLabel('Ingredient 6 quantity type')).toHaveValue('to_taste');
    await expect(page.getByRole('checkbox', { name: 'Optional' }).nth(5)).toBeChecked();
    // no weight was invented for the pinch of salt
    await expect(review.ingredientRow(4)).not.toContainText(/\d+\s?g\b/);
  });
});

test.describe('Error states', () => {
  test('an unreadable upload is rejected with a clear message and nothing is extracted', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await imp.extract().click();
    await expect(page.getByTestId('import-error')).toContainText(/image type is not supported/i);
    await expect(new RecipeReviewPage(page).heading()).toHaveCount(0);
  });

  test('network drop shows the offline status and queues ticks (see shopping.spec for replay)', async ({ context, page }) => {
    await enterHousehold(context, newHouseholdId('journey-offline'));
    const planId = await seedApprovedPlan(context, [{ recipeId: SEED.pasta, servings: 4 }]);
    await page.goto(`/shopping?plan=${planId}`);
    const list = new ShoppingListPage(page);
    await list.root().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="shopping-root"]')?.getAttribute('data-hydrated') === 'true');
    await expect(list.tick('Onion')).toBeVisible({ timeout: 60_000 });
    await context.setOffline(true);
    await list.tick('Onion').click();
    await expect(list.syncIndicator()).toHaveAttribute('data-status', 'offline');
    await page.getByLabel('Show completed items').check();
    await expect(page.getByTestId('pending-badge')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId('pending-badge')).toHaveCount(0, { timeout: 15_000 });
  });

  test('AI failure shows a recoverable error with a manual-entry fallback', async () => {
    test.fixme(true, 'the mock provider has no failure mode; needs a real/failing AI provider (covered by pantry-scan and large-upload specs for missing provider / bad files)');
  });
});
