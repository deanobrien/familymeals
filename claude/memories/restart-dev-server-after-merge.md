Restart the dev server (and run pnpm install) after merging branches that add dependencies.

A running `next dev` / Playwright-reused server keeps its old module graph and node_modules resolution. After a merge that adds a package or workspace dependency, e2e and the browser fail with unresolved imports or stale behaviour until you run `pnpm install` and restart the server. Playwright reuses a server already on the port (`reuseExistingServer: !CI`), so kill it or use a fresh `E2E_PORT`.
