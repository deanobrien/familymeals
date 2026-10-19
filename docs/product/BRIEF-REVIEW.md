> **Original planning review (2026-10-19), historical.** Its recommendations were adopted (see `DECISIONS.md`). The "Environment findings" section describes the owner's original Windows machine and is no longer relevant; use `docs/HANDOVER.md` for prerequisites.

# PRJ-018 — Brief Review

Reviewed 2026-10-19 against [BRIEF.md](BRIEF.md).

## Verdict
Strong brief. The deterministic-vs-AI split, "unknown ≠ zero", and keeping recipe / requirement / purchase / pantry as separate records are exactly right. The main problems are **sequencing** (milestones are serial but most work is independent), **two unresolved data-source questions** (nutrition, prices) that the core product promise depends on, and a few schema gaps.

## Must-resolve before build

| # | Issue | Recommendation |
|---|---|---|
| 1 | **Nutrition source unspecified.** | UK **CoFID** (McCance & Widdowson's, Open Government Licence) as primary; USDA FoodData Central as fallback for gaps. Import once as reference data; store source + version per value. |
| 2 | **No legitimate UK supermarket price API**; brief rightly bans scraping. "Know what meals cost" therefore relies on seeded generic estimates + user entry + receipts in v1. | Ship a seeded generic UK price table (labelled *estimate*, dated), user overrides, and receipt-derived prices. Say so in product copy. |
| 3 | **Volume↔mass conversion** (200 ml flour) needs per-ingredient density data — not in the model. | Add `IngredientDensity` (g/ml, source) and `IngredientUnitWeight` (e.g. 1 onion ≈ 150 g, flagged *estimate*). Engine refuses conversion without it. |
| 4 | **Allergies/dietary restrictions are health data** (UK GDPR special category) yet brief says avoid health data. | Store allergies as household-level hard exclusions with explicit consent copy; keep out of AI prompts except as anonymised exclusion lists. |
| 5 | **Data residency.** | Supabase project in **London (eu-west-2)**. Document AI-provider data processing in privacy page. |
| 6 | **Repo / hosting not defined** — not an ADO/Northumbria product. | Owner decision: repo location, Git host, Vercel vs other. See plan §Decisions. |

## Schema adjustments
- `Recipe.method` duplicates `RecipeStep` — drop `method`, keep steps only.
- `RecipeIngredient` needs `quantity_kind` enum: `exact | range | approximate | to_taste | unparsed` plus `quantity_min/max`. Never invent weights for "a pinch".
- Add `ShoppingListItemSource` (item ↔ planned meal ↔ recipe ingredient, with contributed quantity) for provenance — the brief requires it but doesn't model it.
- Model purchases as **append-only `PurchaseEvent` rows**; derive purchased/outstanding quantity. Removes lost-update races between two shoppers and makes offline replay idempotent (client-generated UUID per event).
- `IngredientPrice` needs `price_kind` (`user_confirmed | receipt | retailer_verified | generic_estimate`) to implement the price hierarchy directly.
- `NutritionProfile` per nutrient row needs `value_status` (`known | zero | unknown | unavailable`).
- Add `AiUsage` (household, operation, model, tokens, cost, status) for limits and auditing.
- Add `Invitation` (hashed token, expires_at, accepted_at) rather than fields on `HouseholdMember`.

## Architecture notes
- **Monorepo from day one** (pnpm + Turborepo): `apps/web`, later `apps/mobile` (Expo), `packages/domain` (zod schemas/types), `packages/engine` (pure TS calcs), `packages/ai` (provider interface + mock), `packages/db` (migrations, generated types). This is what makes Android cheap later *and* what enables parallel build now.
- **Meal planner**: LLM only turns the prompt into a typed `PlanConstraints` object; a deterministic solver in `packages/engine` picks recipes. Hard constraints (allergies, exclusions) enforced in code and re-validated before save.
- **AI provider**: Claude behind the interface (vision model for recipe/receipt extraction, a cheaper model for tagging/parsing), zod-validated, mock provider for dev/CI.
- **Testing**: Vitest (engine, domain), pgTAP or SQL-level tests for RLS, Playwright for E2E with mock AI fixtures.

## Scope
"First release" (§19) is ~M0–M7 — large. Suggested **MVP cut**: M0–M3 + manual planner + shopping list with realtime. Prompt-based planning, nutrition and receipts follow as fast-follows. The parallel plan delivers these as lanes, so the cut is about release gating, not build order.

## Environment findings (original machine, 2026-10-19, historical)
- Node 24, pnpm 9.4, Docker 20.10.7 (too old for the current Supabase local stack at that time; see `docs/HANDOVER.md` for the current prerequisites).
- The owner's private tracking database was unreachable from that machine; irrelevant to this repo.

