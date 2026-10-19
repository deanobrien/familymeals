/**
 * @fr/domain — PRJ-018 zod schemas + inferred TS types.
 *   primitives  units, Quantity, enums (CONTRACT-SEED names)
 *   contract    CONTRACT-SEED shapes (CanonicalIngredient, Requirement, PurchaseEvent, ...)
 *   entities    one row schema per table/view in migrations/
 *   rpc         SQL RPC inputs/results (invitations, record_purchase, ...)
 *   db-mapping  snake_case row <-> camelCase domain, quantity column folding
 */
export * from './primitives';
export * from './contract';
export * from './entities';
export * from './rpc';
export * from './db-mapping';
export * from './placeholder';
export * from './receipt';
export * from './plan-constraints';
