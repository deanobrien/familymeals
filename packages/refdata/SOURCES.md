# @fr/refdata - sources, licences, caveats

## 1. CoFID (nutrition)
- Dataset: McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID), UK Government (PHE / OHID).
- Landing page: https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid
- File used: https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx
  (saved as `data/raw/cofid2021.xlsx`, 4.6 MB, sha256 436e9445ef2adb2a75f3d7edd51302de3adad25385f9795fc94ba58bd030e97d)
- Version: 2021 update (page updated 19 March 2021); 2,887 foods. Not imported: the separate "old foods" file.
- Licence: Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Attribution: "Contains public sector information licensed under the Open Government Licence v3.0."
- Basis: per 100 g edible portion. Sheets used: `1.3 Proximates`, `1.4 Inorganics`.
- Re-run: `pnpm exec tsx scripts/import-cofid.ts [xlsx] [out.json]` -> `data/out/cofid.json`.

### Value-status rules (BRIEF section 11: never present unknown as zero)
| CoFID cell | status | value | estimate |
|---|---|---|---|
| number > 0 | known | n | false |
| 0 / 0.0 | zero | 0 | false |
| `(n)` brackets | known/zero | n | true |
| `Tr` (trace) | known | 0 (+ `trace: true`) | true |
| `N` (not known) | unknown | - | false |
| blank | unavailable | - | false |

`Tr` rule: a trace is real but negligible, so it adds 0 to sums, is flagged estimate and is NOT status `zero`.
Derived: `salt` (g) = sodium (mg) x 2.5 / 1000 (inherits sodium's status; unknown sodium -> unknown salt).
`fibre` = AOAC fibre; if not reported, NSP fibre is used and flagged (`derived`, estimate true).
`saturates` = "Saturated fatty acids per 100 g food" (SATFOD). Energy/protein/fat/carbohydrate/sugars as published.
Known source defect: food code `13-669` is used twice (Aubergine roasted / Watercress raw); both rows are kept with `duplicateCode: true` and must not be mapped.

## 2. Ingredient seed (`data/seed/ingredients.tsv`)
382 common UK home-cooking ingredients, authored in this lane. CoFID links (`data/seed/cofid-map.json`) were hand-reviewed from candidate lists (`scripts/resolve-cofid.ts`): `exact` = same food/form, `proxy` = near substitute (product may differ materially - show as such). Unmapped ingredients have NO nutrition (must display `unavailable`).
Fresh vs dried vs ground forms are separate ingredients (e.g. fresh coriander vs ground coriander).
`pnpm exec tsx scripts/build-seed.ts` writes `data/out/ingredients.json` and `data/out/prices.json`. Ids are deterministic UUIDv5 of the slug.

## 3. Densities, unit weights and count-unit weights (`src/data/`)
Typical household-measure values from common published cookery/baking reference charts, rounded. They were NOT verified line-by-line against a primary source; powders vary +/-15%. Unit weights are typical UK medium-item estimates and all carry `estimate: true`. The engine must refuse volume<->mass conversion when no density exists.

Count-unit weights (`src/data/count-unit-weights.ts`, D90): the weight of ONE can / clove / slice / bunch / sprig / stick / pack of an ingredient, merged onto the ingredient as `countUnitWeightsG` and used by the engine for that exact unit only (a clove never becomes a can). Always `estimate: true`. Cans use the DRAINED weight for pulses/fish/veg (matching the CoFID "canned, drained" profile) and the net contents for sauces/liquids; `pack` means the single pack/sachet/pot a recipe usually names for that ingredient. A count unit with a weight AND a density can also convert to volume (a 400 ml tin of coconut milk = 1 can). Pack size written on a label ("400g can") is not yet carried by recipe lines (see COVERAGE.md).

Conventions for new values: every entry carries a source string containing "estimate"; fresh herbs and chilli are priced as a gram pack so bunch/sprig/item lines convert; aliases are added to the existing ingredient when the product is the same thing (tortillas = wrap, soft cheese = cream cheese, braising beef = stewing beef) and a NEW ingredient only when it is a different product (chicken stock powder vs liquid stock). Meal-kit staples (nigella seeds, mango chutney, little gem, stock mix sachet, harissa, garlic puree, cajun/fajita/jerk/ras el hanout/five spice, ciabatta, baguette, pizza base) were added in D90.

## 4. Prices (`src/data/prices.ts`)
382 generic estimates (one per ingredient), `kind: generic_estimate`, observedOn 2026-10-19, integer pence per standard pack (stock priced per litre as made from cubes/powder; water at 1p/litre). Author-assessed typical own-brand shelf prices; NOT live, NOT scraped from any retailer, expect +/-30% and rapid ageing. UI must label them as estimates; user/receipt prices override.

## 4a. Coverage
See `COVERAGE.md` (before/after cost and nutrition coverage over the fixture recipes; `pnpm --filter @fr/refdata coverage`). After editing seed/data files run `pnpm --filter @fr/refdata build:seed` to regenerate `data/out/*.json` (tests fail on drift).

## 5. Re-downloading the raw CoFID workbook
`data/raw/*.xlsx` (4.5 MB) is git-ignored to keep the repo small. To restore it, download the file URL in section 1 and save it as `packages/refdata/data/raw/cofid2021.xlsx` (verify the sha256 above), then `pnpm --filter @fr/refdata import:cofid` regenerates `data/out/cofid.json`. The generated `data/out/*.json` ARE committed, so tests and consumers never need the xlsx.
