// Page-object stubs. Locators are role/testid based; adjust names when feature lanes land.
import type { Locator, Page } from '@playwright/test';

abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;
  async goto() { await this.page.goto(this.path); }
  nav(name: string): Locator { return this.page.getByRole('navigation').getByRole('link', { name }); }
}

export class RecipeLibraryPage extends BasePage {
  readonly path = '/recipes';
  readonly addRecipe = () => this.page.getByRole('link', { name: /add recipe/i });
  readonly card = (title: string) => this.page.getByTestId('recipe-card').filter({ hasText: title });
  readonly search = () => this.page.getByRole('searchbox');
}

export class RecipeImportPage extends BasePage {
  readonly path = '/recipes/new/import';
  readonly fileInput = () => this.page.locator('input[type=file]');
  readonly extract = () => this.page.getByRole('button', { name: /extract/i });
  readonly lowConfidenceBanner = () => this.page.getByTestId('low-confidence-warning');
}

export class RecipeReviewPage extends BasePage {
  readonly path = '/recipes/new/review';
  readonly title = () => this.page.getByLabel(/title/i);
  readonly servings = () => this.page.getByLabel(/servings/i);
  readonly ingredientRow = (n: number) => this.page.getByTestId('ingredient-row').nth(n);
  readonly save = () => this.page.getByRole('button', { name: /save recipe/i });
}

export class MealPlanPage extends BasePage {
  readonly path = '/plan';
  readonly slot = (isoDate: string, meal: string) => this.page.getByTestId(`slot-${isoDate}-${meal}`);
  readonly addToSlot = (isoDate: string, meal: string) => this.slot(isoDate, meal).getByRole('button', { name: /add/i });
  readonly approve = () => this.page.getByRole('button', { name: /approve plan/i });
  readonly generateList = () => this.page.getByRole('button', { name: /generate shopping list/i });
}

export class ShoppingListPage extends BasePage {
  readonly path = '/shopping';
  readonly item = (name: string) => this.page.getByTestId('shopping-item').filter({ hasText: name });
  readonly tick = (name: string) => this.item(name).getByRole('checkbox');
  readonly estimatedTotal = () => this.page.getByTestId('estimated-total');
  readonly estimateLabel = () => this.page.getByText(/estimate/i).first();
  readonly syncIndicator = () => this.page.getByTestId('sync-status');
}

export class ReceiptPage extends BasePage {
  readonly path = '/receipts/new';
  readonly fileInput = () => this.page.locator('input[type=file]');
  readonly parse = () => this.page.getByRole('button', { name: /read receipt/i });
  readonly line = (raw: string) => this.page.getByTestId('receipt-line').filter({ hasText: raw });
  readonly matchSuggestion = (raw: string) => this.line(raw).getByTestId('match-suggestion');
  readonly confirmMatch = (raw: string) => this.line(raw).getByRole('button', { name: /confirm/i });
  readonly confirmAll = () => this.page.getByRole('button', { name: /confirm receipt/i });
}

export class PurchaseHistoryPage extends BasePage {
  readonly path = '/shopping/history';
  readonly entry = (name: string) => this.page.getByTestId('purchase-entry').filter({ hasText: name });
}

export class HouseholdPage extends BasePage {
  readonly path = '/household';
  readonly invite = () => this.page.getByRole('button', { name: /invite/i });
  readonly memberRow = (name: string) => this.page.getByTestId('member-row').filter({ hasText: name });
}
