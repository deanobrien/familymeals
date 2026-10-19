# PRJ-018 Manual Acceptance Script

Tester runs this on a **fresh environment** (empty DB, `AI_PROVIDER=mock` unless a step says otherwise). Record PASS/FAIL + notes per row. A gate passes only when every row is PASS and the automated suite (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm e2e` for implemented journeys) is green. Do not claim a pass for anything not actually executed.

Fixtures: `fixtures/recipes/*.png`, `fixtures/receipts/*.png`, `fixtures/households/*.json` (regenerate: `npm run generate`). Test accounts use `@fr-test.test`; password is the throwaway in `src/households-data.ts`.

## G0 - Foundation (Brief M0 + schema + engine core)
| # | Step | Expected |
|---|---|---|
| 0.1 | Clone, `pnpm install`, copy `.env.example` | Installs with no errors; no secrets committed |
| 0.2 | `pnpm dev`, open `/` | App loads, no console errors, responsive shell renders at 375/768/1280 |
| 0.3 | `pnpm typecheck`, `lint`, `test`, `build` | All exit 0 |
| 0.4 | Apply migrations to a clean DB | Success; every table has RLS enabled (query `pg_tables.rowsecurity`) |
| 0.5 | RLS suite (`tests/rls`) with households A/B seeds | B can read/write none of A's rows; anon reads nothing |
| 0.6 | Storage buckets | All private; unauthenticated object URL returns 401/403 |
| 0.7 | Engine unit tests | Units, scaling, aggregation (incl. density gate, approx/unparsed) green |
| 0.8 | Mock AI guard | With `NODE_ENV=production`, mock provider refuses to start |
| 0.9 | Playwright installs and runs the (fixme) skeleton | `playwright test --list` lists specs; no parse errors |

## G1 - Accounts, recipes, extraction, cost/nutrition basics (Brief M1+M2+M3)
| # | Step | Expected |
|---|---|---|
| 1.1 | Sign up with new email/password | Lands signed-in; weak password rejected with clear message |
| 1.2 | Sign out, sign in, run password recovery | Each works; recovery link single-use |
| 1.3 | Create household "QA Household" | Owner role; household page shows member list |
| 1.4 | Unauthenticated visit to `/recipes` | Redirects to sign-in |
| 1.5 | Add recipe manually | Saves; appears in grid and list views; image stored privately |
| 1.6 | Import `01-tomato-pasta.png` | Review screen prefilled to match `01-tomato-pasta.expected.json` (title, 4 servings, 7 lines, basil optional) |
| 1.7 | Import `02-lemon-loaf.png` | oz/floz lines show canonical g/ml with original text ("8 oz") preserved |
| 1.8 | Import both pages of `03-beef-stew-two-page` | One merged recipe, 10 ingredients, steps from page 2 |
| 1.9 | Import `04-fractions-ranges.png` | Fractions parsed (1.5 cup, 0.75 cup); "2-3 cloves" is a range; "a pinch"/"a dash"/"a handful" approximate with NO weight; "to taste" has no value |
| 1.10 | Import `05-blurry-curry.png` | Low-confidence warning shown; cannot be saved without the user reviewing every field |
| 1.11 | Import `08-chickpea-stew.png` | "whatever greens..." kept as unparsed line; ground vs fresh coriander are separate ingredients |
| 1.12 | Edit a saved recipe | New RecipeVersion created; previous version viewable; source image still linked |
| 1.13 | Search / filter by tag, diet (use 06 fish, 08 vegan) / favourites | Correct results; diet filter honours meat/fish/vegetarian/vegan |
| 1.14 | Add same recipe twice | Duplicate warning shown, user can proceed |
| 1.15 | Recipe detail cost + nutrition panels | Values labelled "estimate"; unknown nutrients show "unknown", not 0; pence rendered with correct rounding |
| 1.16 | Force AI failure (mock error) | Recoverable error + manual entry fallback; no half-saved recipe |
| 1.17 | Upload a 25 MB file and a .exe | Both rejected with clear message |

## G2 - Planning, shopping, cost, nutrition (Brief M4+M5+M6) - MVP-ready internally
| # | Step | Expected |
|---|---|---|
| 2.1 | Seed household A; open `/plan` | Week 2026-10-19 shows 3 dinners |
| 2.2 | Add, swap, move, duplicate a meal; change servings; mark eating out / leftovers | Persists on reload |
| 2.3 | Reuse previous week | Copies meals; none duplicated |
| 2.4 | Prompt planning: "vegetarian dinners Mon-Thu under 3 pounds a head" | Constraints shown for review; solver output obeys hard constraints; unmet constraints explained, not silently dropped |
| 2.5 | Approve plan, generate shopping list | Same ingredient across recipes merged; incompatible units listed under unresolved, not guessed; tap an item to see provenance (which recipes) |
| 2.6 | Add manual item (e.g. bin bags) | Appears under its aisle; survives list regeneration |
| 2.7 | Tick an item, then partially purchase another (buy 1 of 2 kg) | Tick = PurchaseEvent; partial leaves remainder required |
| 2.8 | Untick / void purchase | Remainder restored; event voided, not deleted (append-only) |
| 2.9 | Costs | Consumption cost vs basket (pack-size) cost both shown; price kind shown (user_confirmed > receipt > retailer_verified > generic_estimate); estimates labelled |
| 2.10 | Override a price | Priority rules apply; history retains old value |
| 2.11 | Weekly nutrition summary | Per-serving and total; `unknown` ingredients flagged, totals marked incomplete |
| 2.12 | Money audit | No floats anywhere: all prices integer pence in DB/API; display rounding only |

## G3 - Sharing, realtime, receipts (Brief M7+M8) - first-release scope
| # | Step | Expected |
|---|---|---|
| 3.1 | Owner creates invite | Link single-use, expires, stored hashed (inspect DB: no plaintext token) |
| 3.2 | Second browser (private window) signs up and accepts invite | Joins as member; sees plan/list/recipes |
| 3.3 | Revoke an unused invite; use an expired one | Both refused with clear message |
| 3.4 | Tick item in session 1 | Appears in session 2 within ~5 s with no reload |
| 3.5 | Session 2 offline: tick two items, reconnect | Both applied exactly once; no duplicate PurchaseEvent; list resyncs |
| 3.6 | Both sessions tick the same item simultaneously | One purchase or a clean merge; never lost or doubled |
| 3.7 | Household B (seed) tries A's URLs/ids/API | 404/403; no realtime events cross households |
| 3.8 | Remove a member | Their session loses access immediately |
| 3.9 | Upload `r1-weekly-shop.png` | Lines parsed to `r1-weekly-shop.expected.json` (pence integers, total 515); "SPAGH 500G" suggests spaghetti; `CARRIERBAG 5P` has NO suggestion |
| 3.10 | Nothing auto-confirms | Every match requires explicit user confirmation |
| 3.11 | Upload `r2-multibuy.png` | "MULTIBUY 3 FOR 2" (-90p) recognised as discount, not an item; net chickpeas cost 180p for 3 |
| 3.12 | Upload `r3-fish-promo.png` and `r4-baking.png` | Promo line attached/handled; abbreviations (SR FLR, UNSLT BTR) suggested with confidence; qty 2 butter records qty 2; non-food lines (WASHING UP LIQ, DISHWSHR TABS) unmatched, offered "ignore" |
| 3.13 | Confirm receipt | PurchaseEvents created with actual price; price history gains `receipt` observations; remaining requirements correct; extras offered to pantry |
| 3.14 | Re-upload the same receipt | Duplicate warning; no double purchases |
| 3.15 | Full journey (BRIEF s15 steps 1-11) via `pnpm e2e` | `journey.spec.ts` has no fixme remaining and is green |

## Accessibility and responsive checklist
Automated: `a11y-responsive.spec.ts` (axe-core via `@axe-core/playwright`, tags wcag2a/wcag2aa/wcag21aa; fail on serious/critical). Run at **375, 768, 1280** px on every route: `/`, `/sign-in`, `/household`, `/recipes`, `/recipes/import`, `/plan`, `/shopping`, `/receipts`, `/pantry`.

Manual (per viewport):
- [ ] No horizontal page scroll; no clipped or overlapping text/controls
- [ ] Mobile (375): bottom nav shown, primary actions reachable one-handed; tap targets >= 44 px
- [ ] Tablet (768) and desktop (1280): bottom nav below 900px, side nav from 900px (D163: kept at 900; 768-899 keeps the bottom bar and the 4-column plan grid, a 240px sidebar would cramp it); content width sensible; 7-day plan grid readable
- [ ] Keyboard only: every flow (sign-in, add recipe, plan, tick items, confirm receipt) completes; logical tab order; visible focus ring; no keyboard traps; dialogs trap and restore focus; Esc closes
- [ ] Screen reader spot check (NVDA or VoiceOver): landmarks, headings in order, form fields labelled, ticking an item announces state, sync/error toasts use live regions
- [ ] Colour contrast >= 4.5:1 text, 3:1 UI; information never colour-only (estimate/unknown/low-confidence flags have text)
- [ ] 200% browser zoom and text-only enlargement: no loss of content
- [ ] `prefers-reduced-motion` respected; dark mode (if shipped) passes contrast
- [ ] Every empty, loading and error state exists and is announced (recipes empty, list empty, AI failure, offline, 404, forbidden)
- [ ] Form errors identify the field and how to fix; no data lost on validation failure
- [ ] Images (recipe sources, receipts) have text alternatives or are marked decorative

## Wiring notes for the integrator
- (Merged 2026-10-19) specs in `e2e/specs`, helpers/page objects in `e2e/support`, fixtures in `e2e/fixtures`, fixture generator + zod contract in `e2e/fixtures-src`; `pnpm --filter @fr/e2e test` validates fixtures (vitest).
- Playwright config should define a `mobile`/`tablet`/`desktop` project trio only for the a11y spec; the journey runs on desktop Chromium, with a second `BrowserContext` via `secondSession(browser)`.
- Helpers `signUp`, `createHousehold`, `acceptInvite`, `useMockAi` throw "not implemented"; implement them in the lane that owns the UI (L11, L20, L4/L13).
- PROPOSED shapes to align: `ExtractedRecipe` (title, servings, ingredients[{name, quantity, preparation, optional}], steps) and `ReceiptFixture` lines (`kind`: item | multibuy_discount | promo_discount; negative pence for discounts). Confirm with L4/L13/L21 before wiring mock AI responses.
