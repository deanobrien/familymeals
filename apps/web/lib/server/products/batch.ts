import 'server-only';
import { normaliseBarcode } from '@fr/product-sources';
import type { BatchEntry } from '@fr/engine/pantry';
import type { IngredientRef } from '../../pantry/scan-types';
import type { ProductLookupDto } from '../../products/types';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { lookupProduct, matchForProduct, type LookupOutcome } from './lookup';
import { getProductSnapshotStore } from './store';

/**
 * Batch product resolution for rapid barcode scanning (BS1, D272). Scanning 40 products in two minutes must not block the
 * camera on lookups, and must not trip Open Food Facts' per-IP limit (15 reads/min; D180-D181 cap the source at 10). So:
 *  - the client posts the codes it still wants, and polls;
 *  - a code already known resolves instantly: the household's own product snapshots first (its confirmed products, linked
 *    to the ingredient it chose), then an in-process LRU of recent lookups;
 *  - everything else joins a per-household FIFO queue drained by ONE worker that round-robins between households, so one
 *    household's 40 unknowns cannot starve another's, and the shared upstream allowance is spent at the source's own pace;
 *  - a rate-limited answer (retryable) is waited out and retried, never surfaced as a failure after one try.
 * State is in process memory (App Service runs one instance; with several, each has its own queue and the per-IP limit is
 * shared, same caveat as D181). Lookups are public product data: the LRU holds nothing about any household.
 */

export type BatchResult = BatchEntry<ProductLookupDto>;

export class LruCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  constructor(private readonly max: number, private readonly ttlMs: number, private readonly clock: () => number = Date.now) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= this.clock()) { this.map.delete(key); return undefined; }
    this.map.delete(key); // refresh recency
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V, ttlMs: number = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.clock() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}

type Cached = { kind: 'done'; lookup: ProductLookupDto } | { kind: 'notfound' };

export interface ResolverDeps {
  lookup(code: string): Promise<LookupOutcome>;
  /** The household's own confirmed product for this code, if any. */
  snapshot(householdId: string, code: string): Promise<ProductLookupDto | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Wait before retrying a rate-limited code. Default 6 s (the source's window is a minute for 10). */
  retryDelayMs?: number;
  /** Rate-limited attempts before the code is reported as a retryable failure. Default 12 (about a minute and a half). */
  maxAttempts?: number;
  cacheSize?: number;
  maxQueuePerHousehold?: number;
}

interface HouseholdState {
  queue: string[];
  failed: Map<string, { error: { code: string; message: string; retryable: boolean }; at: number }>;
  attempts: Map<string, number>;
}

const FAIL_TTL_MS = 30_000;

export class ProductBatchResolver {
  private readonly cache: LruCache<Cached>;
  private readonly households = new Map<string, HouseholdState>();
  private readonly order: string[] = [];
  private running = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly maxQueue: number;
  /** Resolves when the worker next goes idle (tests). */
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ResolverDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retryDelayMs = deps.retryDelayMs ?? 6000;
    this.maxAttempts = deps.maxAttempts ?? 12;
    this.maxQueue = deps.maxQueuePerHousehold ?? 120;
    this.cache = new LruCache<Cached>(deps.cacheSize ?? 500, 24 * 3600_000, this.now);
  }

  private state(hh: string): HouseholdState {
    let s = this.households.get(hh);
    if (!s) { s = { queue: [], failed: new Map(), attempts: new Map() }; this.households.set(hh, s); }
    return s;
  }

  pendingFor(householdId: string): number {
    return this.households.get(householdId)?.queue.length ?? 0;
  }

  /** Test helper: wait until the queue has drained. */
  async drain(): Promise<void> { await this.idle; }

  /** Resolve what can be resolved now, queue the rest. Never throws; every requested code gets an entry. */
  async resolve(householdId: string, codes: readonly string[], retry: readonly string[] = []): Promise<Record<string, BatchResult>> {
    const hh = this.state(householdId);
    const out: Record<string, BatchResult> = {};
    const retrySet = new Set(retry);
    for (const raw of codes) {
      const code = normaliseBarcode(String(raw ?? ''));
      if (!code) {
        out[String(raw)] = { status: 'error', error: { code: 'invalid_barcode', message: 'That is not a valid barcode.', retryable: false } };
        continue;
      }
      if (retrySet.has(code)) { hh.failed.delete(code); hh.attempts.delete(code); }
      const hit = this.cache.get(code);
      if (hit) { out[code] = hit.kind === 'done' ? { status: 'done', lookup: hit.lookup } : { status: 'notfound' }; continue; }
      const failed = hh.failed.get(code);
      if (failed && this.now() - failed.at < FAIL_TTL_MS) { out[code] = { status: 'error', error: failed.error }; continue; }
      if (failed) hh.failed.delete(code);
      if (hh.queue.includes(code)) { out[code] = { status: 'pending' }; continue; }
      let own: ProductLookupDto | null = null;
      try { own = await this.deps.snapshot(householdId, code); } catch { own = null; }
      if (own) { out[code] = { status: 'done', lookup: own }; continue; }
      if (hh.queue.length >= this.maxQueue) {
        out[code] = { status: 'error', error: { code: 'rate_limited', message: 'Too many lookups waiting. They will clear in a few minutes; try again then.', retryable: true } };
        continue;
      }
      hh.queue.push(code);
      out[code] = { status: 'pending' };
    }
    if (Object.values(out).some((e) => e.status === 'pending')) this.kick();
    return out;
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.idle = this.work();
  }

  /** Next (household, code): round-robin so every household with work gets a turn. */
  private next(): { hh: string; code: string } | null {
    for (const id of [...this.households.keys()]) if (!this.order.includes(id)) this.order.push(id);
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order.shift()!;
      this.order.push(id);
      const s = this.households.get(id);
      const code = s?.queue[0];
      if (code) return { hh: id, code };
    }
    return null;
  }

  private async work(): Promise<void> {
    try {
      await this.loop();
    } catch {
      this.running = false; // an unexpected throw: let the next resolve() restart the worker
    }
  }

  private async loop(): Promise<void> {
    for (let job = this.next(); job; job = this.next()) {
      const s = this.state(job.hh);
      const done = () => { s.queue = s.queue.filter((c) => c !== job.code); s.attempts.delete(job.code); };
      // Another household (or an earlier request) may have fetched it meanwhile: no upstream call needed.
      if (this.cache.get(job.code)) { done(); continue; }
      let out: LookupOutcome;
      try { out = await this.deps.lookup(job.code); } catch { out = { ok: false, status: 502, error: { code: 'upstream', message: 'The product lookup failed.', retryable: true } }; }
      if (out.ok) { this.cache.set(job.code, { kind: 'done', lookup: out.lookup }); done(); continue; }
      if (out.error.code === 'not_found') { this.cache.set(job.code, { kind: 'notfound' }, 3600_000); done(); continue; }
      if (out.error.code === 'rate_limited') {
        const n = (s.attempts.get(job.code) ?? 0) + 1;
        s.attempts.set(job.code, n);
        if (n < this.maxAttempts) { await this.sleep(this.retryDelayMs); continue; } // stays at the head of its queue
        s.failed.set(job.code, { error: { ...out.error, message: 'Open Food Facts is busy. Try this one again in a minute.' }, at: this.now() });
        done();
        continue;
      }
      s.failed.set(job.code, { error: out.error, at: this.now() });
      done();
    }
    this.running = false; // synchronous with the loop ending: a resolve() racing the exit restarts the worker
  }
}

// ---- production wiring ----

const KEY = Symbol.for('fr.products.batchResolver');
type G = typeof globalThis & { [KEY]?: ProductBatchResolver };

/** The household's snapshot as a lookup: linked to the ingredient they chose when they have one. */
export async function householdSnapshotLookup(householdId: string, code: string): Promise<ProductLookupDto | null> {
  const store = getProductSnapshotStore();
  await store.refresh?.(householdId);
  const snap = store.list(householdId).find((s) => s.barcode === code);
  if (!snap) return null;
  const cat = getIngredientCatalogue();
  const linked = snap.ingredientId ? cat.get(snap.ingredientId) : undefined;
  const ref: IngredientRef | undefined = linked ? { id: linked.id, name: linked.name, category: linked.category } : undefined;
  return {
    product: snap.product,
    match: ref ? { status: 'matched', ingredient: ref } : matchForProduct(snap.product, cat),
    provider: { id: 'household', isMock: false },
  };
}

export function getBatchResolver(): ProductBatchResolver {
  const g = globalThis as G;
  return (g[KEY] ??= new ProductBatchResolver({ lookup: (code) => lookupProduct(code), snapshot: householdSnapshotLookup }));
}

export function setBatchResolverForTests(r: ProductBatchResolver | undefined): void {
  (globalThis as G)[KEY] = r;
}

// ---- request-rate guard for the polling endpoint (separate from the upstream allowance) ----
const polls = new Map<string, number[]>();
const POLLS_PER_MINUTE = 150;
export function withinPollRate(key: string, now: number = Date.now()): boolean {
  const recent = (polls.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= POLLS_PER_MINUTE) { polls.set(key, recent); return false; }
  recent.push(now);
  polls.set(key, recent);
  return true;
}
export const resetPollRate = (): void => polls.clear();
