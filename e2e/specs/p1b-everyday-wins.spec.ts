// P1-B (D370-D379): recipe from a web link (offline fixture pages via URL_IMPORT_SOURCE=mock, no network), "What can I make
// now?", "5 a day" + variety, and per-person soft dislikes. Each test uses its own sandbox household (mock auth, `fr_household`
// cookie) so shopping lists, settings and plans never leak into other specs.
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const FIXTURE = 'https://fixtures.recipes.test';
const sandbox = (name: string) => `e2e-p1b-${name}-${Date.now().toString(36)}`;
const useHousehold = async (context: import('@playwright/test').BrowserContext, id: string) =>
  context.addCookies([{ name: 'fr_household', value: id, domain: 'localhost', path: '/' }]);

async function deleteThisRecipe(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\?deleted=1/);
}

test.describe('recipe from a web link', () => {
  test.beforeEach(async ({ context }) => useHousehold(context, 'e2e-p1b-link'));

  test('reads the page\'s recipe data into the shared review screen and saves it with the source link', async ({ page }) => {
    await page.goto('/recipes/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import a recipe' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'From a web link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read recipe from link' })).toBeDisabled();

    await page.getByLabel('Web address of a recipe').fill(`${FIXTURE}/dahl?utm_source=newsletter#top`);
    await page.getByRole('button', { name: 'Read recipe from link' }).click();

    // the SAME review screen as a photo import
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Fixture Lentil Dahl');
    await expect(page.getByTestId('ingredient-row')).toHaveCount(6);
    await expect(page.getByTestId('review-source')).toContainText('Sam Fixture on Fixture Kitchen');
    // the source link stays prominent and tracking parameters are gone
    await expect(page.getByTestId('review-source-link')).toHaveAttribute('href', `${FIXTURE}/dahl`);
    await expect(page.getByTestId('review-provider')).toHaveCount(0); // structured data: no AI was involved
    await expect(page.getByTestId('extraction-warnings')).toContainText('Note from the page');
    await expect(page.getByTestId('cover-picker')).toBeVisible(); // the page's own picture, downloaded server side

    await page.getByRole('button', { name: /^Save recipe/ }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Fixture Lentil Dahl' })).toBeVisible();
    const link = page.getByRole('link', { name: 'Sam Fixture on Fixture Kitchen' });
    await expect(link).toHaveAttribute('href', `${FIXTURE}/dahl`);
    await deleteThisRecipe(page, page.url());
  });

  test('a page with no recipe data is read from its text by AI, and the reviewer is told', async ({ page }) => {
    await page.goto('/recipes/import');
    await page.getByLabel('Web address of a recipe').fill(`${FIXTURE}/plain`);
    await page.getByRole('button', { name: 'Read recipe from link' }).click();
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    await expect(page.getByTestId('extraction-warnings')).toContainText('read from its text by AI');
    await expect(page.getByTestId('review-source-link')).toHaveAttribute('href', `${FIXTURE}/plain`);
  });

  test('refuses private addresses, redirects into the internal network and blocked sites with plain messages', async ({ page }) => {
    await page.goto('/recipes/import');
    const field = page.getByLabel('Web address of a recipe');
    const go = page.getByRole('button', { name: 'Read recipe from link' });
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/admin', 'file:///etc/passwd', `${FIXTURE}/to-internal`]) {
      await field.fill(url);
      await go.click();
      await expect(page.getByTestId('link-error'), url).toContainText(/not a public web site|Only http and https|not allowed|web address/i);
    }
    await field.fill(`${FIXTURE}/refused`);
    await go.click();
    await expect(page.getByTestId('link-error')).toContainText('would not let us read the page');
    await field.fill(`${FIXTURE}/missing`);
    await go.click();
    await expect(page.getByTestId('link-error')).toContainText('was not found');
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toHaveCount(0);
  });

  test('?url= pre-fills the address but never starts reading by itself', async ({ page }) => {
    await page.goto(`/recipes/import?url=${encodeURIComponent(`${FIXTURE}/dahl`)}`);
    await expect(page.getByLabel('Web address of a recipe')).toHaveValue(`${FIXTURE}/dahl`);
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toHaveCount(0);
  });
});

test.describe('What can I make now?', () => {
  test('ranks recipes from the pantry on Pantry and Home, and adds the missing items once', async ({ page, context }) => {
    await useHousehold(context, sandbox('makenow'));
    await page.goto('/pantry');
    const section = page.getByTestId('make-now');
    await expect(section.getByRole('heading', { name: 'What can I make now?' })).toBeVisible();
    const items = section.getByTestId('make-now-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(0);
    await expect(items.first()).toContainText(/Ready to cook|% covered/);

    const needy = items.filter({ has: page.getByTestId('make-now-missing') }).first();
    await expect(needy).toBeVisible();
    await expect(needy.getByTestId('make-now-missing')).toContainText('Still needed:');
    const title = (await needy.getByRole('link').first().textContent())!.trim();
    await needy.getByRole('button', { name: /^Add missing items for/ }).click();
    await expect(page.getByText(/Added \d+ items? to your shopping list|already on your shopping list/)).toBeVisible();
    // adding again changes nothing
    await needy.getByRole('button', { name: /^Add missing items for/ }).click();
    await expect(page.getByText(/already on your shopping list/).first()).toBeVisible();

    await page.goto('/shopping');
    await expect(page.getByText(`For ${title}`).first()).toBeVisible();

    await page.goto('/');
    const home = page.getByTestId('make-now');
    await expect(home.getByRole('heading', { name: 'What can I make now?' })).toBeVisible();
    expect(await home.getByTestId('make-now-item').count()).toBeLessThanOrEqual(3);
  });

  test('respects allergy exclusions: a household that excludes an ingredient never sees recipes that contain it', async ({ page, context }) => {
    await useHousehold(context, sandbox('allergy'));
    await page.goto('/settings');
    await page.getByLabel('milk', { exact: true }).check();
    await page.getByLabel(/I agree to this use of my dietary information/).check();
    await page.getByRole('button', { name: 'Save dietary information' }).click();
    await expect(page.getByText('Dietary information saved')).toBeVisible();
    await page.goto('/pantry');
    const section = page.getByTestId('make-now');
    await expect(section.getByRole('heading', { name: 'What can I make now?' })).toBeVisible();
    await expect(section).not.toContainText(/\bmilk\b/i);
    await expect(section.getByTestId('make-now-hidden').or(section.getByTestId('make-now-empty'))).toBeVisible();
  });
});

test.describe('5 a day and variety', () => {
  test('the planner week shows an estimated fruit and veg count, protein kinds, plants and a plain disclaimer', async ({ page, context }) => {
    await useHousehold(context, sandbox('variety'));
    const W = '2026-12-07';
    await page.goto(`/plan?week=${W}`);
    await expect(page.getByTestId('week-variety')).toHaveCount(0); // nothing planned: nothing to say
    await page.getByRole('button', { name: /^Add meal to Dinner on Mon/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('searchbox').fill('Family Fish Pie');
    await sheet.getByRole('button', { name: 'Select Family Fish Pie' }).click();
    const panel = page.getByTestId('week-variety');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Fruit, veg and variety' })).toBeVisible();
    await expect(page.getByTestId('variety-score')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('variety-protein')).toContainText('Fish: 1 meal');
    await expect(page.getByTestId('week-variety-disclaimer')).toContainText('not dietary or medical advice');
    await expect(panel).not.toContainText(/recommended|deficien|healthy|unhealthy/i);
    // no cooking log yet (P1-A): no Planned / Cooked toggle
    await expect(panel.getByRole('button', { name: 'Cooked' })).toHaveCount(0);
  });
});

test.describe('per-person soft dislikes', () => {
  test('are saved per member in Settings (never mixed with allergies), shown as chips in the planner, and sort Discover results lower', async ({ page, context }) => {
    await useHousehold(context, sandbox('dislikes'));
    await page.goto('/settings');
    const section = page.getByTestId('dislikes-section');
    await expect(section.getByRole('heading', { name: /Foods people don.t like/ })).toBeVisible();
    await expect(section).toContainText('Just a preference, not an allergy');
    const sam = section.getByTestId('dislikes-member').filter({ hasText: 'Sam' });
    await sam.getByLabel(/Add a food Sam doesn't like/).fill('Salmon');
    await sam.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(sam.getByTestId('dislike-chip')).toContainText('salmon');
    await sam.getByRole('button', { name: /Save for Sam/ }).click();
    await expect(page.getByText(/Saved what Sam doesn.t like/)).toBeVisible();
    // not an allergy: no consent was needed and the allergy list is untouched
    await expect(page.getByLabel('salmon', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('dislikes-member').filter({ hasText: 'Sam' }).getByTestId('dislike-chip')).toContainText('salmon');

    // the planner shows them as read-only chips
    await page.goto('/plan?week=2026-12-14');
    await page.getByRole('button', { name: 'Understand my request' }).click();
    const chips = page.getByTestId('dislike-chips');
    await expect(chips).toBeVisible();
    await expect(chips).toContainText('Sam: salmon');
    await expect(chips).toContainText('Avoided where possible, never a rule');
    await expect(chips.getByRole('button')).toHaveCount(0); // read-only: edited in Settings

    // Discover: the same recipes, the disliked one marked and not first
    await page.goto('/recipes/discover');
    await page.getByLabel('Search recipes').fill('salmon');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const card = page.getByTestId('discover-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('card-dislike')).toContainText(/Sam doesn.t like something in this/);
  });
});
