// Storage for leftover batches and their consumption ledger (P2-C, D416-D419). Supabase as the signed-in user (RLS) or an
// in-memory demo store with identical behaviour (idempotent keys, never more than is left).
import type { SupabaseClient } from '@supabase/supabase-js';
import { portionsLeft, type ConsumptionKind, type LeftoverBatch, type LeftoverConsumption } from '@fr/engine/leftovers';

export class LeftoverStoreError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_input' | 'not_enough' | 'not_found' | 'unknown') {
    super(code);
    this.name = 'LeftoverStoreError';
  }
}

export type TakeOutcome = 'applied' | 'duplicate';

export interface LeftoverStore {
  listBatches(householdId: string): Promise<LeftoverBatch[]>;
  listConsumptions(householdId: string): Promise<LeftoverConsumption[]>;
  /** Idempotent on `sourceKey` (one batch per cooked event): returns the existing batch when the key was used. */
  createBatch(householdId: string, userId: string, batch: LeftoverBatch, sourceKey?: string): Promise<{ batch: LeftoverBatch; created: boolean }>;
  updateStorage(householdId: string, batch: LeftoverBatch): Promise<void>;
  deleteBatch(householdId: string, id: string): Promise<void>;
  /** Take portions once per key; never more than is left. */
  take(householdId: string, userId: string, c: { batchId: string; key: string; portions: number; kind: ConsumptionKind }): Promise<TakeOutcome>;
}

type Row = Record<string, unknown>;

function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new LeftoverStoreError('forbidden');
  if (code === '23514') throw new LeftoverStoreError('not_enough');
  if (code === '22P02' || code === '23502') throw new LeftoverStoreError('invalid_input');
  if (code === '23503') throw new LeftoverStoreError('not_found');
  throw new LeftoverStoreError('unknown');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) fail(error);
  return data;
}

const toBatch = (r: Row): LeftoverBatch => ({
  id: String(r.id), title: String(r.title), ...(r.recipe_id ? { recipeId: String(r.recipe_id) } : {}),
  portionsMade: Number(r.portions_made), storedIn: r.stored_in === 'freezer' ? 'freezer' : 'fridge', cookedOn: String(r.cooked_on), useBy: String(r.use_by),
});

export class SupabaseLeftoverStore implements LeftoverStore {
  constructor(private readonly db: SupabaseClient) {}

  async listBatches(h: string): Promise<LeftoverBatch[]> {
    const rows = await run<Row[]>(this.db.from('leftover_batches').select('id, title, recipe_id, portions_made, stored_in, cooked_on, use_by').eq('household_id', h).order('use_by', { ascending: true }));
    return (rows ?? []).map(toBatch);
  }

  async listConsumptions(h: string): Promise<LeftoverConsumption[]> {
    const rows = await run<Row[]>(this.db.from('leftover_consumptions').select('batch_id, consume_key, portions, kind').eq('household_id', h));
    return (rows ?? []).map((r) => ({ batchId: String(r.batch_id), key: String(r.consume_key), portions: Number(r.portions), kind: r.kind === 'discarded' ? 'discarded' : 'eaten' }));
  }

  async createBatch(h: string, userId: string, b: LeftoverBatch, sourceKey?: string): Promise<{ batch: LeftoverBatch; created: boolean }> {
    if (sourceKey) {
      const existing = await run<Row[]>(this.db.from('leftover_batches').select('id, title, recipe_id, portions_made, stored_in, cooked_on, use_by').eq('household_id', h).eq('source_key', sourceKey));
      if (existing?.[0]) return { batch: toBatch(existing[0]), created: false };
    }
    const row = { id: b.id, household_id: h, recipe_id: b.recipeId ?? null, title: b.title, portions_made: b.portionsMade, stored_in: b.storedIn, cooked_on: b.cookedOn, use_by: b.useBy, source_key: sourceKey ?? null, created_by: userId };
    const { error } = await this.db.from('leftover_batches').insert(row);
    if (error) {
      // A concurrent request with the same key won: hand back its batch.
      if ((error as { code?: string }).code === '23505' && sourceKey) {
        const again = await run<Row[]>(this.db.from('leftover_batches').select('id, title, recipe_id, portions_made, stored_in, cooked_on, use_by').eq('household_id', h).eq('source_key', sourceKey));
        if (again?.[0]) return { batch: toBatch(again[0]), created: false };
      }
      fail(error);
    }
    return { batch: b, created: true };
  }

  async updateStorage(h: string, b: LeftoverBatch): Promise<void> {
    await run(this.db.from('leftover_batches').update({ stored_in: b.storedIn, cooked_on: b.cookedOn, use_by: b.useBy }).eq('household_id', h).eq('id', b.id));
  }

  async deleteBatch(h: string, id: string): Promise<void> {
    await run(this.db.from('leftover_batches').delete().eq('household_id', h).eq('id', id));
  }

  async take(h: string, userId: string, c: { batchId: string; key: string; portions: number; kind: ConsumptionKind }): Promise<TakeOutcome> {
    // A retry after the first apply used up the batch would trip the "enough left" guard before the unique key: look first.
    const seen = await run<Row[]>(this.db.from('leftover_consumptions').select('consume_key').eq('household_id', h).eq('batch_id', c.batchId).eq('consume_key', c.key));
    if (seen?.length) return 'duplicate';
    const { error } = await this.db.from('leftover_consumptions').insert({ batch_id: c.batchId, household_id: h, consume_key: c.key, portions: c.portions, kind: c.kind, created_by: userId });
    if (!error) return 'applied';
    if ((error as { code?: string }).code === '23505') return 'duplicate'; // the same key was already applied
    return fail(error);
  }
}

interface MemHousehold { batches: Map<string, LeftoverBatch>; keys: Map<string, string>; consumptions: LeftoverConsumption[] }
const g = globalThis as { __frLeftoverMemory?: Map<string, MemHousehold> };
const map = (): Map<string, MemHousehold> => (g.__frLeftoverMemory ??= new Map());
const mem = (h: string): MemHousehold => {
  let m = map().get(h);
  if (!m) map().set(h, (m = { batches: new Map(), keys: new Map(), consumptions: [] }));
  return m;
};

export function resetMemoryLeftovers(): void {
  g.__frLeftoverMemory = undefined;
}

export class MemoryLeftoverStore implements LeftoverStore {
  async listBatches(h: string): Promise<LeftoverBatch[]> {
    return [...mem(h).batches.values()].map((b) => ({ ...b })).sort((a, b) => a.useBy.localeCompare(b.useBy));
  }
  async listConsumptions(h: string): Promise<LeftoverConsumption[]> {
    return mem(h).consumptions.map((c) => ({ ...c }));
  }
  async createBatch(h: string, _userId: string, b: LeftoverBatch, sourceKey?: string): Promise<{ batch: LeftoverBatch; created: boolean }> {
    const m = mem(h);
    if (sourceKey && m.keys.has(sourceKey)) return { batch: { ...m.batches.get(m.keys.get(sourceKey)!)! }, created: false };
    m.batches.set(b.id, { ...b });
    if (sourceKey) m.keys.set(sourceKey, b.id);
    return { batch: { ...b }, created: true };
  }
  async updateStorage(h: string, b: LeftoverBatch): Promise<void> {
    const m = mem(h);
    const cur = m.batches.get(b.id);
    if (cur) m.batches.set(b.id, { ...cur, storedIn: b.storedIn, cookedOn: b.cookedOn, useBy: b.useBy });
  }
  async deleteBatch(h: string, id: string): Promise<void> {
    const m = mem(h);
    m.batches.delete(id);
    m.consumptions = m.consumptions.filter((c) => c.batchId !== id);
  }
  async take(h: string, _userId: string, c: { batchId: string; key: string; portions: number; kind: ConsumptionKind }): Promise<TakeOutcome> {
    const m = mem(h);
    const b = m.batches.get(c.batchId);
    if (!b) throw new LeftoverStoreError('not_found');
    if (m.consumptions.some((x) => x.batchId === c.batchId && x.key === c.key)) return 'duplicate';
    if (c.portions > portionsLeft(b, m.consumptions)) throw new LeftoverStoreError('not_enough');
    m.consumptions.push({ ...c });
    return 'applied';
  }
}
