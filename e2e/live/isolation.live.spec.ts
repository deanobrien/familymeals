// Live Supabase, UI level: the app never leaks across households (was test.fixme in specs/isolation.spec.ts).
import { expect, test } from '@playwright/test';
import { userWithHousehold } from './support/live.js';

test('B cannot see A recipes in the library or search, and a direct URL to A recipe is not found', async ({ browser }) => {
  const a = await userWithHousehold(browser, 'iso-a', 'Iso A');
  const b = await userWithHousehold(browser, 'iso-b', 'Iso B');
  try {
    await a.page.goto('/recipes/new');
    await a.page.getByRole('textbox', { name: 'Title', exact: true }).fill('Smith Sunday Roast');
    await a.page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('beef');
    await a.page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('1');
    await a.page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Roast.');
    await a.page.getByRole('button', { name: 'Create recipe' }).click();
    await expect(a.page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
    const url = new URL(a.page.url()).pathname;

    await b.page.goto('/recipes?q=roast');
    await expect(b.page.getByRole('heading', { name: /No recipes/ })).toBeVisible();
    await b.page.goto('/recipes');
    await expect(b.page.getByText('Smith Sunday Roast')).toHaveCount(0);

    // Same response as an id that does not exist at all (no existence oracle). The HTTP status is 200 for both because
    // app/recipes/loading.tsx streams the page before notFound() runs (Next.js behaviour, D148).
    const foreign = await b.page.goto(url);
    await expect(b.page.getByRole('heading', { name: 'Recipe not found' })).toBeVisible();
    await expect(b.page.getByText('Smith Sunday Roast')).toHaveCount(0);
    const missing = await b.page.goto('/recipes/00000000-0000-4000-8000-00000000dead');
    await expect(b.page.getByRole('heading', { name: 'Recipe not found' })).toBeVisible();
    expect(foreign?.status()).toBe(missing?.status());

    // A planned week and pantry stay private too.
    await b.page.goto('/pantry');
    await expect(b.page.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
    await expect(b.page.getByText('beef')).toHaveCount(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
