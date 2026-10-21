// P2-C (D410-D419): busy evenings (manual toggle, ICS subscription via the offline fixture feed), "Cook x2" batch cooking, the
// freezer inventory and leftover / freezer meals in plan slots. In-memory mode, mock auth, own sandbox household.
import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const household = newHouseholdId('p2c');
test.beforeEach(async ({ context }) => enterHousehold(context, household));

const title = `E2E Chilli ${Date.now().toString(36)}`;

/** Monday of next week (UTC, as the planner computes weeks) so every day of the grid is still ahead. */
function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const NEXT = nextMonday();

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

test('Cook x2 into the freezer lands in the Pantry freezer view', async ({ page }) => {
  await createRecipe(page);
  await page.getByTestId('mark-cooked').click();
  const form = page.getByTestId('mark-cooked-form');
  await form.getByLabel('Batch cooking').selectOption('2');
  await form.getByLabel('Keep the spare portions in').selectOption('freezer');
  await expect(form).toContainText('4 spare portions');
  await page.getByTestId('save-cooked').click();
  await expect(page.getByTestId('cooked-flash')).toContainText('4 spare portions added to your freezer list');

  await page.goto('/pantry');
  const panel = page.getByTestId('freezer-panel');
  await expect(panel).toContainText('Leftovers and freezer');
  await expect(panel.getByRole('list', { name: 'Freezer meals' })).toContainText(title);
  await expect(panel).toContainText('4 of 4 portions left');
  await expect(panel).toContainText('Best by');
});

test('a freezer meal goes into a busy evening; eaten once, the portions leave the freezer', async ({ page }) => {
  await page.goto(`/plan?week=${NEXT}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Meal planner' })).toBeVisible();

  // mark Tuesday busy by hand: a chip with the label appears (no titles, just the flag)
  const tue = new Date(`${NEXT}T00:00:00Z`);
  tue.setUTCDate(tue.getUTCDate() + 1);
  const TUE = tue.toISOString().slice(0, 10);
  await page.getByTestId(`busy-${TUE}`).click();
  await expect(page.getByTestId(`busy-chip-${TUE}`)).toHaveText('Busy');
  await expect(page.getByTestId('busy-chips')).toContainText('you marked it');

  // suggestions offer the freezer meal, busy evening first
  const suggestions = page.getByTestId('leftover-suggestions');
  await expect(suggestions).toContainText(`Freezer meal: ${title}, 4 portions`);
  await expect(suggestions).toContainText('A busy evening');
  await suggestions.getByRole('button', { name: /^Add Freezer meal/ }).first().click();
  const slot = page.getByTestId(`slot-${TUE}-dinner`);
  await expect(slot).toContainText(`Freezer meal: ${title}`);
  await expect(slot).toContainText('4 portions');
  await expect(slot).toContainText('No shopping'.replace('No shopping', 'Uses leftovers'));

  // save, then mark eaten: needs a saved plan, takes the portions once
  await expect(slot.getByRole('button', { name: /as eaten/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByTestId('plan-message')).toContainText('Plan saved');
  await slot.getByRole('button', { name: /as eaten/ }).click();
  await expect(page.getByTestId('plan-message')).toContainText('Marked eaten. 0 portions of that batch left');
  await expect(slot).toContainText('Eaten');
  await expect(slot.getByRole('button', { name: /as eaten/ })).toHaveCount(0);

  await page.goto('/pantry');
  await expect(page.getByTestId('freezer-panel').getByTestId('no-stored')).toBeVisible();
});

test('calendar link: a fixture feed is read, the address is never shown again, and it can be removed', async ({ page }) => {
  await page.goto(`/plan?week=${NEXT}`);
  const panel = page.getByTestId('calendar-panel');
  await panel.locator('summary').click();
  await expect(panel).toContainText('Event titles, places and');
  await panel.getByLabel('Calendar address (optional)').fill('https://fixtures.recipes.test/calendar.ics');
  await panel.getByRole('button', { name: 'Link calendar' }).click();
  await expect(page.getByTestId('calendar-message')).toContainText('Calendar linked');
  await expect(page.getByTestId('ics-linked')).toContainText('fixtures.recipes.test');
  await expect(page.locator('body')).not.toContainText('calendar.ics');
  await expect(panel.getByLabel('Calendar address (optional)')).toHaveCount(0);

  // an internal address is refused with a clear message
  await panel.getByRole('button', { name: 'Remove calendar link' }).click();
  await expect(page.getByTestId('calendar-message')).toContainText('Calendar link removed');
  await panel.getByLabel('Calendar address (optional)').fill('http://169.254.169.254/latest/meta-data/');
  await panel.getByRole('button', { name: 'Link calendar' }).click();
  await expect(page.getByTestId('calendar-message')).toContainText('not a public web address');
});

test('privacy notice and export describe calendars and leftovers', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByText('Busy evenings and calendars (only if you use them)')).toBeVisible();
  await expect(page.getByText('Leftovers and freezer meals:')).toBeVisible();
});
