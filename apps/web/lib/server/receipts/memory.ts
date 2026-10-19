import household from '../../../../../e2e/fixtures/households/household-a.json';
import {
  receiptMatcher,
  toBase,
  type OutstandingItem,
  type PriceObservation,
  type PurchaseEvent,
  type Quantity,
} from '../../receipts/matcher';
import type { ReceiptListEntry, ReceiptRecord } from '../../receipts/types';
import type {
  OutstandingItemsSource,
  PantryEntry,
  PurchaseSink,
  ReceiptRepository,
} from './ports';

export const DEMO_HOUSEHOLD_ID: string = household.household.id;
export const DEMO_USER_ID: string = household.members[0]!.userId;

// ---------------------------------------------------------------------------
// Fixture: household-a shopping list (+ a few demo items so the mock receipt has something to match)
// ---------------------------------------------------------------------------

interface FixtureItem {
  id: string;
  displayName: string;
  quantity: Quantity;
}

/**
 * Extra demo items. The mock AI provider always returns the same receipt (lentils, onions, milk), none of
 * which are on household-a's list, so these let the mock flow produce real matches. Remove once receipts
 * are fed from the real shopping list.
 */
const DEMO_EXTRA_ITEMS: FixtureItem[] = [
  { id: 'a1a1a108-0000-4000-8000-0000000000e1', displayName: 'red lentils', quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' } },
  { id: 'a1a1a108-0000-4000-8000-0000000000e2', displayName: 'onions', quantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1 kg' } },
  { id: 'a1a1a108-0000-4000-8000-0000000000e3', displayName: 'semi skimmed milk', quantity: { kind: 'exact', value: 4, unit: 'l', originalText: '4 l' } },
];

export function fixtureOutstandingItems(): OutstandingItem[] {
  const base = (household.shoppingList.items as FixtureItem[]).map((i) => ({ id: i.id, displayName: i.displayName, quantity: i.quantity as Quantity }));
  return [...base, ...DEMO_EXTRA_ITEMS].map((i) => ({
    shoppingListItemId: i.id,
    name: i.displayName,
    aliases: [],
    outstanding: i.quantity,
  }));
}

// ---------------------------------------------------------------------------
// In-memory implementations
// ---------------------------------------------------------------------------

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly byId = new Map<string, ReceiptRecord>();

  async list(householdId: string): Promise<ReceiptListEntry[]> {
    return [...this.byId.values()]
      .filter((r) => r.householdId === householdId)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        retailer: r.retailer,
        date: r.date,
        totalPence: r.totalPence,
        status: r.status,
        lineCount: r.lines.length,
      }));
  }

  async get(householdId: string, id: string): Promise<ReceiptRecord | undefined> {
    const r = this.byId.get(id);
    return r && r.householdId === householdId ? structuredClone(r) : undefined;
  }

  async save(receipt: ReceiptRecord): Promise<void> {
    this.byId.set(receipt.id, structuredClone(receipt));
  }
}

/** Ledger of everything confirmed through receipts (stand-in for purchase_events / price history / pantry). */
export class InMemoryPurchaseSink implements PurchaseSink {
  readonly events: PurchaseEvent[] = [];
  readonly priceObservations: PriceObservation[] = [];
  readonly pantry: PantryEntry[] = [];

  async recordPurchases(events: PurchaseEvent[]): Promise<void> {
    for (const e of events) if (!this.events.some((x) => x.id === e.id)) this.events.push(structuredClone(e));
  }
  async recordPriceObservations(observations: PriceObservation[]): Promise<void> {
    this.priceObservations.push(...structuredClone(observations));
  }
  async addToPantry(entries: PantryEntry[]): Promise<void> {
    this.pantry.push(...structuredClone(entries));
  }
}

const BASE_UNIT = { mass: 'g', volume: 'ml', count: 'item' } as const;

/**
 * Outstanding = fixture items minus what the sink has recorded. Partial purchases reduce the outstanding
 * quantity (same dimension); anything not comparable is treated as fulfilled once any purchase exists.
 */
export class InMemoryOutstandingSource implements OutstandingItemsSource {
  constructor(
    private readonly items: OutstandingItem[],
    private readonly sink: InMemoryPurchaseSink,
  ) {}

  async list(): Promise<OutstandingItem[]> {
    const out: OutstandingItem[] = [];
    for (const item of this.items) {
      const bought = this.sink.events.filter((e) => e.shoppingListItemId === item.shoppingListItemId && !e.voidedBy);
      if (bought.length === 0) {
        out.push(item);
        continue;
      }
      const need = toBase(item.outstanding);
      if (!need) continue;
      let remaining = need.value;
      let comparable = true;
      for (const e of bought) {
        const b = toBase(e.quantity);
        if (!b || b.dim !== need.dim) comparable = false;
        else remaining -= b.value;
      }
      if (!comparable || remaining <= 1e-9) continue;
      out.push({
        ...item,
        outstanding: { kind: 'exact', value: remaining, unit: BASE_UNIT[need.dim], originalText: `${remaining} ${BASE_UNIT[need.dim]}` },
      });
    }
    return out;
  }
}

export interface MemoryServices {
  receipts: InMemoryReceiptRepository;
  purchases: InMemoryPurchaseSink;
  outstanding: InMemoryOutstandingSource;
}

export function createMemoryServices(items: OutstandingItem[] = fixtureOutstandingItems()): MemoryServices {
  const purchases = new InMemoryPurchaseSink();
  return { receipts: new InMemoryReceiptRepository(), purchases, outstanding: new InMemoryOutstandingSource(items, purchases) };
}

/** Past reconciled receipt so /receipts has history on first load. */
export async function seedDemoReceipts(repo: ReceiptRepository): Promise<void> {
  const parsed = receiptMatcher.parseLines(['TOMATO PUREE 140G 0.80', 'BASMATI RICE 1KG 2.10', 'GARLIC 0.45'], 'seed');
  const lines = parsed.items.map((l) => ({ ...l, match: { classification: 'none' as const, candidates: [] } }));
  await repo.save({
    id: 'seed-0001-example-supermarket',
    householdId: DEMO_HOUSEHOLD_ID,
    retailer: 'Example Supermarket',
    date: '2026-10-12',
    totalPence: 335,
    computedPence: 335,
    createdAt: '2026-10-12T18:30:00.000Z',
    status: 'reconciled',
    lines,
    orphanDiscountPence: 0,
    ignored: [],
    warnings: [],
    reconciliation: {
      at: '2026-10-12T18:35:00.000Z',
      purchaseEventIds: [],
      decisions: lines.map((l) => ({ lineId: l.id, outcome: 'extra' as const, addToPantry: false })),
    },
  });
}

const G = globalThis as unknown as { __frReceiptMemory?: MemoryServices };

/** Process-wide singleton (survives Next dev HMR and is shared by pages and server actions). */
export function getMemoryServices(): MemoryServices {
  if (!G.__frReceiptMemory) {
    const s = createMemoryServices();
    void seedDemoReceipts(s.receipts);
    G.__frReceiptMemory = s;
  }
  return G.__frReceiptMemory;
}
