// BRIEF section 15 end-to-end journey (steps 1-11) incl. two-session sync.
// Every step is test.fixme until its lane lands; flip to test() as each feature merges.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES_DIR, createHousehold, newUser, secondSession, signUp, useMockAi, acceptInvite } from '../support/helpers.js';
import { HouseholdPage, MealPlanPage, PurchaseHistoryPage, ReceiptPage, RecipeImportPage, RecipeLibraryPage, RecipeReviewPage, ShoppingListPage } from '../support/pages.js';

const recipeImg = (f: string) => join(FIXTURES_DIR, 'recipes', f);
const receiptImg = (f: string) => join(FIXTURES_DIR, 'receipts', f);

test.describe.serial('Main journey (BRIEF s15)', () => {
  const alice = newUser('alice');
  const bob = newUser('bob');

  test.fixme('1. create an account', async ({ page }) => {
    await signUp(page, alice);
    await expect(page).toHaveURL(/\/(household|home)/);
  });

  test.fixme('2. create a household', async ({ page }) => {
    await createHousehold(page, 'QA Household');
    await expect(page.getByRole('heading', { name: 'QA Household' })).toBeVisible();
  });

  test.fixme('3. add a recipe from a test image (deterministic mock extraction)', async ({ page }) => {
    await useMockAi(page, 'recipe', '01-tomato-pasta');
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles(recipeImg('01-tomato-pasta.png'));
    await imp.extract().click();
    await expect(new RecipeReviewPage(page).title()).toHaveValue('Sunday Tomato Pasta');
  });

  test.fixme('4. correct and save the recipe (edit servings, fix a line, save)', async ({ page }) => {
    const review = new RecipeReviewPage(page);
    await review.servings().fill('6');
    await review.save().click();
    await expect(new RecipeLibraryPage(page).card('Sunday Tomato Pasta')).toBeVisible();
    // repeat for 2+ more recipes (02-lemon-loaf, 06-fish-pie) so the plan has several
  });

  test.fixme('5. add multiple recipes to a weekly plan and approve it', async ({ page }) => {
    const plan = new MealPlanPage(page);
    await plan.goto();
    await plan.addToSlot('2026-10-19', 'dinner').click();
    await page.getByRole('option', { name: 'Sunday Tomato Pasta' }).click();
    await plan.approve().click();
  });

  test.fixme('6. generate a combined shopping list (same ingredient merged, provenance kept)', async ({ page }) => {
    await new MealPlanPage(page).generateList().click();
    const list = new ShoppingListPage(page);
    await expect(list.item('milk')).toHaveCount(1); // combined across recipes
  });

  test.fixme('7. confirm quantities and estimated costs are labelled as estimates', async ({ page }) => {
    const list = new ShoppingListPage(page);
    await expect(list.estimatedTotal()).toContainText('£');
    await expect(list.estimateLabel()).toBeVisible();
  });

  test.fixme('8. tick off a purchase (creates a PurchaseEvent)', async ({ page }) => {
    const list = new ShoppingListPage(page);
    await list.tick('spaghetti').check();
    await expect(list.tick('spaghetti')).toBeChecked();
  });

  test.fixme('9. second household session sees the update (realtime sync, no reload)', async ({ browser, page }) => {
    const second = await secondSession(browser);
    try {
      await signUp(second.page, bob);
      await acceptInvite(second.page, 'TODO-invite-url', bob);
      const theirs = new ShoppingListPage(second.page);
      await theirs.goto();
      const mine = new ShoppingListPage(page);
      await mine.goto();
      await mine.tick('garlic').check();
      await expect(theirs.tick('garlic')).toBeChecked({ timeout: 10_000 });
      await expect(theirs.syncIndicator()).toHaveText(/synced|live/i);
    } finally {
      await second.context.close();
    }
  });

  test.fixme('9b. offline tick replays idempotently on reconnect (no double purchase)', async ({ browser, page }) => {
    const second = await secondSession(browser);
    try {
      await second.context.setOffline(true);
      // tick in offline session, go online, assert exactly one PurchaseEvent via history page
      await second.context.setOffline(false);
      void page;
    } finally {
      await second.context.close();
    }
  });

  test.fixme('10. reconcile a receipt (r1-weekly-shop): suggestions, confirm, unmatched line stays unmatched', async ({ page }) => {
    await useMockAi(page, 'receipt', 'r1-weekly-shop');
    const rc = new ReceiptPage(page);
    await rc.goto();
    await rc.fileInput().setInputFiles(receiptImg('r1-weekly-shop.png'));
    await rc.parse().click();
    await expect(rc.matchSuggestion('SPAGH 500G')).toContainText(/spaghetti/i);
    await expect(rc.matchSuggestion('CARRIERBAG 5P')).toHaveCount(0); // must NOT auto-match
    await rc.confirmMatch('SPAGH 500G').click(); // user confirms; never auto-confirmed
    await rc.confirmAll().click();
  });

  test.fixme('11. purchase history and remaining requirements are correct', async ({ page }) => {
    const hist = new PurchaseHistoryPage(page);
    await hist.goto();
    await expect(hist.entry('spaghetti')).toContainText('0.95');
    const list = new ShoppingListPage(page);
    await list.goto();
    // items fully purchased disappear/complete; partial purchases show remainder
    await expect(list.item('milk')).toBeVisible();
  });

  test.fixme('12. household member list shows both members', async ({ page }) => {
    const hh = new HouseholdPage(page);
    await hh.goto();
    await expect(hh.memberRow(alice.displayName)).toBeVisible();
    await expect(hh.memberRow(bob.displayName)).toBeVisible();
  });
});

test.describe('Extraction edge cases (fixtures)', () => {
  test.fixme('blurry image shows low-confidence warning and blocks silent save', async ({ page }) => {
    await useMockAi(page, 'recipe', '05-blurry-curry');
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles(recipeImg('05-blurry-curry.png'));
    await imp.extract().click();
    await expect(imp.lowConfidenceBanner()).toBeVisible();
  });

  test.fixme('two-page recipe: upload both pages, single merged recipe', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles([recipeImg('03-beef-stew-two-page-p1.png'), recipeImg('03-beef-stew-two-page-p2.png')]);
    await imp.extract().click();
    await expect(new RecipeReviewPage(page).ingredientRow(9)).toBeVisible(); // 10 ingredients across pages
  });

  test.fixme('fractions/ranges/pinch/to taste are preserved, never converted to weights', async ({ page }) => {
    const imp = new RecipeImportPage(page);
    await imp.goto();
    await imp.fileInput().setInputFiles(recipeImg('04-fractions-ranges.png'));
    await imp.extract().click();
    const review = new RecipeReviewPage(page);
    await expect(review.ingredientRow(2)).toContainText('2-3');
    await expect(page.getByText('a pinch')).toBeVisible();
    await expect(page.getByText('to taste')).toBeVisible();
  });
});

test.describe('Error states', () => {
  test.fixme('AI failure shows a recoverable error with manual-entry fallback', async () => {});
  test.fixme('unsupported / oversized file upload is rejected with a clear message', async () => {});
  test.fixme('unauthenticated access to /shopping redirects to sign-in', async () => {});
  test.fixme('network drop shows offline banner and queues ticks', async () => {});
});
