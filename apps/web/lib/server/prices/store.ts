import 'server-only';
import type { PriceObservation } from '@fr/domain';
import pricesJson from '@fr/refdata/prices.json';

/**
 * Shared in-memory price store (DECISIONS D34).
 *
 * Generic estimates come from `@fr/refdata` (built `data/out/prices.json`, no fs at runtime); receipts add
 * household-scoped `receipt` observations. Readers get both and let `@fr/engine/cost` rank them
 * (user_confirmed > receipt > retailer_verified > generic_estimate, then recency), so a receipt price
 * always beats the generic estimate. TODO(Supabase): price_observations table.
 */
export interface PriceStore {
  /** Generic estimates plus this household's own observations. */
  observationsFor(householdId: string, ingredientIds?: Iterable<string>): PriceObservation[];
  record(householdId: string, observations: readonly PriceObservation[]): void;
  reset(): void;
}

interface RefdataPrice extends PriceObservation {
  ingredientName?: string;
}

function generic(): PriceObservation[] {
  return (pricesJson as unknown as RefdataPrice[]).map(({ ingredientName: _n, ...o }) => o);
}

export class InMemoryPriceStore implements PriceStore {
  private readonly byHousehold = new Map<string, PriceObservation[]>();
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
  }

  reset(): void {
    this.byHousehold.clear();
  }
}

const KEY = Symbol.for('fr.prices.store');
type G = typeof globalThis & { [KEY]?: PriceStore };

/** Process-wide singleton shared by shopping (basket estimate) and receipts (observations). */
export function getPriceStore(): PriceStore {
  const g = globalThis as G;
  return (g[KEY] ??= new InMemoryPriceStore(generic()));
}
