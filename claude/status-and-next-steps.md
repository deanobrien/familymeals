# Status and next steps

**Date:** 2026-10-19. **Wave 0a done; merge batch 1 done** (L2a ui, L4 ai, L5 refdata, L6 qa fixtures/specs, app shell) - branch `prj018/w0a-skeleton`, uncommitted.

Verified by running (batch 1): install, build, typecheck, lint, test (10 turbo tasks), `pnpm test:e2e` (7 passed, 86 fixme-skipped).

**Merge batch 2 (engine)**: `@fr/engine` now holds L3, L7, L8, L9, L10, L17a, L22a (743 tests). Local UnitConverter variants replaced by `src/units/converter.ts`; L7 now treats a unitless count as `item` (priceable via unit weight, e.g. '2 carrots'). Open: swap `src/contract.ts` for `@fr/domain` after L1; receipt shape adaptation (INTEGRATION-NOTES section 1); PlanConstraints single schema.

## Next

1. Review and commit W0a (owner decision), then fan out Wave 0b lanes L1-L6 in worktrees.
2. Open owner decisions: Git host/remote, Supabase cloud project (London), Anthropic key, product name.
3. Supabase local stack not started or verified (Docker 20.10 may be too old); only config and the baseline migration exist.
4. No CI pipeline file yet (L6 wires CI).
