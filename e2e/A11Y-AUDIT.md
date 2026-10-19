# A11Y + responsive audit (PRJ-018 lane A1)

Scope: every route and review/proposal state (home, recipes list/detail/new/edit/import + review, plan + prompt proposal, shopping, receipts + review, pantry, pantry scan + review, household (+new), settings, privacy, sign-in/up, forgot/reset password, invite) at 375 / 1280 px, light and dark (`prefers-color-scheme`), mock mode. Tool: `@axe-core/playwright` (wcag2a, wcag2aa, wcag21aa) plus scripted checks. Regression guard: `e2e/specs/a11y-audit.spec.ts` (102 tests: 96 route x width x theme, keyboard focus order on 5 routes, reduced motion). 768 px was covered by manual layout inspection only (the spec runs 375 and 1280; the shell switches at 900 px).

## Findings

| # | Route(s) | Issue | Severity | Fix | Status |
|---|---|---|---|---|---|
| 1 | sign-in, sign-up, forgot-password, reset-password, invite (dark) | Auth pages rendered outside `.fr-root`: white page, default blue links, muted hint text on white in dark mode. axe color-contrast 2.18-2.38:1 | serious | Shell wraps auth routes in `fr-root fr-auth` (themed bg/text); plain links get accent colour via `.fr-root a:not([class])` in `@fr/ui` base.css | fixed |
| 2 | sign-in, sign-up, forgot, reset (375) | Horizontal overflow (scrollWidth 401 > 375): unbreakable env-var names in the mock-auth banner inside a fixed-width card | serious | `.fr-auth__card` (width 100%, max 420, `overflow-wrap:anywhere`), replaces inline style | fixed |
| 3 | auth pages | `<main>` had no id / no themed container; no skip target consistency | minor | `id="main"` on AuthCard | fixed |
| 4 | home, pantry, settings, invite, recipe detail, plan (375) | Standalone text links and `<summary>` toggles 18-25 px high (< 44 px target) | moderate | `@fr/ui` base.css mobile (<900px) rule: block padding on plain links and summaries inside `main` | fixed |
| 5 | recipes (375) | Filter/tag chips 36 px high | moderate | `.chip` min-height `var(--fr-target)` | fixed |
| 6 | shopping (375) | "From plan" popover trigger 28 px high | moderate | `.popoverTrigger` min-height `var(--fr-target)` | fixed |
| 7 | receipts (375) | "View/Review" link 37x25 px | moderate | styled as `fr-btn fr-btn--ghost fr-btn--sm` (44 px) | fixed |

## Checked, no change needed

- axe: zero serious/critical on every app route and state at both widths and themes once 1 is fixed (app shell tokens already meet 4.5:1 in both themes).
- Focus: `.fr-root :focus-visible` 3 px outline in both themes; skip link first on app routes; every Tab stop on `/ /recipes /shopping /settings /sign-in` has a visible indicator.
- Forms: `Input/Textarea/Select` link label via `htmlFor`, hint/error via `aria-describedby`, errors `role="alert"`, `aria-invalid`.
- Async states announced: "Reading your recipe..." and "Scanning..." are `role="status"`, plan status `aria-live="polite"`, receipt/household/settings errors `role="alert"`.
- Images: recipe cover `alt=recipe title`; upload previews have "Preview of page N"/"Photo N to scan"; placeholder icon has `aria-label`.
- Reduced motion: `prefers-reduced-motion` rule collapses animations/transitions (asserted).
- Heading hierarchy: no serious/critical axe findings; moderate rules (`heading-order`, `page-has-heading-one`) are not asserted by the spec and were not individually reviewed.

## Remaining / low priority (not fixed)

| Item | Severity | Note |
|---|---|---|
| Toast region has no explicit `aria-live`; each toast carries `role=status/alert` | minor | Works in current screen readers; add `aria-live="polite"` on the region if testing shows missed announcements |
| Field `aria-describedby` references only the hint OR the error (hint hidden while error shows) | minor | Intentional; no loss of information |
| 768 px not machine-asserted | minor | Layout is the 375 (bottom nav) or 900+ (sidebar) variant; no overflow seen manually |
| Dev-only Next overlay is skipped in the focus test | info | not shipped |
