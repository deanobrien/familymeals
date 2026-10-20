// P1-A Cooking (D360-D369): cook mode (steps, timers, resume, swaps), mark as cooked with a rating and note, substitutions.
// In-memory mode, mock auth, mock AI. Own sandbox household, so the library assertions stay isolated.
import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers';

test.describe.configure({ mode: 'serial' });

const household = newHouseholdId('cook');
test.beforeEach(async ({ context }) => {
  await enterHousehold(context, household);
});

const title = `E2E Cook ${Date.now().toString(36)}`;

async function createRecipe(page: Page) {
  await page.goto('/recipes/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByLabel('Servings', { exact: true }).fill('4');
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('butter');
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).blur();
  await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('100');
  await page.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('g');
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Melt the butter.');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('textbox', { name: 'Step 2', exact: true }).fill('Simmer for 10-12 mins until golden.');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
}

test('cook mode: step through, start a timer, swap an ingredient, resume, finish with a rating and a private note', async ({ page }) => {
  await createRecipe(page);
  const detailUrl = page.url();

  // detail: nothing cooked yet
  await expect(page.getByTestId('cooked-summary')).toContainText('Not cooked yet');
  await page.getByTestId('cook-mode-link').click();
  await expect(page.getByTestId('cook-mode')).toBeVisible();

  // step 1: scaled ingredient checklist for the step, "Out of this?" gives AI suggestions (peanut butter is filtered out)
  await expect(page.getByTestId('step-count')).toHaveText('Step 1 of 2');
  await expect(page.getByTestId('step-text')).toHaveText('Melt the butter.');
  await expect(page.getByTestId('step-ingredients')).toContainText('100 g');
  await page.getByRole('button', { name: 'Out of butter?' }).click();
  const panel = page.getByTestId('substitution-panel');
  await expect(panel.getByTestId('substitute').first()).toBeVisible();
  await expect(panel).toContainText('olive oil');
  await expect(panel).not.toContainText('peanut butter');
  await expect(panel.getByTestId('withheld-note')).toContainText('left out because of your household exclusions');
  await panel.getByTestId('substitute').filter({ hasText: 'margarine' }).getByRole('button', { name: 'Use for this cook' }).click();
  await expect(page.getByTestId('swap-note')).toContainText('Using margarine instead of butter');

  // keyboard navigation to step 2 and a detected 10-12 min timer
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-count')).toHaveText('Step 2 of 2');
  await page.getByTestId('start-timer').click();
  const timer = page.getByTestId('timer').first();
  await expect(timer).toHaveAttribute('data-status', 'running');
  await expect(timer).toContainText('9:');
  await timer.getByTestId('pause-timer').click();
  await expect(timer).toHaveAttribute('data-status', 'paused');
  await timer.getByTestId('reset-timer').click();
  await expect(timer).toContainText('10:00');
  await timer.getByTestId('resume-timer').click();

  // resume where you left off: leave and come back
  await page.getByTestId('exit-cook').click();
  await expect(page).toHaveURL(detailUrl);
  await page.getByTestId('cook-mode-link').click();
  await expect(page.getByTestId('resumed-note')).toBeVisible();
  await expect(page.getByTestId('step-count')).toHaveText('Step 2 of 2');
  await expect(page.getByTestId('timer')).toHaveCount(1);
  await expect(page.getByTestId('timer').first()).toHaveAttribute('data-status', 'running');
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByTestId('swap-note')).toContainText('margarine'); // the swap was remembered too

  // finish: rate, private note
  await page.getByTestId('next-step').click();
  await expect(page.getByTestId('next-step')).toHaveText('Finish');
  await page.getByTestId('next-step').click();
  await expect(page.getByTestId('cook-done')).toBeVisible();
  await page.getByTestId('rate-4').click();
  await page.getByLabel('Note for next time (optional)').fill('less butter next time');
  await page.getByTestId('save-cooked').click();
  await expect(page.getByTestId('cook-saved')).toBeVisible();
  await page.getByRole('link', { name: 'Back to recipe' }).click();

  // detail now shows the rating, last cooked and the (private) note
  await expect(page.getByTestId('cooked-summary')).toContainText('Cooked once, today');
  await expect(page.getByTestId('cooked-summary')).toContainText('You rated it 4/5');
  await expect(page.getByTestId('cook-history')).toContainText('less butter next time');
  await expect(page.getByTestId('cook-history')).toContainText('(private)');

  // and on the recipe card in the list
  await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
  await expect(page.getByTestId('recipe-card-note').first()).toContainText('★ 4');
  await expect(page.getByTestId('recipe-card-note').first()).toContainText('Cooked once, today');
});

test('mark as cooked from the recipe page, and save a substitution as a variant copy', async ({ page }) => {
  await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
  await page.getByRole('link', { name: title }).first().click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  const originalUrl = page.url();

  await page.getByTestId('mark-cooked').click();
  await page.getByTestId('rate-5').click();
  await page.getByLabel('Note for next time (optional)').fill('Great with rice');
  await page.getByLabel('Who can see the note').selectOption('household');
  await page.getByTestId('save-cooked').click();
  await expect(page.getByTestId('cooked-flash')).toBeVisible();
  await expect(page.getByTestId('cooked-summary')).toContainText('Cooked 2 times');
  await expect(page.getByTestId('cook-history')).toContainText('(household)');

  // substitution -> variant (a copy; the original keeps butter)
  await page.getByRole('button', { name: 'Out of butter?' }).click();
  const panel = page.getByTestId('substitution-panel');
  await panel.getByTestId('substitute').filter({ hasText: 'olive oil' }).getByRole('button', { name: 'Save as variant' }).click();
  await expect(page.getByTestId('variant-saved')).toContainText('(no butter)');
  await page.getByTestId('variant-saved').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(no butter)');
  await expect(page.getByRole('list', { name: 'Ingredients' })).toContainText('olive oil');

  await page.goto(originalUrl);
  await expect(page.getByRole('list', { name: 'Ingredients' })).toContainText('butter');
  await expect(page.getByRole('list', { name: 'Ingredients' })).not.toContainText('olive oil');
});

test("don't suggest again keeps the recipe out of planner proposals", async ({ page }) => {
  await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
  await page.getByRole('link', { name: title }).first().click();
  await page.getByTestId('dont-suggest').click();
  await expect(page.getByTestId('dont-suggest')).toContainText('Planner skips this');
  await page.reload();
  await expect(page.getByTestId('dont-suggest')).toContainText('Planner skips this');
  await page.getByTestId('dont-suggest').click();
  await expect(page.getByTestId('dont-suggest')).toContainText("Don't suggest again");
});
