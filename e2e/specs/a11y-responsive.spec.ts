// Accessibility (axe-core) + responsive checks across key routes at 375 / 768 / 1280.
// Un-fixme once routes exist and a signed-in storageState fixture is wired (see playwright.config note in ACCEPTANCE.md).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

export const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

export const ROUTES = ['/', '/sign-in', '/household', '/recipes', '/recipes/new/import', '/plan', '/shopping', '/receipts/new', '/pantry'] as const;

for (const vp of VIEWPORTS) {
  test.describe(`a11y + layout @ ${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test.fixme(`${route}: no serious/critical axe violations`, async ({ page }) => {
        await page.goto(route);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad, JSON.stringify(bad.map((v) => v.id))).toEqual([]);
      });

      test.fixme(`${route}: no horizontal scroll, tap targets >= 44px on mobile`, async ({ page }) => {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
        if (vp.width <= 375) {
          const small = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('button, a, input, [role=checkbox]')]
              .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).length);
          expect(small).toBe(0);
        }
      });
    }

    test.fixme('navigation: bottom bar on mobile, side/top nav on desktop', async ({ page }) => {
      await page.goto('/');
      const bottom = page.getByTestId('bottom-nav');
      if (vp.width < 768) await expect(bottom).toBeVisible(); else await expect(bottom).toBeHidden();
    });

    test.fixme('keyboard: full journey of shopping list reachable by Tab, visible focus ring', async () => {});
  });
}
