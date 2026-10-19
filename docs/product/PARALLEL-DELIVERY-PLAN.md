> **Original delivery plan (2026-10-19), historical.** Lanes (L1..L24) were built by parallel agents in git worktrees and merged in waves; lane IDs still appear in `DECISIONS.md` and commit messages. Status of each lane: `IMPLEMENTATION_PLAN.md`. Open owner decisions listed at the end were resolved: repo is on GitHub (`deanobrien/familymeals`), hosting is Azure App Service, Supabase project is London. "Larry" = the owner's orchestrating agent (owner-machine tooling, not part of this repo).

# PRJ-018 — Parallel Delivery Plan

Goal: replace the brief's serial M0→M10 with **contract-first waves** and **independent lanes**, so up to 6–7 agents build at once without touching each other's files. Brief milestones remain the *acceptance gates*; they are no longer the *build order*.

## Core idea
Parallelism is unlocked by freezing three contracts early:
1. **DB schema v1 + RLS** (`packages/db/migrations`) — the whole data model from BRIEF §5 + review additions.
2. **Domain types** (`packages/domain`, zod) — generated from/aligned with schema; every lane imports these.
3. **Service interfaces** — `AiProvider`, `PriceSource`, `NutritionSource`, engine function signatures — with mock implementations.

After that, each lane owns its own directories. Pure-TS work (engine, solver, matcher) needs **no** app or DB at all and starts in Wave 0.

## Directory ownership (prevents merge conflicts)

| Path | Owner lane |
|---|---|
| `packages/db/migrations`, RLS policies | L1 Schema (W0); later lanes add **timestamped, lane-named** migrations only |
| `packages/domain` | L1 Schema; others request changes via small PRs |
| `packages/engine/units, scale, aggregate` | L3 Engine core |
| `packages/engine/cost` · `/nutrition` · `/planner` · `/receipt-match` | L7 · L8 · L9 · L10 |
| `packages/ai` | L4 AI gateway |
| `packages/refdata` (CoFID import, ingredients, aliases, densities, generic prices) | L5 Reference data |
| `apps/web/app/(shell)`, `components/ui`, nav | L2 Shell/design system |
| `apps/web/app/recipes/**` · `/plan/**` · `/shopping/**` · `/household/**` · `/receipts/**` · `/pantry/**` | owning feature lane |
| `e2e/`, `tests/rls/`, fixtures | L6 QA |
| `apps/mobile` | L14 Expo |

Each lane works in its own git worktree on branch `prj018/<lane>`; the main thread (Larry) reviews and merges in wave order.

## Waves

### Wave 0 — Foundation
**W0a (serial, short — the only true bottleneck)**
- **L0 Skeleton** — pnpm + Turborepo monorepo, Next.js App Router (strict TS), Vitest, Playwright, ESLint/Prettier, CI script, `.env.example`, Supabase config, README/CLAUDE.md/IMPLEMENTATION_PLAN.md/DECISIONS.md. *Sonnet.*

**W0b (parallel, 6 agents)**
| Lane | Work | Model |
|---|---|---|
| L1 Schema & contracts | Full schema v1, RLS for every table, storage buckets (private), zod domain types, generated DB types | **Opus** |
| L2 Shell & design system | Layout, responsive nav (mobile bottom bar), UI primitives, empty/loading/error states, theming | Sonnet |
| L3 Engine core | Normalise, unit conversion (incl. density gate), serving scaling, aggregation with provenance, approx/unparsed handling — exhaustive unit tests | **Opus** (correctness-critical) |
| L4 AI gateway | Provider-independent interface, Claude adapter, mock provider, zod-validated outputs, retries, image resizing limits, `AiUsage` logging | Sonnet |
| L5 Reference data | CoFID importer, canonical ingredient seed + aliases, densities/unit weights, dated generic UK price seed | Sonnet |
| L6 QA harness | Playwright setup, deterministic AI fixtures (sample recipe/receipt images + mock responses), RLS test framework, CI wiring | Sonnet |

**Gate G0** = Brief M0 acceptance + schema merged + engine core green.

### Wave 1 — Core features (parallel, 7 agents; needs G0)
| Lane | Work | Brief M |
|---|---|---|
| L11 Auth & household | Sign-up/in/recovery, household create, membership, server-side guards, RLS tests | M1 |
| L12 Recipe library | Recipe CRUD, image storage, card grid/list, search, filters, tags, favourites, detail page, duplicate detection | M1 |
| L13 Recipe extraction | Multi-image upload → AI extraction → review/correct screen → save with `RecipeVersion` + source images | M2 |
| L7 Cost engine | Consumption cost, pack-size basket cost, pantry deduction, price-source hierarchy | M3/M5 |
| L8 Nutrition engine | Aggregation with `known/zero/unknown/unavailable`, per-serving/total, provenance | M3/M6 |
| L9 Planner solver | `PlanConstraints` type, deterministic solver, hard-constraint validation, proportion rounding, "unmet constraint" explanations | M4 |
| L10 Receipt matcher | Line ↔ outstanding-item candidate scoring (pure TS, no auto-confirm) | M8 |

L6 QA continues across all waves, adding E2E steps as features land.

**Gate G1** = M1 + M2 + M3 acceptance.

### Wave 2 — Composition (parallel, 5 agents; needs G1)
| Lane | Work | Brief M |
|---|---|---|
| L15 Meal planner UI | 7-day grid, add/swap/move/duplicate, servings, eating-out/leftovers, reuse previous week, approve | M4 |
| L16 Prompt planning | Prompt → AI → `PlanConstraints` → solver → review → approve (uses L9 + L4) | M4 |
| L17 Shopping list | Generate from approved plan (L3 aggregation), manual items, aisle grouping, one-tap tick via `PurchaseEvent`, partial purchases | M5 |
| L18 Cost & nutrition UI | Recipe detail cost/nutrition panels, basket estimate, weekly nutrition summary, honest "estimate" labelling | M5/M6 |
| L19 Price management | User price entry/override, price history | M5 |

**Gate G2** = M4 + M5 + M6 acceptance → **MVP-ready internally**.

### Wave 3 — Sharing, receipts, pantry (parallel, 5 agents; needs G2)
| Lane | Work | Brief M |
|---|---|---|
| L20 Realtime & invitations | Expiring hashed invites, revoke, Supabase Realtime on list/plan, reconnect resync, offline queue with idempotent events | M7 |
| L21 Receipt flow | Upload → AI parse → L10 matching → confirm → purchases, actual-price history, extras to pantry | M8 |
| L22 Pantry | Stock CRUD, expiry, configurable post-purchase deduction, "use what I have" suggestions | §14 |
| L23 Home dashboard | Week summary, basket cost, list progress, activity | §6 |
| L14 Expo (optional start) | Expo app in monorepo: auth, recipe browse, shopping list on shared packages | M10 |

**Gate G3** = M7 + M8 acceptance → **First release scope (BRIEF §19) complete**.

### Wave 4 — Hardening (parallel, 4 agents)
Full E2E journey (BRIEF §15) · accessibility + responsive audit · security/RLS penetration review + rate/AI limits · deployment, backup/restore, privacy & data-export docs. Then **M10 Android** continues as its own lane set (camera capture, offline shopping, receipt capture, device testing).

## Critical path
`L0 → L1 schema → L11 auth → L12 recipes → L15/L17 planner+list → L20 realtime → hardening`.
Everything else runs beside it. Biggest risk to the path: **L1 schema quality** — hence Opus and a review gate before W1 fans out.

## Integration rules
- Merge order within a wave: contracts/packages before apps.
- Every lane must leave `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` green before review.
- No lane edits another lane's directory; contract changes go through L1 (or the main thread after W0).
- Mocks live under `*/mock/` and are refused by a runtime guard when `NODE_ENV=production`.
- Each lane ends with the brief's §18 milestone report.

## Decisions needed from owner (block W0a)
1. **Repo location & Git host** — e.g. a personal GitHub repo (resolved: `deanobrien/familymeals`) (Not ADO/Northumbria.)
2. **Supabase** — cloud project in London (needs account) and/or local stack (needs Supabase CLI + newer Docker).
3. **AI key** — Anthropic API key for the server env (mock provider used until supplied).
4. ~~Owner-machine tracking database firewall~~ (not relevant to this repo).
5. **Product name** (optional now; placeholder used).

## Rough capacity
| Wave | Parallel agents | Opus | Sonnet |
|---|---|---|---|
| W0a | 1 | – | 1 |
| W0b | 6 | 2 | 4 |
| W1 | 7 (+QA) | 1 (L9 solver) | 6 |
| W2 | 5 (+QA) | – | 5 |
| W3 | 5 (+QA) | 1 (L20 sync) | 4 |
| W4 | 4 | 1 (security) | 3 |
