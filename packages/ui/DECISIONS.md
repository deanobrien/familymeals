# @fr/ui decisions (lane L2a)

1. **Plain CSS + CSS variables, not Tailwind.** Zero build coupling for the monorepo; works with Next.js App Router via `import '@fr/ui/styles.css'` in the root layout. Tailwind v4 can still consume the tokens (`--fr-*`) in `@theme` if L2 prefers. Classes are `fr-` prefixed to avoid collisions.
2. **Tokens** in `src/styles/tokens.css`: warm neutrals, one terracotta accent, light + dark (`prefers-color-scheme`, overridable by `data-theme="light|dark"` on `<html>`). Text/accent pairs chosen for WCAG AA.
3. **Fonts:** serif display + sans body are read from `--font-display` / `--font-body`. In Next: `Fraunces({ variable: '--font-display' })` and `Inter({ variable: '--font-body' })` from `next/font/google`, add both `.variable` classes to `<html>`. Fallback stacks included.
4. **Radix only where it earns its keep:** Dialog (also Sheet) and Tabs. Select is the native `<select>` (best mobile UX, free a11y); Checkbox is a styled native input; Toast is a small own provider (`aria-live` region).
5. **Accessibility:** 44px minimum targets (`--fr-target`), 3px focus ring, `prefers-reduced-motion` disables animation, errors use `role="alert"` + `aria-describedby`, IconButton requires a `label`, skip link and two distinctly labelled nav landmarks in AppShell. Every component has a jest-axe test. (jsdom cannot check colour contrast; verify visually in the demo.)
6. **Unknown is not zero:** `NutritionTable` shows a number only for `status: 'zero'` or `'known'` with a finite value; `unknown` shows "Unknown", `unavailable` shows "—", even if a stray `value: 0` is supplied. `CostBreakdown` and `RecipeCard` show "Unknown" / "Cost unknown" (never £0.00) and label estimates; the total is marked "partial" when lines lack prices.
7. **Presentational and framework-agnostic:** no data fetching or `next/*` imports. Routing is injected via `linkComponent` (pass `next/link`) on `AppShell` and `RecipeCard`. Money is integer pence, formatted by `formatPence` (GBP).
8. **Local types:** `ValueStatus`, `PriceKind` are structural copies of the seed contract; marked TODO(@fr/domain) in Domain.tsx - swap for imports when L1 merges.
9. React 19 `ref`-as-prop; React is a peer dependency.
10. **Integration:** put `<ToastProvider>` in the root layout; wrap pages in `<AppShell active="...">` (override `nav` hrefs if routes differ from `DEFAULT_NAV`).
