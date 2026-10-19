// Accessibility (axe-core) + responsive checks across key routes at 375 / 768 / 1280, in mock-auth mode (every
// route is open as the demo user, in an isolated sandbox household so the shopping page has a generated list).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SEED, enterHousehold, newHouseholdId, seedApprovedPlan } from '../support/helpers.js';

export const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

export const ROUTES = ['/', '/sign-in', '/household', '/recipes', '/recipes/import', '/plan', '/shopping', '/receipts', '/pantry'] as const;

/** Rules the app currently violates; each is reported as a bug in the lane report, not hidden. Empty = none known. */
const KNOWN_AXE: Record<string, string[]> = {};
/** Known app bugs, asserted with test.fail() so the suite turns red when they are fixed (then remove the entry). */
const KNOWN_OVERFLOW: string[] = [];

/** Interactive controls under 44px in either dimension (custom checkboxes count by their label). */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a:not([href="#main"]), input:not([type=file]), select, [role=checkbox]')]
      .map((e) => {
        // custom checkboxes hide the native input; the tappable area is its label
        const t = e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio') ? (e.closest('label') ?? e) : e;
        return { e, r: t.getBoundingClientRect() };
      })
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44))
      .map(({ e }) => `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)}`));
}

for (const vp of VIEWPORTS) {
  test.describe(`a11y + layout @ ${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      await enterHousehold(context, newHouseholdId('a11y'));
    });

    for (const route of ROUTES) {
      test(`${route}: no serious/critical axe violations`, async ({ page, context }) => {
        if (route === '/shopping') {
          const planId = await seedApprovedPlan(context, [{ recipeId: SEED.pasta, servings: 4 }]);
          await page.goto(`/shopping?plan=${planId}`);
          await expect(page.getByRole('checkbox', { name: /^Onion/ })).toBeVisible({ timeout: 60_000 });
        } else {
          await page.goto(route);
        }
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const known = KNOWN_AXE[route] ?? [];
        const bad = results.violations.filter((v) => (v.impact === 'serious' || v.impact === 'critical') && !known.includes(v.id));
        expect(bad, JSON.stringify(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))).toEqual([]);
      });

      test(`${route}: no horizontal scroll`, async ({ page }) => {
        test.fail(vp.width <= 375 && KNOWN_OVERFLOW.includes(route), 'BUG: page scrolls horizontally at 375px (see lane report)');
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
      });

      if (vp.width <= 375) {
        test(`${route}: tap targets >= 44px on mobile`, async ({ page }) => {
          await page.goto(route);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          const small = await smallTargets(page);
          expect(small, small.join(' | ')).toEqual([]);
        });
      }
    }

    if (vp.width <= 375) {
      test('/ with To do tasks (demo household A): tap targets >= 44px on mobile', async ({ context, page }) => {
        await context.clearCookies(); // back to the seeded demo household, whose dashboard has task links
        await page.goto('/');
        await expect(page.getByRole('link', { name: /^Plan dinners for/ })).toBeVisible();
        const small = await smallTargets(page);
        expect(small, small.join(' | ')).toEqual([]);
      });
    }

    test('navigation: bottom bar below 900px, side nav from 900px', async ({ page }) => {
      await page.goto('/');
      const bottom = page.getByRole('navigation', { name: 'Main (mobile)' });
      const side = page.getByRole('navigation', { name: 'Main', exact: true });
      if (vp.width < 900) { await expect(bottom).toBeVisible(); await expect(side).toBeHidden(); }
      else { await expect(bottom).toBeHidden(); await expect(side).toBeVisible(); }
    });

    test('keyboard: the shopping list is reachable by Tab, ticking with Space, visible focus', async ({ page, context }) => {
      const planId = await seedApprovedPlan(context, [{ recipeId: SEED.pasta, servings: 4 }]);
      await page.goto(`/shopping?plan=${planId}`);
      const onion = page.getByRole('checkbox', { name: /^Onion/ });
      await expect(onion).toBeVisible({ timeout: 60_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="shopping-root"]')?.getAttribute('data-hydrated') === 'true');
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        if (await onion.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(onion).toBeFocused();
      const outline = await onion.evaluate((el) => {
        const own = getComputedStyle(el);
        const near = getComputedStyle((el.closest('label') ?? el.parentElement) as Element);
        return [own.outlineStyle, near.outlineStyle, own.boxShadow, near.boxShadow].join('|');
      });
      expect(outline).not.toMatch(/^none\|none\|none\|none$/);
      await page.keyboard.press('Space');
      await expect(page.getByRole('checkbox', { name: /^Onion/ })).toHaveCount(0); // bought, moved to Purchased
      await expect(page.getByTestId('purchase-row').filter({ hasText: 'Onion' })).toHaveCount(1);
    });
  });
}
