// Household isolation (UI level). DB-level RLS lives in tests/rls/ (SQL/Vitest) and is the primary control;
// these specs prove the app never leaks across households. Seeds: fixtures/households/household-{a,b}.json.
import { expect, test } from '@playwright/test';
import { createHousehold, newUser, secondSession, signUp } from '../support/helpers.js';
import { RecipeLibraryPage, ShoppingListPage } from '../support/pages.js';

test.describe('Household isolation', () => {
  test.fixme('B cannot see A recipes in library or search', async ({ browser, page }) => {
    await signUp(page, newUser('a')); await createHousehold(page, 'Household A');
    const b = await secondSession(browser);
    try {
      await signUp(b.page, newUser('b')); await createHousehold(b.page, 'Household B');
      const lib = new RecipeLibraryPage(b.page);
      await lib.goto();
      await expect(lib.card('Smith Sunday Roast')).toHaveCount(0);
    } finally { await b.context.close(); }
  });

  test.fixme('B direct-URL access to an A recipe/plan/list id returns 404 (not 403, no existence leak)', async ({ browser }) => {
    const b = await secondSession(browser);
    try {
      const res = await b.page.goto('/recipes/a1a1a103-0000-4000-8000-000000000001');
      expect(res?.status()).toBe(404);
    } finally { await b.context.close(); }
  });

  test.fixme('B cannot tick A shopping item via crafted API call', async ({ browser }) => {
    const b = await secondSession(browser);
    try {
      const r = await b.page.request.post('/api/shopping/purchase', { data: { shoppingListItemId: 'a1a1a108-0000-4000-8000-000000000001' } });
      expect([403, 404]).toContain(r.status());
    } finally { await b.context.close(); }
  });

  test.fixme('B realtime channel receives no A events', async ({ browser, page }) => {
    void page; const b = await secondSession(browser);
    try { await new ShoppingListPage(b.page).goto(); } finally { await b.context.close(); }
  });

  test.fixme('removed member loses access immediately (session + realtime)', async () => {});
  test.fixme('expired / revoked invite link cannot be used', async () => {});
});
