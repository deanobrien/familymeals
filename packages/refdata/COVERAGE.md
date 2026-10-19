# @fr/refdata - cost and nutrition coverage (D90)

Measured with the real engine (`@fr/engine/cost`, `@fr/engine/nutrition`, `IngredientMatcher`, catalogue converters) over:
the 8 e2e fixture recipes (`e2e/fixtures/recipes/*.expected.json`), the photo-import fixture
(`packages/recipe-import/fixtures/recipe-extraction.json`) and 4 Gousto-style meal-kit cards
(`test/mealkit-fixtures.json`, authored in this lane to exercise cans, cloves, sachets, bunches, tortillas, chutney...).
Re-run: `pnpm --filter @fr/refdata coverage` (prints every uncosted / no-nutrition line with its reason). A regression
floor lives in `test/coverage.test.ts`. Generated 2026-10-19.

## Before / after

| Metric (13 recipes, 106 lines) | Before | After |
|---|---|---|
| Lines priced | 73 / 106 (69%) | 100 / 106 (94%) |
| Lines with nutrition | 65 / 106 (61%) | 100 / 106 (94%) |
| Recipes fully priced (no "At least") | 2 / 13 | 9 / 13 |
| Recipes with a known per-serving energy | 1 / 13 | 6 / 13 |
| Canonical ingredients | 365 | 382 |
| Ingredients with a generic price | 157 | 382 (all) |
| Ingredients with a CoFID link | 309 | 343 |

Fixture-only subset (9 recipes, 63 lines): priced 43 -> 57, nutrition 40 -> 59, fully priced 2 -> 5, energy known 1 -> 5.
"Energy known" is stricter than "nutrition lines": one unmapped or approximate line (a pinch of salt, nigella seeds,
sun-dried tomatoes) leaves the recipe total honestly `unknown` (D61), so the energy figure improves more slowly than line coverage.

Per recipe (priced / nutrition lines of total; cost per serving in pence):

| Recipe | Before priced | After priced | Before nutrition | After nutrition | Cost/serving before -> after |
|---|---|---|---|---|---|
| 01 tomato pasta | 7/7 | 7/7 | 5/7 | 7/7 | 68 -> 68 |
| 02 lemon loaf | 7/7 | 7/7 | 7/7 | 7/7 | 34 -> 34 |
| 03 beef stew | 6/10 | 10/10 | 6/10 | 10/10 | 22 (partial) -> 207 |
| 04 fractions/ranges | 6/10 | 7/10 | 6/10 | 8/10 | 37 (partial) -> 40 (partial) |
| 05 blurry curry | 2/4 | 4/4 | 2/4 | 4/4 | 49 (partial) -> 85 |
| 06 fish pie | 5/8 | 8/8 | 6/8 | 8/8 | 24 (partial) -> 290 |
| 07 porridge | 2/4 | 3/4 | 3/4 | 4/4 | 15 (partial) -> 67 |
| 08 chickpea stew | 4/7 | 6/7 | 2/7 | 6/7 | 82 (partial) -> 106 (partial) |
| import fixture (lentil soup) | 4/6 | 5/6 | 3/6 | 5/6 | 21 (partial) -> 26 (partial) |
| kit: tikka wraps | 8/12 | 12/12 | 9/12 | 11/12 | 219 (partial) -> 276 |
| kit: creamy tomato pasta | 7/11 | 11/11 | 4/11 | 10/11 | 60 (partial) -> 120 |
| kit: smoky chicken rice | 7/10 | 10/10 | 7/10 | 10/10 | 124 (partial) -> 135 |
| kit: sweet potato curry | 8/10 | 10/10 | 5/10 | 10/10 | 95 (partial) -> 122 |

Many "before" per-serving costs were low because the priciest lines (beef, fish) were uncosted; they were "At least" figures.

## Before: every uncosted / no-nutrition line and why

| Reason | Lines (recipe) |
|---|---|
| Count unit with no weight (`can`, `clove`, `sprig`, `bunch`, `bay leaf`) | tinned tomatoes, chickpeas x3 (nutrition); garlic cloves x6 (nutrition); thyme sprigs, fresh coriander x2 bunch (cost); bay leaves (nutrition) |
| Alias missing / unmatched | braising beef, white fish fillets, floury potatoes, flaked sea salt, parsley, mango chutney, little gem, nigella seeds, basil, chicken stock mix x2, grated Italian hard cheese |
| No generic price | beef stock, vegetable stock x2, bay leaf, smoked haddock, mixed berries (frozen berries), smoked paprika x2, sultanas (raisins), sun-dried tomatoes |
| Pack unit not convertible (price per can/pack, line in ml/tbsp) | coconut milk 400 ml, curry paste tbsp x2 (no density) |
| No CoFID mapping | red peppers x3, beef stock, vegetable stock, mixed berries, white fish, braising beef (via alias), soft cheese |
| Honestly unresolvable (unchanged) | "a pinch" of salt, "a handful" of parsley, "to taste" pepper/honey, free text "whatever greens need using up" |

## After: remaining gaps (6 lines of 106)

| Line | Cost | Nutrition | Why it stays |
|---|---|---|---|
| flaked sea salt (a pinch) | approximate_quantity | no_grams | "a pinch" is never given a weight (BRIEF sec. 8) |
| parsley (a handful) | approximate_quantity | no_grams | "a handful" is never given a weight; matched correctly to fresh parsley |
| black pepper (to taste), honey (to taste) | to_taste | ok | to-taste lines are negligible for nutrition, never priced |
| salt (a pinch), import fixture | approximate_quantity | no_grams | as above |
| whatever greens need using up | unmatched | unparsed | free text, correctly not guessed |
| nigella seeds | priced | no_profile | no CoFID entry exists for nigella seeds |
| sun-dried tomatoes | priced | no_profile | no CoFID entry (sun-dried or dried tomato) |

## Known data limits (not fixed here)

- Ingredients with no CoFID food: the full list is the ingredients without `cofid` in `data/out/ingredients.json` (39,
  mostly sauces, condiments, spice blends, plant milks, tea/coffee and branded convenience foods). They show nutrition `unavailable`.
- `proxy` mappings (66) are flagged estimates; some are coarse (vegetable and beef stock use the ready-made chicken stock
  profile; frozen berries use raw raspberries; drumstick uses the raw leg quarter with skin).
- Packs given as label text ("400g can") are not carried into the recipe line today: the store keeps the line as `1 can`, so the
  engine uses the ingredient's `countUnitWeightsG.can`. Honouring a parsed pack size (`ParsedIngredientLine.pack`) needs a recipe-line
  field (apps/web / domain) and is out of this lane.
- The parser has no `sachet`, `pot`-as-count-weight, `handful` or `knob` units; "1 sachet" currently falls through unless the AI
  extraction emits `pack`.
