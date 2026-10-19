import 'server-only';
import type { PriceObservation } from '@fr/domain';
import pricesJson from '@fr/refdata/prices.json';
import { getDataContext, useSupabaseBackend } from '../supabase/backend';
import { SupabasePriceStore } from '../supabase/price-store';

/**
 * Shared in-memory price store (DECISIONS D34).
 *
 * Generic estimates come from `@fr/refdata` (built `data/out/prices.json`, no fs at runtime); receipts add
 * household-scoped `receipt` observations. Readers get both and let `@fr/engine/cost` rank them
 * (user_confirmed > receipt > retailer_verified > generic_estimate, then recency), so a receipt price
 * always beats the generic estimate. With DATA_BACKEND=supabase the store is `SupabasePriceStore` (ingredient_prices, D124).
 */
export interface PriceStore {
  /** Generic estimates plus this household's own observations. */
  observationsFor(householdId: string, ingredientIds?: Iterable<string>): PriceObservation[];
  record(householdId: string, observations: readonly PriceObservation[]): void | Promise<void>;
  /** Async backends: load this household's observations before the sync reads below (no-op in memory). */
  refresh?(householdId: string): Promise<void>;
  reset(): void;
  /**
   * One household's recorded (non-generic) observations as a `lib/server/calc` PriceSource for that household's recipe cost
   * calculator (D101). Never spans households: a receipt price entered by one household cannot change another's costs.
   */
  asPriceSource(householdId: string): { observations(): readonly PriceObservation[]; version(): string };
}

interface RefdataPrice extends PriceObservation {
  ingredientName?: string;
}

function generic(): PriceObservation[] {
  return (pricesJson as unknown as RefdataPrice[]).map(({ ingredientName: _n, ...o }) => o);
}

export class InMemoryPriceStore implements PriceStore {
  private readonly byHousehold = new Map<string, PriceObservation[]>();
  private epoch = 0;
  private readonly versions = new Map<string, number>();
  constructor(private readonly generic: readonly PriceObservation[]) {}

  observationsFor(householdId: string, ingredientIds?: Iterable<string>): PriceObservation[] {
    const all = [...this.generic, ...(this.byHousehold.get(householdId) ?? [])];
    if (!ingredientIds) return all;
    const want = new Set(ingredientIds);
    return all.filter((o) => o.ingredientId !== undefined && want.has(o.ingredientId));
  }

  record(householdId: string, observations: readonly PriceObservation[]): void {
    const list = this.byHousehold.get(householdId) ?? [];
    list.push(...structuredClone(observations as PriceObservation[]));
    this.byHousehold.set(householdId, list);
    this.versions.set(householdId, (this.versions.get(householdId) ?? 0) + 1);
  }

  reset(): void {
    this.byHousehold.clear();
    this.versions.clear();
    this.epoch++;
  }

  asPriceSource(householdId: string) {
    return {
      observations: (): readonly PriceObservation[] => this.byHousehold.get(householdId) ?? [],
      version: () => `store:${this.epoch}:${this.versions.get(householdId) ?? 0}`,
    };
  }
}

const KEY = Symbol.for('fr.prices.store');
type G = typeof globalThis & { [KEY]?: PriceStore };

/** Process-wide singleton shared by shopping (basket estimate) and receipts (observations). Backend fixed per process. */
export function getPriceStore(): PriceStore {
  const g = globalThis as G;
  return (g[KEY] ??= useSupabaseBackend() ? new SupabasePriceStore(generic(), () => getDataContext()) : new InMemoryPriceStore(generic()));
}
