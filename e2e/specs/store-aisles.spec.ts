import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Stores, aisles and in-store ordering (lane AS1, D290-D299). Mock mode: each test has its own sandbox household
// (cookie `fr_household=e2e-*`) and the in-memory store book.

let seq = 0;
const newHousehold = () => `e2e-as1-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 6)}`;

const PASTA = '00000000-0000-4000-8000-000000000001';
const BEEF_STEW = '00000000-0000-4000-8000-000000000003';
const CHICKPEA_STEW = '00000000-0000-4000-8000-000000000008';

async function openPage(context: BrowserContext, household: string, path: string): Promise<Page> {
  await context.addCookies([{ name: 'fr_household', value: household, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function openShopping(page: Page) {
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

async function seedList(page: Page) {
  const res = await page.context().request.post('/api/dev/seed', {
    data: { kind: 'approved-plan', entries: [{ recipeId: PASTA, servings: 4 }, { recipeId: CHICKPEA_STEW, servings: 4 }, { recipeId: BEEF_STEW, servings: 6 }] },
  });
  expect(res.ok()).toBe(true);
  const { planId } = (await res.json()) as { planId: string };
  await page.goto(`/shopping?plan=${planId}`);
  await expect(page.getByRole('checkbox', { name: /^Onion/ })).toBeVisible();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

async function addStore(page: Page, name: string, chain: string, aisles: string[]) {
  await page.goto('/settings/stores');
  await page.getByLabel('Store name').fill(name);
  await page.getByLabel('Chain (optional)').fill(chain);
  await page.getByRole('button', { name: 'Add store' }).click();
  const card = page.getByTestId(`store-${name}`);
  await expect(card).toBeVisible();
  for (const a of aisles) {
    await card.getByLabel('New aisle').fill(a);
    await card.getByRole('button', { name: 'Add aisle' }).click();
    await expect(card.getByTestId(`aisle-row-${a}`)).toBeVisible({ timeout: 60_000 }); // first call compiles the server action in dev
  }
}

const selectStore = async (page: Page, label: string) => {
  await page.getByLabel('Shopping at').selectOption({ label });
};
const headings = (page: Page) => page.locator('h3.fr-shopcat').allTextContents();
async function placeItem(page: Page, item: string, aisle: string) {
  await page.getByRole('button', { name: new RegExp(`^(Set|Change) aisle for ${item}`) }).click();
  await page.getByTestId(`aisle-chip-${aisle}`).click();
}
const sectionOf = (page: Page, item: string) =>
  page.locator('section[data-aisle]').filter({ has: page.getByRole('checkbox', { name: new RegExp(`^${item}`) }) }).getAttribute('data-aisle');

test.describe('stores and aisles', () => {
  test('settings: create stores, edit and reorder aisles, see placements, copy a layout, delete', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/settings/stores');
    await expect(page.getByTestId('no-stores')).toBeVisible();
    await addStore(page, 'ALDI Gosforth', 'ALDI', ['1', '2', '3']);
    const aldi = page.getByTestId('store-ALDI Gosforth');

    // rename an aisle
    const first = aldi.getByLabel('Aisle 1 name at ALDI Gosforth');
    await first.fill('Fruit & veg');
    await first.blur();
    await expect(aldi.getByTestId('aisle-row-Fruit & veg')).toBeVisible();

    // reorder with the buttons: move "3" up
    await aldi.getByRole('button', { name: 'Move 3 up' }).click();
    await expect(aldi.locator('ol li').nth(1).getByRole('textbox')).toHaveValue('3');

    // a starting template adds aisles and category placements, labelled as a guess
    await expect(aldi.getByText('A generic guess, not real shop data').first()).toBeVisible();
    await aldi.getByLabel('Add starting aisles').selectOption({ label: 'Typical UK discount store (a starting guess)' });
    await aldi.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(aldi.getByRole('list', { name: 'Placements at ALDI Gosforth' })).toContainText('Everything in Frozen');

    // placements can be changed and removed
    await aldi.getByLabel('Aisle for Everything in Frozen').selectOption({ label: 'Drinks' });
    await expect(aldi.getByLabel('Aisle for Everything in Frozen')).toHaveValue(/.+/);
    await aldi.getByRole('button', { name: 'Remove placement for Everything in Household' }).click();
    await expect(aldi.getByRole('list', { name: 'Placements at ALDI Gosforth' })).not.toContainText('Everything in Household');

    // copy a layout onto a same-chain store
    await page.getByLabel('Store name').fill('ALDI City');
    await page.getByLabel('Chain (optional)').fill('aldi');
    await page.getByRole('button', { name: 'Add store' }).click();
    const city = page.getByTestId('store-ALDI City');
    await city.getByLabel('Copy aisles and placements from').selectOption({ label: 'ALDI Gosforth (same chain)' });
    await city.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Replace and copy' }).click();
    await expect(city.getByTestId('aisle-row-Fruit & veg')).toBeVisible();
    await expect(city.getByRole('list', { name: 'Placements at ALDI City' })).toContainText('Everything in Frozen');

    // duplicate names are refused, deleting asks first
    await page.getByLabel('Store name').fill('aldi city');
    await page.getByRole('button', { name: 'Add store' }).click();
    await expect(page.getByTestId('stores-error')).toHaveText('You already have a store with that name.');
    await city.getByRole('button', { name: 'Delete ALDI City' }).click();
    await page.getByRole('button', { name: 'Delete store' }).click();
    await expect(page.getByTestId('store-ALDI City')).toHaveCount(0);
    await expect(page.getByTestId('store-ALDI Gosforth')).toBeVisible();
  });

  test('shopping: pick a store, quick-place items, list follows each store\'s aisle order, choice is remembered', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/shopping');
    await seedList(page);
    await addStore(page, 'ALDI Gosforth', 'ALDI', ['1', '3', '5']);
    await addStore(page, 'LIDL High St', 'LIDL', ['Fruit', 'Dairy']);
    await openShopping(page);

    // default: grouped by category
    expect(await headings(page)).toContain('Fruit & veg');
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-store', '');

    // ALDI: nothing placed yet, everything under "Not placed yet"
    await selectStore(page, 'ALDI Gosforth');
    await expect(page.getByTestId('shopping-root')).not.toHaveAttribute('data-store', '');
    expect(await headings(page)).toEqual(['Not placed yet']);

    // quick placement: Onion -> aisle 1, Pasta -> 5, Carrot -> 3 (placed out of order on purpose)
    await placeItem(page, 'Onion', '1');
    await placeItem(page, 'Pasta', '5');
    await placeItem(page, 'Carrot', '3');
    await expect.poll(() => headings(page).then((h) => h.slice(0, 3))).toEqual(['Aisle 1', 'Aisle 3', 'Aisle 5']);
    expect((await headings(page)).at(-1)).toBe('Not placed yet');
    expect(await sectionOf(page, 'Onion')).toBe('Aisle 1');
    expect(await sectionOf(page, 'Pasta')).toBe('Aisle 5');

    // LIDL has its own placements: switching changes the order
    await selectStore(page, 'LIDL High St');
    expect(await headings(page)).toEqual(['Not placed yet']);
    await placeItem(page, 'Pasta', 'Fruit');
    await placeItem(page, 'Onion', 'Dairy');
    await expect.poll(() => headings(page).then((h) => h.slice(0, 2))).toEqual(['Fruit', 'Dairy']);
    expect(await sectionOf(page, 'Pasta')).toBe('Fruit');

    // back to ALDI: its order is untouched
    await selectStore(page, 'ALDI Gosforth');
    await expect.poll(() => headings(page).then((h) => h.slice(0, 3))).toEqual(['Aisle 1', 'Aisle 3', 'Aisle 5']);

    // the placement and the chosen store survive a reload (server + this device)
    await page.reload();
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await expect(page.getByLabel('Shopping at')).toHaveValue(/.+/);
    await expect.poll(() => headings(page).then((h) => h.slice(0, 3))).toEqual(['Aisle 1', 'Aisle 3', 'Aisle 5']);
    expect(await sectionOf(page, 'Carrot')).toBe('Aisle 3');

    // no store: back to category grouping
    await page.getByLabel('Shopping at').selectOption({ label: 'No store: group by category' });
    expect(await headings(page)).toContain('Fruit & veg');
  });

  test('shopping: a category placement covers everything in it; an item placement overrides it; clear removes it', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/shopping');
    await seedList(page);
    await addStore(page, 'Tesco', 'Tesco', ['A', 'B']);
    await openShopping(page);
    await selectStore(page, 'Tesco');
    await page.getByRole('button', { name: /^Set aisle for Onion/ }).click();
    await page.getByLabel(/Everything in/).check();
    await page.getByTestId('aisle-chip-A').click();
    expect(await sectionOf(page, 'Carrot')).toBe('A'); // same category, one placement
    await placeItem(page, 'Carrot', 'B'); // ingredient-level wins over category-level
    expect(await sectionOf(page, 'Carrot')).toBe('B');
    expect(await sectionOf(page, 'Onion')).toBe('A');
    await page.getByRole('button', { name: /^Change aisle for Carrot/ }).click();
    await page.getByRole('button', { name: 'Clear aisle' }).click();
    await expect.poll(() => sectionOf(page, 'Carrot')).toBe('A'); // falls back to the category placement
  });

  test('shopping: "learn from my route" only suggests, and applies on confirmation', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/shopping');
    await seedList(page);
    await addStore(page, 'ALDI Gosforth', 'ALDI', ['1', '3', '5']);
    await openShopping(page);
    await selectStore(page, 'ALDI Gosforth');
    await placeItem(page, 'Onion', '1');
    await placeItem(page, 'Carrot', '3');
    await placeItem(page, 'Pasta', '5');
    await page.getByLabel('Learn from my route').check();
    // walk the shop backwards
    await page.getByRole('checkbox', { name: /^Pasta/ }).click();
    await page.getByRole('checkbox', { name: /^Carrot/ }).click();
    await expect(page.getByTestId('route-suggestion')).toHaveCount(0); // two aisles is not enough evidence
    await page.getByRole('checkbox', { name: /^Onion/ }).click();
    const banner = page.getByTestId('route-suggestion');
    await expect(banner).toContainText('5 > 3 > 1');
    // nothing reordered yet
    await page.getByLabel('Show completed items').check();
    expect((await headings(page)).slice(0, 3)).toEqual(['Aisle 1', 'Aisle 3', 'Aisle 5']);
    await banner.getByRole('button', { name: 'Update aisle order' }).click();
    await expect.poll(() => headings(page).then((h) => h.slice(0, 3))).toEqual(['Aisle 5', 'Aisle 3', 'Aisle 1']);
    await expect(banner).toHaveCount(0);
  });

  test('a11y: stores settings and in-store shopping (axe, 44px targets on mobile)', async ({ context }) => {
    const page = await openPage(context, newHousehold(), '/shopping');
    await page.setViewportSize({ width: 375, height: 812 });
    await seedList(page);
    await addStore(page, 'ALDI Gosforth', 'ALDI', ['1', '3']);
    const small = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type=hidden]), [role=checkbox]')]
          .filter((el) => { const r = el.getBoundingClientRect(); return !el.matches('.fr-skip-link') && r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && !el.closest('[aria-hidden=true]') && getComputedStyle(el).visibility !== 'hidden'; })
          .filter((el) => !(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') && el.closest('label')))
          .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}`));
    const axe = async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    };
    await page.goto('/settings/stores');
    await expect(page.getByTestId('store-ALDI Gosforth')).toBeVisible();
    await axe();
    expect(await small()).toEqual([]);

    await openShopping(page);
    await selectStore(page, 'ALDI Gosforth');
    await axe();
    expect(await small()).toEqual([]);
    await page.getByRole('button', { name: /^Set aisle for Onion/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await axe();
    expect(await small()).toEqual([]);
  });
});
