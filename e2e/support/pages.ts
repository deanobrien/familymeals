// Page objects for the real routes (mock-auth mode). Locators are role / label / data-testid based.
import type { Locator, Page } from '@playwright/test';

abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;
  async goto() { await this.page.goto(this.path); }
  nav(name: string): Locator { return this.page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name }); }
}

export class RecipeLibraryPage extends BasePage {
  readonly path = '/recipes';
  readonly links = () => this.page.getByRole('list', { name: 'Recipes', exact: true }).getByRole('link');
  /** A recipe card is the link to its detail page, named after the recipe. */
  readonly card = (title: string) => this.links().filter({ hasText: title });
}

/** /recipes/import: upload page photos, extract, then review inline on the same route. */
export class RecipeImportPage extends BasePage {
  readonly path = '/recipes/import';
  readonly fileInput = () => this.page.getByTestId('photo-input');
  readonly hint = () => this.page.getByLabel('Recipe name (optional)');
  readonly extract = () => this.page.getByRole('button', { name: 'Extract recipe' });
}

export class RecipeReviewPage {
  constructor(private readonly page: Page) {}
  readonly heading = () => this.page.getByRole('heading', { name: 'Review recipe' });
  readonly title = () => this.page.getByLabel('Title', { exact: true });
  readonly servings = () => this.page.getByLabel('Servings', { exact: true });
  readonly ingredientRows = () => this.page.getByTestId('ingredient-row');
  readonly ingredientRow = (n: number) => this.ingredientRows().nth(n);
  readonly save = () => this.page.getByRole('button', { name: 'Save recipe' });
}

export class MealPlanPage extends BasePage {
  readonly path = '/plan';
  readonly slot = (isoDate: string, meal: string) => this.page.getByTestId(`slot-${isoDate}-${meal}`);
  readonly addToSlot = (isoDate: string, meal: string) => this.slot(isoDate, meal).getByRole('button', { name: /add/i });
  readonly approve = () => this.page.getByRole('button', { name: /approve plan/i });
  readonly generateList = () => this.page.getByRole('button', { name: /generate shopping list/i });
  /** Pick a recipe in the open "add a meal" sheet. */
  async pick(title: string) {
    const sheet = this.page.getByRole('dialog');
    await sheet.getByRole('searchbox').fill(title);
    await sheet.getByRole('button', { name: `Select ${title}` }).click();
  }
}

export class ShoppingListPage extends BasePage {
  readonly path = '/shopping';
  readonly root = () => this.page.getByTestId('shopping-root');
  /** The active-list row for an ingredient (purchased items live in the "Purchased" section instead). */
  readonly item = (name: string) => this.page.locator(`[data-testid^="item-"][data-item-name="${name}"]`);
  readonly tick = (name: string) => this.page.getByRole('checkbox', { name: new RegExp(`^${name}`) });
  readonly basketTotal = () => this.page.getByTestId('basket-total');
  readonly progress = () => this.page.getByTestId('progress');
  readonly syncIndicator = () => this.page.getByTestId('sync-status');
  /** Purchase history (the "Purchased" section: one append-only row per PurchaseEvent). */
  readonly purchase = (name: string) => this.page.getByTestId('purchase-row').filter({ hasText: name });
  async gotoHydrated() {
    await this.goto();
    await this.root().waitFor();
    await this.page.waitForFunction(() => document.querySelector('[data-testid="shopping-root"]')?.getAttribute('data-hydrated') === 'true');
  }
}

export class ReceiptPage extends BasePage {
  readonly path = '/receipts';
  readonly fileInput = () => this.page.getByLabel('Receipt photo');
  readonly scan = () => this.page.getByRole('button', { name: 'Scan receipt' });
  readonly line = (raw: string) => this.page.getByTestId('receipt-line').filter({ hasText: raw });
  readonly matchSelect = (raw: string) => this.page.getByLabel(`Match for ${raw}`);
  readonly confirmBox = (raw: string) => this.page.getByLabel(`Confirm ${raw} as bought`);
}

export class HouseholdPage extends BasePage {
  readonly path = '/household';
}
