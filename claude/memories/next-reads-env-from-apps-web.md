Next.js loads .env* from apps/web/, not the repo root.

Put local overrides in apps/web/.env.local (ignored via the .env* rule). The root .env.example is documentation only. Turbo does not forward arbitrary root env files; shell environment variables do reach `pnpm dev`.
