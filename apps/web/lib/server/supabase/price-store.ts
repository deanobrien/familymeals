// Supabase PriceStore (lane S2, D124). The calculator and basket estimate read prices synchronously, so the household's
// observations (`household_price_observations`: own user_confirmed + receipt rows, shared retailer_verified rows) are
// loaded into a per-household cache by `refresh()` (called before costing) and served from it. The engine ranks them
// (user_confirmed > receipt > retailer_verified > generic_estimate, then recency) above the refdata generic estimates.
// `record()` writes through `record_price_observations` (idempotent per source + ingredient) and invalidates the cache.
import 'server-only';
import { PriceObservation, quantityFromColumns } from '@fr/domain';
import type { PriceStore } from '../prices/store';
import type { DataContext } from './backend';
import { callRpc } from './rpc';

type Row = Record<string, unknown>;

/** A DB price row -> PriceObservation, or null when it does not satisfy the domain contract. */
export function observationFromRow(row: Row): PriceObservation | null {
  const parsed = PriceObservation.safeParse({
    ingredientId: row.ingredient_id ?? undefined,
    ...(row.product_pack_id ? { productPackId: row.product_pack_id } : {}),
    ...(row.retailer ? { retailer: row.retailer } : {}),
    pricePence: Number(row.price_pence),
    packQuantity: quantityFromColumns(row),
    kind: row.kind,
    observedOn: String(row.observed_on ?? '').slice(0, 10),
    source: row.source,
  });
  return parsed.success ? parsed.data : null;
}

/** `receipt:<receiptId>:<lineId>` -> lineId (the FK a receipt price must carry). */
export const receiptLineOf = (source: string): string | undefined => /^receipt:[^:]+:([^:]+)$/.exec(source)?.[1];

export function observationToRpc(o: PriceObservation): Row | null {
  const q = o.packQuantity;
  if (!o.ingredientId || (o.kind !== 'receipt' && o.kind !== 'user_confirmed')) return null;
  if ((q.kind !== 'exact' && q.kind !== 'approximate') || typeof q.value !== 'number' || !q.unit) return null;
  const receiptLineId = o.kind === 'receipt' ? receiptLineOf(o.source) : undefined;
  if (o.kind === 'receipt' && !receiptLineId) return null;
  return {
    ingredientId: o.ingredientId, retailer: o.retailer ?? null, pricePence: o.pricePence,
    quantity: { kind: q.kind, value: Math.round(q.value * 1000) / 1000, unit: q.unit, approxLabel: q.approxLabel ?? null, originalText: q.originalText },
    kind: o.kind, observedOn: o.observedOn, source: o.source, receiptLineId: receiptLineId ?? null,
  };
}

interface Entry { obs: PriceObservation[]; key: string; version: number; loadedAt: number }

export class SupabasePriceStore implements PriceStore {
  private readonly cache = new Map<string, Entry>();
  private readonly versions = new Map<string, number>();
  private epoch = 0;

  constructor(
    private readonly generic: readonly PriceObservation[],
    private readonly resolve: () => Promise<DataContext>,
    private readonly ttlMs = 15_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private async ctxFor(householdId: string): Promise<DataContext> {
    const ctx = await this.resolve();
    if (ctx.householdId !== householdId) throw new Error('price store: household does not match the session');
    return ctx;
  }

  /** Load (or keep, within the TTL) this household's observations. The version only moves when the content changes. */
  async refresh(householdId: string, force = false): Promise<void> {
    const cur = this.cache.get(householdId);
    if (!force && cur && this.clock() - cur.loadedAt < this.ttlMs) return;
    const ctx = await this.ctxFor(householdId);
    const rows = (await callRpc<Row[]>(ctx.client, 'household_price_observations', { p_household_id: householdId })) ?? [];
    const obs = rows.map(observationFromRow).filter((o): o is PriceObservation => o !== null);
    const key = JSON.stringify(obs);
    if (cur && cur.key === key) {
      cur.loadedAt = this.clock();
      return;
    }
    const version = (this.versions.get(householdId) ?? 0) + 1;
    this.versions.set(householdId, version);
    this.cache.set(householdId, { obs, key, version, loadedAt: this.clock() });
  }

  observationsFor(householdId: string, ingredientIds?: Iterable<string>): PriceObservation[] {
    const all = [...this.generic, ...(this.cache.get(householdId)?.obs ?? [])];
    if (!ingredientIds) return all;
    const want = new Set(ingredientIds);
    return all.filter((o) => o.ingredientId !== undefined && want.has(o.ingredientId));
  }

  async record(householdId: string, observations: readonly PriceObservation[]): Promise<void> {
    const items = observations.map(observationToRpc).filter((x): x is Row => x !== null);
    if (items.length === 0) return;
    const ctx = await this.ctxFor(householdId);
    await callRpc(ctx.client, 'record_price_observations', { p_household_id: householdId, p_items: items });
    await this.refresh(householdId, true);
  }

  reset(): void {
    this.cache.clear();
    this.versions.clear();
    this.epoch++;
  }

  asPriceSource(householdId: string) {
    return {
      observations: (): readonly PriceObservation[] => this.cache.get(householdId)?.obs ?? [],
      version: () => `db:${this.epoch}:${this.cache.get(householdId)?.version ?? 0}`,
    };
  }
}
