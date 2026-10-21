// Manual spend entries and retailer -> store links (P2-B, D400, D403). One interface, an in-memory implementation (mock
// mode / tests) and a Supabase one (../supabase/money-repository.ts). Ids are generated here, never taken from clients.
import type { ManualSpend, SpendInput } from '../../money/types';

export class MoneyError extends Error {
  constructor(readonly code: 'not_found' | 'invalid', message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export interface MoneyRepository {
  listSpend(householdId: string, from: string, to: string): Promise<ManualSpend[]>;
  addSpend(householdId: string, input: SpendInput): Promise<ManualSpend>;
  updateSpend(householdId: string, id: string, input: SpendInput): Promise<ManualSpend>;
  deleteSpend(householdId: string, id: string): Promise<void>;
  /** normalised retailer text -> store id */
  links(householdId: string): Promise<Record<string, string>>;
  /** Link a retailer spelling to a store (the user confirmed it); `storeId = null` removes the link. */
  setLink(householdId: string, retailerKey: string, storeId: string | null): Promise<void>;
  reset(householdId?: string): void;
}

interface Slot { spend: ManualSpend[]; links: Record<string, string> }

export class InMemoryMoneyRepository implements MoneyRepository {
  private readonly slots = new Map<string, Slot>();
  constructor(
    private readonly newId: () => string = () => crypto.randomUUID(),
    /** Store ids that exist for a household (a spend entry or link may only name one of them). */
    private readonly hasStore: (householdId: string, storeId: string) => Promise<boolean> | boolean = () => true,
  ) {}

  private slot(h: string): Slot {
    let s = this.slots.get(h);
    if (!s) this.slots.set(h, (s = { spend: [], links: {} }));
    return s;
  }

  private async clean(h: string, i: SpendInput): Promise<Omit<ManualSpend, 'id'>> {
    if (i.storeId && !(await this.hasStore(h, i.storeId))) throw new MoneyError('invalid', 'That store does not belong to this household.');
    return { date: i.date, amountPence: i.amountPence, storeId: i.storeId ?? null, retailer: i.retailer ?? null, category: i.category ?? null, note: i.note ?? null };
  }

  async listSpend(h: string, from: string, to: string): Promise<ManualSpend[]> {
    return structuredClone(this.slot(h).spend.filter((e) => e.date >= from && e.date <= to).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)));
  }
  async addSpend(h: string, input: SpendInput): Promise<ManualSpend> {
    const e: ManualSpend = { id: this.newId(), ...(await this.clean(h, input)) };
    this.slot(h).spend.push(e);
    return structuredClone(e);
  }
  async updateSpend(h: string, id: string, input: SpendInput): Promise<ManualSpend> {
    const s = this.slot(h);
    const i = s.spend.findIndex((e) => e.id === id);
    if (i < 0) throw new MoneyError('not_found', 'That entry was not found.');
    s.spend[i] = { id, ...(await this.clean(h, input)) };
    return structuredClone(s.spend[i]!);
  }
  async deleteSpend(h: string, id: string): Promise<void> {
    const s = this.slot(h);
    s.spend = s.spend.filter((e) => e.id !== id);
  }
  async links(h: string): Promise<Record<string, string>> {
    return { ...this.slot(h).links };
  }
  async setLink(h: string, key: string, storeId: string | null): Promise<void> {
    if (!key) throw new MoneyError('invalid', 'No retailer to link.');
    const s = this.slot(h);
    if (storeId === null) { delete s.links[key]; return; }
    if (!(await this.hasStore(h, storeId))) throw new MoneyError('invalid', 'That store does not belong to this household.');
    s.links[key] = storeId;
  }
  /** A deleted store drops its links and clears spend references (mirrors the FKs). Called by the in-memory store book users. */
  forgetStore(h: string, storeId: string): void {
    const s = this.slot(h);
    for (const [k, v] of Object.entries(s.links)) if (v === storeId) delete s.links[k];
    for (const e of s.spend) if (e.storeId === storeId) e.storeId = null;
  }
  reset(h?: string): void {
    if (h) this.slots.delete(h);
    else this.slots.clear();
  }
}
