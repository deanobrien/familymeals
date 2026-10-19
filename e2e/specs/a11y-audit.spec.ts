// A1 accessibility + responsive audit (mock mode): every route (and the review / proposal states) at 375 and 1280
// in light and dark. Asserts zero serious/critical axe violations (WCAG 2.1 AA), no horizontal overflow at 375
// and that every interactive control on mobile is a >= 44px touch target. Findings: e2e/A11Y-AUDIT.md.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import sharp from 'sharp';
import { FIXTURES_DIR } from '../support/helpers.js';

const SEED_RECIPE = '00000000-0000-4000-8000-000000000001';
const recipeImg = (f: string) => join(FIXTURES_DIR, 'recipes', f);
const receiptImg = join(FIXTURES_DIR, 'receipts', 'r1-weekly-shop.png');

interface State {
  name: string;
  path: string;
  /** Drives the page into the state to audit (review step, proposal...). Runs after goto. */
  prepare?: (page: Page) => Promise<void>;
  /** Seed before navigation (e.g. approved plan). Returns the path to visit. */
  seed?: (page: Page) => Promise<string>;
}

export const STATES: State[] = [
  { name: 'home', path: '/' },
  { name: 'recipes', path: '/recipes' },
  { name: 'recipe detail', path: `/recipes/${SEED_RECIPE}` },
  { name: 'recipe new', path: '/recipes/new' },
  { name: 'recipe edit', path: `/recipes/${SEED_RECIPE}/edit` },
  { name: 'recipe import', path: '/recipes/import' },
  {
    name: 'recipe import review',
    path: '/recipes/import',
    prepare: async (page) => {
      await page.getByTestId('photo-input').setInputFiles([recipeImg('03-beef-stew-two-page-p1.png')]);
      await page.getByRole('button', { name: 'Extract recipe' }).click();
      await page.getByRole('heading', { name: 'Review recipe' }).waitFor({ timeout: 60_000 });
    },
  },
  { name: 'plan', path: '/plan?week=2026-11-09' },
  {
    name: 'plan proposal',
    path: '/plan?week=2026-11-09',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Propose a plan' }).click();
      await page.getByTestId('proposal').waitFor({ timeout: 60_000 });
    },
  },
  {
    name: 'shopping',
    path: '/shopping',
    seed: async (page) => {
      const res = await page.context().request.post('/api/dev/seed', { data: { kind: 'approved-plan' } });
      const { planId } = (await res.json()) as { planId: string };
      return `/shopping?plan=${planId}`;
    },
  },
  { name: 'receipts', path: '/receipts' },
  {
    name: 'receipt review',
    path: '/receipts',
    seed: async (page) => {
      await page.context().request.post('/api/dev/seed', { data: { kind: 'shopping-item', name: 'Red lentils', value: 500, unit: 'g' } });
      return '/receipts';
    },
    prepare: async (page) => {
      await page.getByLabel('Receipt photo').setInputFiles(receiptImg);
      await page.getByRole('button', { name: 'Scan receipt' }).click();
      await page.waitForURL(/\/receipts\/[^/]+\/review$/, { timeout: 60_000 });
      await page.getByTestId('receipt-line').first().waitFor();
    },
  },
  { name: 'pantry', path: '/pantry' },
  { name: 'pantry scan', path: '/pantry/scan' },
  {
    name: 'pantry scan review',
    path: '/pantry/scan',
    prepare: async (page) => {
      await page.getByTestId('photo-input').setInputFiles([{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 480, height: 360, channels: 3, background: '#88aa44' } }).jpeg().toBuffer() }]);
      await page.getByRole('button', { name: /^Scan \d+ image/ }).click();
      await page.getByTestId('scan-row').first().waitFor({ timeout: 60_000 });
    },
  },
  { name: 'household', path: '/household' },
  { name: 'household new', path: '/household/new' },
  { name: 'settings', path: '/settings' },
  { name: 'privacy', path: '/privacy' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'sign-up', path: '/sign-up' },
  { name: 'forgot-password', path: '/forgot-password' },
  { name: 'reset-password', path: '/reset-password' },
  { name: 'invite', path: '/invite/not-a-real-token' },
];

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '1280', width: 1280, height: 800 },
] as const;
const THEMES = ['light', 'dark'] as const;

async function open(page: Page, state: State) {
  const household = `e2e-a11y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await page.context().addCookies([{ name: 'fr_household', value: household, domain: 'localhost', path: '/' }]);
  const target = state.seed ? await state.seed(page) : state.path;
  await page.goto(target, { waitUntil: 'networkidle' });
  if (state.prepare) await state.prepare(page);
  // let async UI settle (toasts, transitions)
  await page.waitForTimeout(400);
}

test.describe('a11y audit: keyboard + motion', () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

  for (const path of ['/', '/recipes', '/shopping', '/settings', '/sign-in']) {
    test(`${path}: skip link first, every Tab stop has a visible focus indicator`, async ({ page }) => {
      await open(page, { name: path, path });
      const stops: string[] = [];
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body || el.tagName.toLowerCase().startsWith('nextjs')) return null; // dev-only overlay
          const cs = getComputedStyle(el);
          const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
          return { tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30), visible };
        });
        if (info) {
          stops.push(`${info.tag} "${info.label}"`);
          expect(info.visible, `no visible focus on ${info.tag} "${info.label}"`).toBe(true);
        }
      }
      expect(stops.length, 'keyboard focus should reach interactive controls').toBeGreaterThan(3);
      if (path !== '/sign-in') expect(stops[0]).toContain('Skip to content');
    });
  }

  test('reduced motion disables animations', async ({ page }) => {
    await open(page, { name: 'home', path: '/' });
    const ok = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'fr-skeleton';
      document.querySelector('.fr-root')?.appendChild(probe);
      const d = parseFloat(getComputedStyle(probe).animationDuration);
      probe.remove();
      return d < 0.01;
    });
    expect(ok).toBe(true);
  });
});

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`a11y audit ${vp.name}px ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, reducedMotion: 'reduce' });

      for (const state of STATES) {
        test(`${state.name}: axe WCAG 2.1 AA, no overflow${vp.width <= 375 ? ', 44px targets' : ''}`, async ({ page }) => {
          await open(page, state);

          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(
            bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ''}`) })),
          ).toEqual([]);

          if (vp.width <= 375) {
            const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
            expect(overflow.sw, `scrollWidth ${overflow.sw} > clientWidth ${overflow.cw}`).toBeLessThanOrEqual(overflow.cw);

            const small = await page.evaluate(() => {
              const out: string[] = [];
              const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=checkbox], [role=tab], summary';
              for (const el of document.querySelectorAll<HTMLElement>(sel)) {
                const style = getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none') continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                // visually hidden (file inputs, skip link when unfocused) and appearance:none boxes wrapped by a labelled row
                if (el.classList.contains('fr-visually-hidden') || r.top < -50 || r.left < -50) continue;
                const label = el.closest('label');
                const box = label ? label.getBoundingClientRect() : r;
                // inline text links inside running copy are exempt (WCAG 2.5.8 inline exception)
                const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, span, small, td, dd');
                if (inline) continue;
                if (box.height < 44 - 0.5 || box.width < 44 - 0.5) {
                  out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
                }
              }
              return out;
            });
            expect(small, 'touch targets under 44px').toEqual([]);
          }
        });
      }
    });
  }
}
