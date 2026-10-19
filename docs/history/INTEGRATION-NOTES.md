> **Historical (2026-10-19).** A reviewer pass over the first lane outputs before the first merge. The lane folders it names (`L1-schema`, `L3-engine-core`, ...) were the agents' staging folders on the owner's machine and are NOT in this repo; their content was merged into `packages/*`, `supabase/` and `apps/*` (see `DECISIONS.md` D8, D15, D20, D25 for how each finding was resolved). Do not treat the recommendations as current instructions.

# PRJ-018 Integration Notes (reviewer pass, 2026-10-19)

Reviewed (complete): L4-ai, L6-qa, L7-cost, L8-nutrition, L10-receipt-match.
Skimmed only for cross-refs (package.json, contract diff, units API): L1-schema, L3-engine-core, L9-planner, L17a-shopping-state, L2a-ui, L5-refdata, L14-mobile. Findings about those are limited to the tables below and are not a full review.
Nothing was run (no install/test); all findings are from reading source.

## 1. Contract drift

`diff CONTRACT-SEED.ts src/contract.ts`:

| Lane | Result |
|---|---|
| L7-cost, L8-nutrition, L10-receipt-match, L3-engine-core, L9-planner, L17a-shopping-state | Identical to seed |
| L4-ai | No contract.ts. Re-declares Unit/Quantity/MealType/DietCategory as zod in `schemas.ts` ("mirrors seed"). Names/values match seed |
| L6-qa | Not a copy: a zod mirror (`src/contract.ts`) with stricter Quantity rules than L4 |

### Overlapping / divergent local types

| Overlap | Where | Divergence | Canonical home | Reconciliation |
|---|---|---|---|---|
| Quantity zod schema | L4 `QuantitySchema`, L6 `Quantity`, L1 (owner) | L4: values nonnegative, exact needs value, range min<=max. L6 adds: approximate needs `approxLabel` and must not carry `unit`; to_taste has no value/unit; no nonneg check | `@fr/domain` (L1) | Adopt the union of rules (L6 semantic rules + L4 nonneg) as the one `QuantitySchema`. L4/L6 import it; delete both copies. Confirm L3 parser never emits approximate+unit |
| Unit / MealType / DietCategory enums | L4, L6 | Same values as seed | `@fr/domain` | Import; derive types via `z.infer`; add a test asserting enum values equal seed unions |
| Recipe extraction output | L4 `RecipeExtractionSchema` vs L6 `ExtractedRecipe` | L4 ingredient has `originalText`, `confidence`; recipe adds description, prep/cookMinutes, tags, cuisine, warnings, per-field confidence; `servings` any positive number. L6 ingredient has neither originalText nor confidence (uses `quantity.originalText`); `servings` must be int | `@fr/domain` as `ExtractedRecipe` / `ExtractedIngredient` (L4 is the superset) | L4 schema canonical. L6 `ExtractedRecipe` becomes a fixture projection (z.pick / partial) or fixtures gain the missing fields. Decide servings: recommend positive number (ranges like "serves 4-6", halves) |
| Receipt parse (AI output) | L4 `ReceiptParse {retailer,date,lines{text,qty?,pricePence,confidence?},totalPence,warnings}` | No line `kind` | `@fr/domain` as `ReceiptParse` | Canonical for AI output. Add optional `kind: item|discount` (default item) so the model can flag discount lines |
| Receipt line (QA fixture) | L6 `ReceiptLine {id,rawText,kind: item/multibuy_discount/promo_discount,quantity:int,linePricePence (negative for discounts),expectedIngredient\|null,expectedPack?}` | Names differ from L4 (`rawText/linePricePence/quantity` vs `text/pricePence/qty`); discounts are negative separate lines | Stays QA-only (carries expected-* fields) | Keep L4 names; L6 comparator maps `rawText->text, linePricePence->pricePence, quantity->qty`; negative lines map to discount lines |
| Receipt line (engine) | L10 `ReceiptItemLine`, `ClassifiedLine`, `ParsedReceipt` | L10 consumes raw OCR text lines, not structured L4 output. Discounts are positive "saved" pence (`discountPence`, `amountPence`) vs L6 negative | `@fr/engine/receipt-match` | Add adapter from L4 `ReceiptParse` to L10 input (run normaliser over `text`, or build `ReceiptItemLine` directly). Document sign convention (engine positive saved, wire negative) |
| Plan constraints | L4 `PlanConstraintsSchema` vs L9 `schemas.ts` | Not diffed in detail (L9 only skimmed). L4 `excludeIngredients` are names; solver hard filter needs ids | `@fr/domain` (or `@fr/engine/planner`) | Integrator to diff before merge; one schema; add name->id resolution via refdata before the solver |
| UnitConverter | L7: `convert(q, to: Unit, ingredient?): Quantity\|null`. L8: `toGrams(ingredientId?, quantity): {grams, estimate, note?}\|null`. L10: none, own `toBase()` + `PINT_ML=568.261`. L3 real API: `convertQuantity(q,target,ingredient?,options): {ok:true..}\|{ok:false,reason}`, `conversionFactor`, `toBaseAmount`; pint = 568.26125 | Three incompatible shapes, plus pint constant mismatch | `@fr/engine/units` (L3) implements | Keep consumer-side interfaces but rename to avoid the clash (`QuantityConverter` for L7, `GramsConverter` for L8). Ship adapters in `@fr/engine/units`: `asQuantityConverter()` (ok ? value : null) and `asGramsConverter(lookup)` (estimate=true when via unitWeightG, density, or range). L10 `toBase` should call L3 `toBaseAmount`; delete `PINT_ML` |
| Pence | seed type; L7 `money.ts`, L10 | Same | `@fr/domain` | Import |
| PurchaseEvent | L10 re-exports from seed copy; L6 zod version | Same fields | `@fr/domain` | Single zod; L10 re-exports |
| Ingredient matching | L4 `IngredientMatchSchema {line,candidateId\|null,confidence}` vs L10 `Candidate`/`LineMatch` | Different roles | Keep both | L10 primary deterministic matcher; L4 only a fallback ranker for `uncertain`/`none`; L4 `candidateId` should be Uuid |
| Ingredient form | seed `form` includes `'other'`; L10 `Form` omits it | Minor | `@fr/domain` | Map `other` as unspecified in L10 |

## 2. Dependency versions

| Dep | Per lane | Proposal |
|---|---|---|
| zod | L1 ^4.0.0, L4 ^4.0.0 (installed 4.6.7), L6 ^4.6.7, L9 ^4.0.0, **L5 ^3.23.8** | zod ^4.6.7 workspace-wide. L5 must migrate to v4. (L4 uses `z.partialRecord`, v4-only) |
| vitest | L1 ^2.1.8, L2a/L3 2.1.9, L4/L5/L7/L8/L9/L10/L17a ^2.1.0, **L6 ^5.0.5**, L14 jest ~30.5 (jest-expo) | One vitest ^2.1.9 for packages (or move everything together); L6 aligns. L14 stays on jest-expo, excluded from vitest |
| typescript | L1 ^5.7.2, L2a/L3 5.6.3, most ^5.6.0, **L6 ^7.0.2**, **L14 ~6.0.3** | One version in root devDeps, ~5.7.x; check Expo 58 tolerates it. If mobile needs 6.0, move all to 6.0.x after confirming vitest/tsx |
| @types/node | most ^22, **L6 ^26.6.5** | ^22 (match Node 22 LTS) |
| sharp | L4 ^0.35.5 (dep), L6 ^0.35.5 (dev) | ^0.35.5; runtime dep of `@fr/ai` only; L6 dev-only for fixture generation |
| @anthropic-ai/sdk | L4 ^0.135.0 | Keep, server-only |
| tsx | L5 ^4.19, L6 ^4.23.15 | ^4.23.x |
| fast-check | L3 3.23.2, L9 ^3.23.0 | 3.23.x |
| react / react-dom | L2a 19.0.0 (peer ^19), L14 ^19.3.1 | Single react 19.x across ui/web/mobile; check against RN 0.88 requirement |
| Package manager | all pnpm, **L6 npm (`package-lock.json`)** | pnpm only; delete L6 lockfile |

L2a/L3 pin exact versions, others use carets: enforce via root `pnpm.overrides` or catalog. L6 also has `@playwright/test ^1.64.1`, `@axe-core/playwright ^4.14.0` (move to e2e in apps/web or root).

## 3. Package naming and merge mapping

| Lane | Current name | Destination | Final name / export | Notes |
|---|---|---|---|---|
| L1-schema | @fr/domain | `packages/domain` (+ migrations to `packages/db`) | `@fr/domain` | Owns canonical zod. src-only (no build). pglite tests may belong with db |
| L3-engine-core | @fr/engine | `packages/engine` | `@fr/engine` + `./units ./parse ./normalise ./scale ./aggregate` | `./contract` becomes a shim re-exporting `@fr/domain`, then removed |
| L7-cost | @fr/cost | `packages/engine/src/cost` | `@fr/engine/cost` | Uses `.js` import suffixes |
| L8-nutrition | @fr/nutrition | `packages/engine/src/nutrition` | `@fr/engine/nutrition` | Extensionless imports |
| L10-receipt-match | @fr/receipt-match | `packages/engine/src/receipt-match` | `@fr/engine/receipt-match` | Extensionless imports |
| L9-planner | @fr/engine-planner | `packages/engine/src/planner` | `@fr/engine/planner` | Has zod dep |
| L17a-shopping-state | @fr/engine-shopping | `packages/engine/src/shopping` | `@fr/engine/shopping` | |
| L4-ai | @fr/ai | `packages/ai` | `@fr/ai` | Server-only; guard against client bundling |
| L5-refdata | @fr/refdata | `packages/refdata` | `@fr/refdata` | xlsx 0.18.5, zod 3 -> 4; check `data/` size |
| L2a-ui | @fr/ui | `packages/ui` | `@fr/ui` (+ `./styles.css`, `./tokens.css`) | jsdom env per package |
| L14-mobile | @fr/mobile | `apps/mobile` | `@fr/mobile` | Expo 58 / RN 0.88; pnpm needs `node-linker=hoisted` or Metro monorepo config |
| L6-qa | @fr/qa | `packages/qa`, e2e specs to `apps/web/e2e` | `@fr/qa` | NodeNext vs Bundler; npm lock |

One `@fr/engine` package with one `exports` map and relative internal imports; no `@fr/cost` / `@fr/engine-*` imports should survive.

### tsconfig / ESM differences

| Setting | Variants | Proposal (root `tsconfig.base.json`) |
|---|---|---|
| module / resolution | ESNext+Bundler everywhere except L6 NodeNext; L14 expo base | ESNext + Bundler; L6 switches |
| Relative import suffix | L7 `.js`; L8, L10 extensionless | Extensionless (Next/Metro friendly); codemod L7 |
| `verbatimModuleSyntax` | L3 only | Adopt everywhere (fix `import type` in L7/L8/L10) |
| `isolatedModules` | L1, L2a, L3, L7, L17a yes; others no | On everywhere |
| `noImplicitOverride` | L1, L2a, L3 only | On |
| `types` | `[]` (L3, L7, L8, L17a) vs `["node"]` (L1, L4, L5, L6, L9) | Engine subpaths `[]` (pure); ai/refdata/db node |
| `lib` | ES2022; DOM only in L2a | ES2022 base; DOM only in ui/web |
| `"type": "module"` | all except L14 | Fine |

Purity gate: engine must not import `node:*` or `sharp`. L7/L8/L10 have zero runtime deps; L9 depends on zod, so decide whether engine may depend on zod (domain does).

## 4. Behavioural decisions to ratify

| # | Lane | Behaviour | Recommendation |
|---|---|---|---|
| 1 | L7 | Money rounding half-up, once per costed line/total (`roundHalfUp`; `roundBankers` exported, unused) | Ratify. Shared `roundPence` in `@fr/domain`; ban bare `Math.round` on pence; document negative (discount) rounding |
| 2 | L7 | Ranges cost at max (`basis: range_max`) | Ratify for budgets; surface basis in UI ("up to") |
| 3 | L8 | Nutrition ranges use midpoint, flagged estimate | Ratify but document contrast with #2; check L3 aggregate/shopping amounts use max for ranges consistent with L7 |
| 4 | L8 | Unknown propagation: any unknown part makes the total `unknown`, value withheld, `incomplete`, `lowerBound` = sum of knowns; never 0 for unknown; no parts = `unavailable`; per-serving keeps status | Ratify; UI shows lowerBound as "at least"; weekly roll-up must follow same rule |
| 5 | L8 | `treatToTasteAsNegligible` default false (strict); optional lines excluded by default | Ratify strict default |
| 6 | L8 | salt = sodium mg/1000*2.5; kJ = kcal*4.184, flagged derived | Ratify; verify L5 refdata uses same constants and NutrientKey names |
| 7 | L8 | Mandatory `NUTRITION_DISCLAIMER` text | Ratify; export from one place and render on every nutrition surface |
| 8 | L4 | MockAiProvider refuses NODE_ENV=production unless `allowInProduction` or `AI_ALLOW_MOCK_IN_PRODUCTION=true`; rechecked per call (`MOCK_FORBIDDEN`) | Ratify; never set the override in prod/preview; add a startup assert in the provider factory and a CI test; L6 e2e must run with NODE_ENV != production or the opt-in |
| 9 | L4 | Image intake: magic-byte sniff (ignore client MIME), 15 MB in, 3 MB out, 1568 px long edge, max 6, EXIF rotate, strip metadata, re-encode JPEG; HEIC sniffed | Ratify; confirm HEIC path (convert on device in L14 via expo-image-manipulator; sharp prebuilds may lack HEIC) |
| 10 | L4 | `householdId` only for usage/limits, never in prompts; only anonymised exclusions / first names in plan prompt | Ratify as privacy rule; add test that prompts contain no ids |
| 11 | L4/L9 | `excludeIngredients` are HARD, enforced in code by solver; AI only proposes | Ratify; AI is never the sole allergen defence |
| 12 | L10 | Deterministic matcher; `confident` is only a pre-selected suggestion; user confirms every purchase; fresh vs dried form conflicts flagged; optimal assignment with margin on both line and item side; learned household mappings via `learnedKey` | Ratify; PurchaseEvents are append-only, so no auto-write without confirmation |
| 13 | L10 | Discounts attach to previous item (net pence); orphan discounts tallied; `totalCheck` reconciles | Ratify; run against L6 receipt fixtures (e.g. r2 total 410) in CI |
| 14 | L10/L3 | Pint 568.261 (L10) vs 568.26125 (L3); metric cup 250 ml | Single constant from L3; US cup unsupported |
| 15 | L3 | approximate / to_taste / unparsed never converted or summed; count units convert only to same unit; ranges convert both ends | Ratify; L7/L8 keep surfacing these as uncosted/missing |
| 16 | L7 | Price priority user_confirmed > receipt > retailer_verified > generic_estimate; derived unit prices flagged; pantry deduction and leftover/waste in basket | Ratify; confirm recency tie-break; whole-pack rounding needs product sign-off |
| 17 | L6 | Fixtures include negative discount lines and `expectedIngredient: null` (must not match) | Ratify as acceptance corpus for L10 |

## 5. Merge order and checklist

Order: L1 domain -> L3 engine core -> L5 refdata -> L7 / L8 / L10 / L9 / L17a (into engine, parallel) -> L4 ai -> L2a ui -> L6 qa -> L14 mobile and apps/web wiring.

1. Root: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc` (`node-linker=hoisted` for Expo), root devDeps and `pnpm.overrides` for zod/typescript/vitest/react per section 2.
2. L1 to `packages/domain`: copy without node_modules/lockfile; add canonical zod (unified `QuantitySchema`, `ExtractedRecipe`, `ReceiptParse`, `Pence`, `PurchaseEvent`); run its tests and typecheck.
3. L3 to `packages/engine`: `src/contract.ts` becomes re-exports from `@fr/domain`; pre-declare exports for `./cost ./nutrition ./receipt-match ./planner ./shopping`; add converter adapters.
4. L5 to `packages/refdata`: migrate zod 3 to 4; verify nutrient constants and keys against L8; check `data/` size.
5. L7/L8/L10/L9/L17a into `packages/engine/src/*`: delete local `contract.ts` (import `@fr/domain`), normalise relative imports to extensionless, drop per-lane package.json/tsconfig/lockfile/node_modules, swap `UnitConverter` for adapters, remove L10 `toBase`/`PINT_ML`, move tests under `packages/engine/test/<name>`.
6. L4 to `packages/ai`: import base types from `@fr/domain`; mark server-only; verify sharp builds under pnpm (`onlyBuiltDependencies`); run mock tests with NODE_ENV=test; add production-guard CI test.
7. L2a to `packages/ui`: align react version; vitest `environment: jsdom`.
8. L6 to `packages/qa`: pnpm, delete `package-lock.json`; use `@fr/domain` schemas; align fixture field names (section 1); move `e2e-spec` to `apps/web/e2e`; align vitest/ts/@types/node; add tests running L10 over receipt fixtures and L4 mock over recipe fixtures.
9. L14 to `apps/mobile`: Metro monorepo config (watchFolders, nodeModulesPaths), TS version decision, jest stays separate, import `@fr/domain`/`@fr/engine` from TS source.
10. `pnpm install`, then `turbo run typecheck test`; grep for stale names: `@fr/cost|@fr/nutrition|@fr/receipt-match|@fr/engine-`.
11. Lint rules: no bare `Math.round` on pence, no `node:` imports in engine, no `@fr/ai` in client bundles.
12. Commit per step so a failed merge can be reverted individually (integrator does the git work).

### Open questions
- Canonical `QuantitySchema` strictness (approximate+unit rejection) vs what the L3 parser emits.
- `servings`: int (L6) vs positive number (L4).
- L9 vs L4 `PlanConstraints`: single schema?
- TypeScript 5.7 vs Expo's 6.0 vs L6's 7.0: choose one.

## Ratified decisions (main thread, 2026-10-19)
| Question | Decision | Why |
|---|---|---|
| Quantity strictness | Adopt **L6's stricter rules** in @fr/domain (approximate ⇒ approxLabel, no unit; to_taste ⇒ no value/unit; unparsed ⇒ originalText only) | Prevents invented weights at the type level |
| `servings` | **Positive integer** everywhere (household, planned meal, recipe default); recipe yield like "makes 1.5 loaves" kept in description | Scaling + UI simplicity |
| PlanConstraints | **One schema in @fr/domain**, L9's solver shape canonical; L4 output schema imports it; L16a uses it | Solver owns hard-constraint semantics |
| TypeScript | Whatever L0 skeleton pins (5.x stable); L6/L14 downgraded to match | One compiler for the workspace |
| zod / vitest | zod **v4**, vitest version from L0 skeleton; L5 migrated v3→v4 | Majority + L4 needs z.toJSONSchema |
| Ranges | Cost at **max** (conservative budget), nutrition at **midpoint** flagged estimate — both kept, documented | Different purposes |
| Pint | Use **568.26125 ml** (L3 constant) everywhere | Single source in @fr/engine/units |
| UnitConverter | Consumers depend on `@fr/engine/units` adapter over L3 `convertQuantity` | Remove 3 local variants |
| Receipt shapes | Canonical `ReceiptLine { rawText, quantity?, pricePence, discountPence (positive) }` in @fr/domain; L4/L6/L10 adapt | Single shape |
| Package manager | pnpm only | L6 converted on merge |
