# @fr/engine/shopping — shopping state engine (lane L17a)

Pure, deterministic TS (originally lane L17a, merged into `packages/engine/src/shopping`).
`src/contract.ts` re-exports the shared contract shapes from `@fr/domain` (historical seed: `docs/history/CONTRACT-SEED.ts`).

Validate: `pnpm install && pnpm exec tsc --noEmit && pnpm exec vitest run`

| File | Purpose |
|---|---|
| `src/units.ts` | injected `UnitConverter` + `EngineContext`, quantity helpers |
| `src/model.ts` | `ShoppingItem`, `ShoppingState`, `Command` union, `CommandResult` |
| `src/derive.ts` | purchased / outstanding / status, active view, aisle grouping |
| `src/commands.ts` | `applyCommand(state, cmd, ctx)` — the only state transition |
| `src/sync.ts` | server log model, snapshot/cursor, client offline queue + resync |
| `SQL-NOTES.md` | Postgres `record_purchase` / log sketch for L1 |

## Semantics
- **Purchases are append-only `PurchaseEvent`s.** Purchased = sum of non-voided events converted to the
  item's base unit (unit of the first quantified required part). Undo appends a void record and sets
  `voidedBy`; events are never deleted.
- **Required** = requirement quantity + manual quantity. Ranges use `max`; `to_taste`/`unparsed` items are
  binary (any purchase = complete). Unconvertible parts go to `unresolvedRequired` / `unconvertedEvents`.
- **Status**: `outstanding` (nothing bought) / `partial` / `complete` (within 1e-6 relative) /
  `over_purchased`. `noLongerNeeded` = nothing required any more (plan dropped it or user removed it);
  with purchases this is "purchased, no longer needed". Active view shows only outstanding + partial.
- **Idempotency**: every command has a client-generated `commandId` (= PurchaseEvent id for tick/purchase,
  = void id for undo). A seen id (applied *or* rejected) is a no-op returning the original result.
- **Tick** = "I have the rest": records the outstanding quantity *at the time the server applies it*. If
  nothing is outstanding it is **rejected `already_complete`** with `completedBy` (who holds the active
  purchases) — so two shoppers ticking the same item yield one purchase + one UI-visible conflict.
  A rejected tick is final: undoing the winning purchase later does not resurrect it.
- **Purchase** (explicit quantity, e.g. partial or receipt) is always additive and may over-purchase;
  rejected only for invalid quantity or a unit not convertible to the item's unit.
- **Undo** of an already-voided event → `already_voided` (second undo is harmless).
- **Manual add** merges into a live item with the same key (ingredientId, else normalised name) when
  quantities combine; otherwise creates a new item. Edits are last-writer-wins in server order.
  Remove is soft; history kept.
- **Regenerate** replaces requirements by key, preserving purchases, manual qty, notes, aisle. Dropped
  plan items with purchases or manual qty stay; otherwise soft-removed (`reason: 'plan'`) and revived if
  the plan brings them back. User-removed items stay removed (requirement still tracked).
- **Sync**: server applies first-seen commands in arrival order and appends *all* (incl. rejections) to a
  `seq`-ordered log, so replaying snapshot + log reproduces state and outcomes exactly. Clients hold
  `confirmed` (+ `cursor`) and ordered `pending`; optimistic view = pending replayed over confirmed. On
  reconnect: resend pending (retries safe), ingest log since cursor; a seq gap sets `needsResync` →
  snapshot + since. Own rejected commands surface in `conflicts`.

## Status
Done: model, commands, derivation, grouping, sync, SQL sketch; 218 Vitest tests (15 unit + 3 sync +
200 seeded two-client interleaving/offline-replay/gap/duplicate fuzz cases) green, `tsc` clean.
Open for integrator: swap `contract.ts` for `@fr/domain`; plug real `UnitConverter` from engine core;
L1 to adopt `SQL-NOTES.md`.
