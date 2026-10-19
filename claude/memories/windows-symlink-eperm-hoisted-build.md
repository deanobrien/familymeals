Windows without Developer Mode cannot create symlinks: build the Azure package from a hoisted copy.

pnpm's default node_modules uses symlinks and Next's `output: 'standalone'` copies/traces them; both fail with EPERM on Windows without Developer Mode or admin. `scripts/package-appservice.ps1` therefore robocopies the repo to a short path (`%TEMP%\fr-appservice-build`) and installs there with `node-linker=hoisted` (real folders). Standalone output is opt-in (`NEXT_STANDALONE=1`, set only by the script) so a normal `pnpm build` never needs symlink rights (D153).
