# ROADMAP.md

Milestones are the brief's M0-M10 ([product/BRIEF.md](product/BRIEF.md) section 17). Percentages are the maintainer's honest estimate of **done and verified in mock mode**, as of 2026-10-20; "unverified live" means not yet run against the hosted Supabase, a device or a real AI model. LV1 (2026-10-19) verified the Supabase paths against a local Supabase stack (all 23 migrations + seed on Postgres 17.11; live suite 20/20). Lane/task checkboxes: [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md). Re-estimate when you finish something and update this file.

| Milestone | % | Done | Remains |
|---|---|---|---|
| M0 Repository and architecture | 100 | monorepo, tooling, CI workflow file, Supabase config, docs, handover docs | enable CI on GitHub and run it once (D38) |
| M1 Recipe library | 90 | CRUD, versions, search/filter/tags/favourites, images, duplicates warning, Supabase repository | hosted-project run (local live verified, LV1); Supabase Storage for images (local files today); price-filter/cost-sort scales poorly past 10,000 recipes (D58) |
| M2 AI recipe extraction | 85 | multi-page photos, rotation, fractions/ranges, printed nutrition, confidence + mandatory review, cover images, Anthropic/OpenAI/Azure adapters, encrypted per-household keys, phone import via bearer token | accuracy against real models is unmeasured; HEIC/very large phone photos in real browsers; live bearer-token verification |
| M3 Ingredient engine | 95 | units (metric/imperial/pint), parse, normalise, scale, aggregate with density gate, refdata coverage (R2) | household-custom ingredients deferred (D22); more aliases as real recipes reveal gaps |
| M4 Weekly meal planner | 87 | busy evenings (P2-C), leftover / freezer meals in slots, manual planner, prompt planning, single `PlanConstraints`, editable chips, solver with quick-meal weights, approve flow, computed cost and weekly nutrition | live-model prompt parsing unverified; real household member profiles (demo values for planner profile in mock mode); variety/leftover tuning |
| M5 Shopping and pricing | 88 | list from approved plan, basket cost estimate, price hierarchy, household price observations from receipts | L19 price management UI (manual price entry/override screens), product pack data (X2), store/retailer verified prices |
| M6 Nutrition | 88 | CoFID-based calculation, value-status model (never unknown-as-zero), per-serving and weekly, printed-card comparison | partial-cost/nutrition flag polish on cards (D62); micronutrient coverage; per-person goals built by P3-B (consent-gated, NHS adult references, no calories or weights; D430-D439), not yet verified on a phone or the hosted project |
| M7 Household synchronisation | 70 | households, invitations (hashed tokens), roles, transfer ownership, Supabase shopping repository with command log, `list_seq` cursor, Realtime hint | Realtime and invitations verified live locally (LV1); remaining: hosted-project verification, heavy concurrency, `live.ts` marks the channel live before the server confirms the subscription, invitation email delivery with custom SMTP |
| M8 Receipt reconciliation | 80 | photo parse, deterministic matcher against the list, confirm UI, ticks items, extras to pantry, price capture | live model accuracy on real UK receipts; multi-page/long receipts; discount edge cases |
| M9 Hardening and release | 35 | RLS on every table + PGlite RLS suite, security headers/CSP, production config guard, health endpoint, a11y/responsive audit, privacy page, deletion lifecycle SQL (14-day grace) | data export and deletion UI, rate limits and AI budget caps, backups/restore drill, log/alerting, penetration pass, custom SMTP, privacy contact/ICO registration (owner), threat-model review ([security/SECURITY-CHECKLIST.md](security/SECURITY-CHECKLIST.md)) |
| M10 Android | 55 | Expo app with mock and Supabase DataSource, offline queue and replay, conflict toasts, camera import, dark mode, a11y | verify on a device (camera, SecureStore, NetInfo, TalkBack); move shopping sync from `seq` to `list_seq` (D129); build/sign APK/AAB via EAS; store listing |
| Extra: Pantry + scan | 85 | stock, expiry (use-by wins over best-before), leftovers, video/photo scan with review (P2, D80-D89) | live-model scan accuracy; shelf-life data coverage |
| Extra: Handwritten list scan + multiple lists | 80 | photo(s) of a paper list -> reviewable lines -> add to current list (merge preview) or a new named list; several lists per household with one active, switcher, rename, put away (SL1, D260-D267) | live-model accuracy on real handwriting; Android scan screen; Realtime notice of a bare list switch; item counts / delete for archived lists |
| Extra: Minimum pantry stock + restock | 85 | per-household par levels (min, restock-to, pack size, snooze), `restockSuggestions` (explained, pack-rounded, list-aware, stale/expired/unit-mismatch safe), Running low panel + banner on Pantry/Shopping/Home, auto-add setting, Android parity (PR1, D280-D287) | run against the local stack and a device; owner `db push` of `20261020002800`; will-run-low uses only the latest approved plan |
| Extra: Azure deploy | 60 | standalone build, packaging script, runbook, health check, CSP | push schema to cloud, redeploy with D2 fix, smoke test (HANDOVER section 8); Supabase Storage for uploads; scale-out readiness |

## Parity matrix (web vs Android)

Standing rule (D310): every web feature also ships on Android unless a reason is recorded in [../DECISIONS.md](../DECISIONS.md). As of 2026-10-20.

| Feature | Web | Android | Gap |
|---|---|---|---|
| Sign in / household picker | ✅ | ✅ | none |
| Sign-up / forgot password | ✅ | ✅ | P0-A (D320): deep-link confirmation, reset, resend, expired-link handling; needs a device + redirect allow-list |
| Household members / invites / transfer | ✅ | ✅ | P0-A (D321): create, switcher, invite via share sheet, revoke, remove, transfer, leave, accept via deep link, read-only banner |
| Recipes browse / detail | ✅ | ✅ | none (P0-B: search, filters, sort, collections, favourites, covers, household-default servings, cost + nutrition panels; needs a device check) |
| Recipe create / edit + ingredient matching | ✅ | ✅ | none (P0-B: form, "Matched to" picker, duplicates, copy, delete) |
| Photo import full review/edit | ✅ | ✅ | none (P0-B: full on-phone review, same corrections as web) |
| Discover | ✅ | ✅ | none (P0-B; "Add to plan" now opens the in-app planner with the recipe waiting for a slot, P0-D D353) |
| Meal planner manual + prompt chips | ✅ | ✅ | P0-C (D341); needs device check. Discover / recipe "Add to plan" opens this planner (P0-D, D353) |
| Shopping list live / offline / aisles | ✅ installable PWA, works offline | ✅ | P3-C (D445-D446): the web list is now installable and reopens offline (service worker page cache + IndexedDB queue, the same engine queue semantics as Android: idempotent command ids, replay on reconnect, conflict toasts, offline banner); verified with fake-IndexedDB unit tests, a service-worker sandbox test and Playwright with the browser context offline; not verified on a real phone / installed PWA |
| Multi-list + handwritten list scan | ✅ | ✅ | P0-C (D346) |
| Minimum stock + restock suggestions | ✅ | ✅ | PR1 (D280-D287): set minimum, Running low (Add all / choose / snooze), banner on shopping, auto-add setting; jest with a fake server, not run on a device |
| Recipe from a web link (JSON-LD first, AI fallback) | ✅ | ✅ | P1-B (D370-D374): one server route `/api/import/url`; Android adds a link screen and the "Share to Family Recipes" intent (expo-share-intent, needs a new build + device check) |
| What can I make now? | ✅ Home + Pantry | ✅ Pantry + Recipes tab | P1-B (D375): same `/api/pantry/make-now`; no Android Home yet, so the compact card sits on the Recipes tab |
| 5 a day + variety score (planner week) | ✅ | ✅ | P1-B (D376-D377): engine `summariseVariety`, per-recipe profile from the server; Planned/Cooked toggle appears when the week has cooked meals (P1-A `recipe_cooked`) |
| Per-person soft dislikes | ✅ Settings, planner chips, Discover | ✅ Settings, planner chips | P1-B (D378-D379): table `member_dislikes`, own list or owner edits anyone's; solver penalty, never a filter |
| Pantry stock / expiry / use-what-I-have / photo-video scan | ✅ | ⚠️ | P0-C (D342-D343): all but video frames (web-only, native module) and min stock (PR1 not merged) |
| Barcode scanning | ✅ continuous | ✅ | P0-C (D344): review + confirm on the phone, haptics, keep-awake; P0-D (D354): short beep per counted read on both (Settings "Scan sound", default on; silent mode respected); device check |
| Receipts | ✅ | ✅ | P0-C (D345) |
| Phone as the scanner for a desktop session | ✅ "Use my phone" on Pantry scan and Receipts: QR code, phone page `/scan/phone` | ✅ More > Scan for a computer (QR, App Link or pasted address) | P3-C (D447-D449): short-lived signed session (10 min, one phone, hashed token, revocable, RLS, caps); barcodes and photos land in the desktop review live (Realtime hint + poll), nothing is written until the desktop confirms; verified with an SQL RLS script, the stores against the real SQL, route tests and Playwright with a second browser context as the phone; jest with a fake transport; not run with two real devices |
| Home-screen widget: shopping list | - Android-only by nature (the web counterpart is the installable PWA opening on /shopping) | ✅ open items in shop order, tap to tick (same command path + offline queue), tap the header to open, refresh on sync and every 30 min, cleared on sign-out | P3-C (D440-D443): react-native-android-widget 0.23.0; needs a new EAS build (0.4.0 / versionCode 4) and a launcher check; the logic is unit-tested, the native rendering is not |
| Settings: preferences / allergy consent / store aisles | ✅ | ✅ | P0-A (D325): preferences, allergy consent (same wording), AI provider note; store aisles via AS1; web and Android now persist through one shared server module (P0-D, D350-D352: owner-only preferences, consent gate, withdraw consent keeps the list but stops it applying, notice counts it); units/locale are display-only per device; scan sound is a per-device setting on both |
| Data export + account/household deletion | ✅ | ✅ | P0-A (D322, D326): export via bearer + share sheet, household and account deletion with the web confirmations, cancel, countdown; account deletion 2 taps from Settings (Play blocker cleared, pending device check) |
| Notifications: bell + centre, settings (per type, quiet hours), test, push | ✅ | ✅ | P1-C (D389): web push via service worker, Android via expo-notifications; needs owner FCM/VAPID setup and a device check |
| Money: price comparison per shop, budget vs plan vs actual, CSV | ✅ /spending, Home card, shopping badges + list panel | ✅ More > Spending, price screen, shopping badges + card | P2-B (D408): same server routes; Android CSV via share sheet; no Android Home widget (no Android Home); jest with a fake server, not run on a device |
| Cook mode: steps, timers, read-aloud, keep-awake, resume | ✅ | ✅ | P1-A (D361-D362, D368): same engine module on both; web arrows are keyboard-only (D368), Android has swipe + buttons; Android timers also fire a local notification in the background (reuses P1-C setup); jest with mocked device modules, NOT run on a phone |
| Calendar-aware planning: busy evenings (manual, phone calendar, ICS link) -> quick meals or skip dinner | ✅ manual + ICS link | ✅ manual + phone calendar (+ link) | P2-C (D410-D415): derived flags only, titles never read; phone calendar is Android-only by nature, web uses the ICS link; needs a new EAS build (expo-calendar) and a device check of the permission prompt |
| Leftovers + batch cooking: "Cook x2", freezer inventory, leftover / freezer meals in plan slots, mark eaten | ✅ | ✅ | P2-C (D416-D418): portion ledger with idempotent takes, no shopping for these slots, suggestions with busy evenings first; jest + Playwright, not run on a phone |
| Shared family cookbook: share a recipe or collection by link, preview, save a copy | ✅ create / manage on recipe page + /recipes/shared, preview at /s/<token> | ✅ same screens, system share sheet, deep link + App Link | P3-A (D420-D424): same routes (/api/shares); needs a new build for the /s/ App Link; jest + Playwright, not run on a phone |
| Kids' mode: picture-based dinner vote, kid profiles without a login, parent PIN | ✅ /kids, /kids/play | ✅ Kids' mode (More) + full-screen voting | P3-A (D425-D429): PIN kept on the device only; web cannot lock the browser (Back held best effort), Android blocks Back and gestures; results are a soft planner preference |
| Health goals: per-person nutrition goals (separate consent), weekly progress, gentle hints, optional planner nudge | ✅ Settings > Health goals + planner "My goals this week" | ✅ Settings > Health goals screen + planner panel | P3-B (D430-D439): same server routes (`/api/goals`) and the same engine summary; consent text imported from the engine so it cannot drift; adults only, own data only, never sent to AI, withdrawal deletes; jest with a fake server, not run on a phone |
| Ratings, notes, cooked history, don't suggest again | ✅ | ✅ | P1-A (D360, D363, D367, D369): private-by-default notes (RLS), history on detail, stars + last cooked on cards, planner prefers rated and skips flagged recipes |
| Substitutions (AI, allergy-checked) + variants | ✅ | ✅ | P1-A (D364-D365): server re-check, temporary swap in cook mode or saved copy; mock AI only verified |
| Store locations + switch store on arrival | ✅ page open only | ✅ foreground + optional background geofences | P2-A (D390-D394, D396): saved spot per store (current position or postcode, radius 50-1000 m), detection on the device, never a live position to the server; web has no closed-page detection (D396); needs a new EAS build + a phone |
| Near-store nudge "You are near Tesco - 6 items" | ⚠️ preference only | ✅ local notification | P2-A (D393, D398): Android-only by nature (geofence -> local notification); type `near_store`, off by default |
| Voice add to the shopping list | ✅ Web Speech API + typed fallback | ✅ expo-speech-recognition + typed fallback | P2-A (D395): one parse route, review chips, idempotent add; Firefox has no Web Speech API (typed box) |
| Household activity feed | ✅ Home | ✅ | P1-C (D387): Android shows it in Notifications > Household activity (no Android Home yet) |
| Home dashboard, privacy/sources pages | ✅ | ⚠️ | privacy + sources open the web pages from Settings (D325); dashboard still to build |
| Settings -> AI provider | ✅ | - | proposed web-only (D310, awaiting owner confirmation) |

## Phased plan

All durations are **estimates**, not commitments.

### Phase 0 - Finish the release (~1 wk + 2-3 wks parity)

- Real-device APK test (scan beep, keep-awake and haptics are built; hearing/feeling them needs a phone).
- Hourly purge Logic App (D259). **Built by P0-D, owner steps remain:** Expo OTA updates (D354: `eas update --channel preview`; first needs one new build) and Application Insights + two alerts (D355: DEPLOY-APP-SERVICE.md 3d).
- Parity catch-up in 3 lanes:
  - **P0-A** account and household, including account deletion first (Play blocker).
  - **P0-B** recipe create/edit, full import review, discover, cost/nutrition panels, household servings.
  - **P0-C** planner with chips, pantry with scan + min stock, receipts, handwritten list, barcode confirm.

### Phase 1 - Everyday wins (~2 wks)

- **B Import and pantry**: **built by P1-B (D370-D379), web + Android:** recipe from a web link (SSRF-guarded server fetch, schema.org JSON-LD/microdata first, AI text reading only when there is none, same review screen, source link kept; Android also accepts "Share to Family Recipes"); "What can I make now?" (Home, Pantry, Android Recipes tab + Pantry; allergy exclusions with consent; add missing to the shopping list, idempotent); "5 a day" + variety on the planner week (estimate, 80 g portions, no health claims); per-person soft dislikes (Settings, planner chips, solver penalty, Discover sorts lower). Owner steps: push migration `20261021001100`; device check of the share intent (expo-share-intent 8.0.1 declares peer `expo ^57`, the app is on SDK 58: needs a new EAS build and a phone). Not verified: the share intent on a device, fetching real recipe sites, live-model text extraction.
- **A Cooking** (built, web + Android, D360-D369; owner steps: db push `20261021001000`, a new EAS build for expo-speech, device checks): cook mode (steps, detected timers, read-aloud, keep-awake, resume), ratings and notes after cooking (private or household, history, card stars + last cooked, planner signal), substitutions (AI, re-checked against household exclusions, temporary swap or saved variant).
- **C Notifications**: **built by P1-C (D380-D389), web + Android:** notification platform (in-app centre + bell on both; Expo push for Android, Web Push for browsers; per-member per-type preferences, quiet hours, time zone; `/api/jobs/notify` delivery job), daily expiry alerts (use by / best before wording, deep link to "Use what I have"), household activity feed (Home on web, notification screen on Android), opt-in restock nudges (PR1). Owner steps: push the migration, VAPID keys, Firebase/FCM in EAS + a new build, second Logic App action (DEPLOY-APP-SERVICE.md 3e). Not verified: real push delivery (browser push services, FCM on a phone), the job against the hosted project.
- Per-person soft dislikes: done with P1-B (above).

### Phase 2 - Smarter shopping and planning (~3 wks)

- **A Location + voice**: **built by P2-A (D390-D399), web + Android:** store locations (current position or postcode via postcodes.io, radius), "Shopping at" switches on arrival (Android: foreground watch + optional background geofences, opt-in in Settings, Location; web: while the page is open), optional local "You are near Tesco - N items" nudge (Android, off by default, type `near_store`), voice add (Web Speech API / expo-speech-recognition, review chips, typed fallback, idempotent). Owner steps: push migrations `20261021002000` and `20261021002010`, a new EAS build (0.3.0, versionCode 3, two native modules), the Google Play background-location declaration, device checks. Not verified: GPS accuracy and geofence delivery on a phone, the recogniser on a device, postcodes.io from the hosted app.
- **B Money**: **built by P2-B (D400-D409), web + Android:** price comparison per shop (unit prices per kg / litre / item from your own confirmed receipts and prices you enter, "cheapest at" badges needing two recent shops, item price history, "Where's cheapest for this list?" with coverage, receipt shop -> your Store link on confirmation) and budget tracking (weekly budget vs approved-plan estimate vs actual spend from confirmed receipts plus manual entries, weekly + monthly chart with table, category and shop breakdowns, over/under in words, CSV export; weeks in Europe/London). Owner step: push migration `20261021002100`. Not verified: live Supabase, real multi-shop receipts, a phone.
- **C Planning**: **built by P2-C (D410-D419), web + Android:** calendar-aware planning (manual Busy toggles on both, Android phone calendar opt-in with the busy / free answer worked out on the phone, web ICS subscription read server-side with the address stored encrypted; busy evenings become quick-meal dates or a skipped dinner and show as chips) and leftovers / batch cooking ("Cook x2" on mark-cooked, fridge 2 days / freezer 3 months, Pantry freezer view, leftover / freezer meals in plan slots with no shopping, mark eaten decrements once, suggestions). Owner steps: push migrations `20261021002200` and `20261021002210`; a new EAS build (expo-calendar, 0.3.0 / versionCode 3 shared with P2-A); device check of the calendar permission and a real calendar. Not verified: a real calendar or Google / Outlook feed.
- Voice add: done with P2-A (above).

### Phase 3 - Household, health and platform (~3 wks)

- **A Sharing**: **built by P3-A (D420-D429), web + Android:** shared family cookbook links (one recipe or a named collection, optional expiry, revocable, hash-only unguessable token, read-only preview with attribution, "Save a copy to my household" with the photo copied and nothing private, signed-out minimal preview, optional text-only public preview, generic "not available" for every bad link, rate limits, Android share sheet + `familyrecipes://s/` + App Link `/s/`) and kids' mode (named kid profiles with no login, a picture-based "help pick dinner" vote of 3-6 meals, device-local parent PIN with lock-out, results as a soft planner preference). Owner steps: push migrations `20261021003000` and `20261021003010`; a new EAS build for the `/s/` App Link (no native module added, still 0.3.0 / versionCode 3). Not verified: a phone, real Supabase Storage policy, signed-out reading against real Supabase.
- **B Health**: **built by P3-B (D430-D439), web + Android:** optional per-person nutrition goals from six presets (more fibre, less salt, less sugar, more fruit and veg, more oily fish, less red and processed meat) with NHS adult reference values cited with page and review date, their own explicit withdrawable consent (special category, own rows only, withdrawal deletes), weekly progress from planned / cooked meals x the person's portion with "at least" for partial data, gentle swap hints, and an opt-in "nudge the plan towards my household's goals" (anonymous goal ids, soft solver term, off by default). No calorie or weight targets, nothing for children. Owner steps: push migrations `20261021003100` and `20261021003110`; review the consent wording / DPIA note (docs/security/DPIA-NUTRITION-GOALS.md). Not verified: a phone, the hosted project.
- **C Platform**: **built by P3-C (D440-D449), web + Android (the widget is Android-only by nature):** Android home-screen shopping widget (react-native-android-widget; ticks from the home screen go through the app's own command path and offline queue; cleared on sign-out); phone-as-scanner for a desktop session (QR code, short-lived hashed-token session bound to household + user, 10 minutes, one phone, revocable, only two anon-callable SQL functions, Realtime hint + poll, review before anything is saved; web phone page + Android screen); installable offline web shopping list (manifest + icons, service worker page cache, IndexedDB queue and snapshot with the same engine semantics as Android). Owner steps: push migration `20261021003200`, a new EAS build (0.4.0 / versionCode 4: widget module + App Link), App Links verification for `/scan/phone`, device checks (HANDOVER 9f). Not verified: the widget on a launcher, the QR scan and camera on a phone, an installed PWA offline on a phone, Realtime against the hosted project.

### Phase 4 - Later

- iOS (parked: owner chose Android-only); items from real use.

### Cross-cutting

- Every feature ships web + Android, or a documented reason (D310).
- Privacy consent for location, calendar and nutrition goals, included in data export.
- Docs updated per lane.
- One migration push + one zip per phase.

## Ideas backlog

Owner ideas first; others are maintainers' notes. Nothing here is committed scope.

- **Store aisles and in-store ordering** (owner idea, lane AS1): done on web and Android (D290-D299). Households define stores and aisles, place ingredients (or whole categories) per store, pick the shop on `/shopping` to see the list in aisle order; optional "learn from my route" (suggest only). Next: offline placement queue on Android, store maps/photos.
- **Pantry video scan** (owner idea): done (P2); next is measuring accuracy and adding barcode lookup.
- **TheMealDB recipe discovery** (owner idea, lane X1 in progress): browse/search an open recipe API, import selected recipes as drafts through the same review step; attribute the source; do not store without review; respect the API terms.
- **Continuous barcode scanning** (owner request, lane BS1): done on web (D270-D273) and Android hand-off (D274); phone-as-scanner for a desktop session is done (P3-C, D447-D449) and the beep is done (P0-D, D354); not done: measuring decode speed and hit rate on real phones.
- **Open Food Facts** (owner idea, lane X2 in progress): barcode/product lookup to fill pack sizes, brand and nutrition for pantry items and price packs; ODbL attribution; cache results per household.
- Receipts: retailer-specific parsers, loyalty-card price capture, split-bill for shared households.
- Planner: leftovers-aware plans, budget-first mode, batch-cooking suggestions, seasonal produce.
- Shopping: store-aisle ordering, multiple lists per week, shared notes.
- Nutrition: per-person goals done (P3-B); allergen/FSA traffic-light labels remain.
- Sharing: recipe export/import between households, public share links (needs privacy review).
- Platform: iOS via Expo (parked); push notifications for list changes (done, P1-C); PWA install and an offline shopping list (done, P3-C); offline for the other web screens is not built.
- Ops: staging App Service slot, Application Insights, scheduled DB backups, Playwright against the deployed app.
- LV1 follow-ups: live tests for receipts, price observations and per-household AI settings; confirm-then-mark-live in `lib/shopping/live.ts`; ingredient links for form-created recipes. (B1, D160-D164, fixed the sandbox import save, per-household in-memory recipes, 44px tap targets and the offline-race flake, which was a spec race.)
- Name and branding (owner decision pending; scope `@fr/*` is deliberately neutral).
