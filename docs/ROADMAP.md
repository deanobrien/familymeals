# ROADMAP.md

Milestones are the brief's M0-M10 ([product/BRIEF.md](product/BRIEF.md) section 17). Percentages are the maintainer's honest estimate of **done and verified in mock mode**, as of 2026-10-20; "unverified live" means not yet run against the hosted Supabase, a device or a real AI model. LV1 (2026-10-19) verified the Supabase paths against a local Supabase stack (all 23 migrations + seed on Postgres 17.11; live suite 20/20). Lane/task checkboxes: [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md). Re-estimate when you finish something and update this file.

| Milestone | % | Done | Remains |
|---|---|---|---|
| M0 Repository and architecture | 100 | monorepo, tooling, CI workflow file, Supabase config, docs, handover docs | enable CI on GitHub and run it once (D38) |
| M1 Recipe library | 90 | CRUD, versions, search/filter/tags/favourites, images, duplicates warning, Supabase repository | hosted-project run (local live verified, LV1); Supabase Storage for images (local files today); price-filter/cost-sort scales poorly past 10,000 recipes (D58) |
| M2 AI recipe extraction | 85 | multi-page photos, rotation, fractions/ranges, printed nutrition, confidence + mandatory review, cover images, Anthropic/OpenAI/Azure adapters, encrypted per-household keys, phone import via bearer token | accuracy against real models is unmeasured; HEIC/very large phone photos in real browsers; live bearer-token verification |
| M3 Ingredient engine | 95 | units (metric/imperial/pint), parse, normalise, scale, aggregate with density gate, refdata coverage (R2) | household-custom ingredients deferred (D22); more aliases as real recipes reveal gaps |
| M4 Weekly meal planner | 85 | manual planner, prompt planning, single `PlanConstraints`, editable chips, solver with quick-meal weights, approve flow, computed cost and weekly nutrition | live-model prompt parsing unverified; real household member profiles (demo values for planner profile in mock mode); variety/leftover tuning |
| M5 Shopping and pricing | 80 | list from approved plan, basket cost estimate, price hierarchy, household price observations from receipts | L19 price management UI (manual price entry/override screens), product pack data (X2), store/retailer verified prices |
| M6 Nutrition | 85 | CoFID-based calculation, value-status model (never unknown-as-zero), per-serving and weekly, printed-card comparison | partial-cost/nutrition flag polish on cards (D62); micronutrient coverage; nutrition profile targets |
| M7 Household synchronisation | 70 | households, invitations (hashed tokens), roles, transfer ownership, Supabase shopping repository with command log, `list_seq` cursor, Realtime hint | Realtime and invitations verified live locally (LV1); remaining: hosted-project verification, heavy concurrency, `live.ts` marks the channel live before the server confirms the subscription, invitation email delivery with custom SMTP |
| M8 Receipt reconciliation | 80 | photo parse, deterministic matcher against the list, confirm UI, ticks items, extras to pantry, price capture | live model accuracy on real UK receipts; multi-page/long receipts; discount edge cases |
| M9 Hardening and release | 35 | RLS on every table + PGlite RLS suite, security headers/CSP, production config guard, health endpoint, a11y/responsive audit, privacy page, deletion lifecycle SQL (14-day grace) | data export and deletion UI, rate limits and AI budget caps, backups/restore drill, log/alerting, penetration pass, custom SMTP, privacy contact/ICO registration (owner), threat-model review ([security/SECURITY-CHECKLIST.md](security/SECURITY-CHECKLIST.md)) |
| M10 Android | 55 | Expo app with mock and Supabase DataSource, offline queue and replay, conflict toasts, camera import, dark mode, a11y | verify on a device (camera, SecureStore, NetInfo, TalkBack); move shopping sync from `seq` to `list_seq` (D129); build/sign APK/AAB via EAS; store listing |
| Extra: Pantry + scan | 85 | stock, expiry (use-by wins over best-before), leftovers, video/photo scan with review (P2, D80-D89) | live-model scan accuracy; shelf-life data coverage |
| Extra: Azure deploy | 60 | standalone build, packaging script, runbook, health check, CSP | push schema to cloud, redeploy with D2 fix, smoke test (HANDOVER section 8); Supabase Storage for uploads; scale-out readiness |

## Ideas backlog

Owner ideas first; others are maintainers' notes. Nothing here is committed scope.

- **Pantry video scan** (owner idea): done (P2); next is measuring accuracy and adding barcode lookup.
- **TheMealDB recipe discovery** (owner idea, lane X1 in progress): browse/search an open recipe API, import selected recipes as drafts through the same review step; attribute the source; do not store without review; respect the API terms.
- **Continuous barcode scanning** (owner request, lane BS1): done on web (D270-D273) and Android hand-off (D274); not done: phone-as-scanner for a desktop session (D275), a beep and keep-awake in the app, measuring decode speed and hit rate on real phones.
- **Open Food Facts** (owner idea, lane X2 in progress): barcode/product lookup to fill pack sizes, brand and nutrition for pantry items and price packs; ODbL attribution; cache results per household.
- Receipts: retailer-specific parsers, loyalty-card price capture, split-bill for shared households.
- Planner: leftovers-aware plans, budget-first mode, batch-cooking suggestions, seasonal produce.
- Shopping: store-aisle ordering, multiple lists per week, shared notes.
- Nutrition: targets per person, allergen/FSA traffic-light labels.
- Sharing: recipe export/import between households, public share links (needs privacy review).
- Platform: iOS via Expo, PWA install/offline for the web app, push notifications for list changes.
- Ops: staging App Service slot, Application Insights, scheduled DB backups, Playwright against the deployed app.
- LV1 follow-ups: live tests for receipts, price observations and per-household AI settings; confirm-then-mark-live in `lib/shopping/live.ts`; ingredient links for form-created recipes. (B1, D160-D164, fixed the sandbox import save, per-household in-memory recipes, 44px tap targets and the offline-race flake, which was a spec race.)
- Name and branding (owner decision pending; scope `@fr/*` is deliberately neutral).
