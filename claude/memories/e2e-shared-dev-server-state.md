# e2e specs share one in-memory dev server

Playwright reuses the dev server on `E2E_PORT` (default 3100) when not CI. All app data is in memory per process. `globalSetup` (`e2e/support/global-setup.ts`) calls the dev-only `POST /api/dev/reset` (404 in production), warms routes in a real browser and runs one generate-from-plan, then resets again, so back-to-back runs on the same server pass.

- Isolation: specs that write shopping/plan/receipt data use a sandbox household cookie `fr_household=e2e-<id>` (mock-auth mode only); household A (the demo household) must keep an empty shopping list for the smoke spec.
- Seed data per test with `POST /api/dev/seed` (`{kind:'approved-plan', entries}` or `{kind:'shopping-item', name, value, unit}`) using `context.request` so the cookie applies.
- Reset the shared recipe store IN PLACE (`resetRecipeRepository`): the import sink holds the instance; replacing it splits the store.
- Cold dev server: keep workers at 4 (`E2E_WORKERS`); 16 workers starve on-demand compiles. `next.config.mjs` keeps compiled routes for an hour and ignores `.data`/`test-results` in the watcher; without that, files written during a run trigger rebuilds and 10-30 s server actions.
- Specs must not assume they are the only writers to the recipe store (import adds recipes).
