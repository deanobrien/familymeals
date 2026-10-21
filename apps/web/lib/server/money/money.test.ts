import { describe, expect, it } from 'vitest';
import type { CanonicalIngredient, PriceObservation, Quantity, Unit } from '@fr/domain';
import type { ListNeed } from '@fr/engine/money';
import type { ReceiptRecord } from '../../receipts/types';
import type { StoreRef } from '../../money/types';
import { plannedWeekFor } from './planned';
import { createPriceService } from './prices';
import { InMemoryMoneyRepository } from './repository';
import { createSpendingService, receiptRecord } from './spending';

const H = 'hh-1';
const ING = 'a0000000-0000-4000-8000-000000000001';
const MILK = 'a0000000-0000-4000-8000-000000000002';
const stores: StoreRef[] = [{ id: 's-tesco', name: 'Tesco', chain: 'Tesco' }, { id: 's-aldi', name: 'ALDI Gosforth', chain: 'ALDI' }];
const q = (value: number, unit: Unit): Quantity => ({ kind: 'exact', value, unit, originalText: `${value} ${unit}` });

const receipt = (o: Partial<ReceiptRecord> & { id: string }): ReceiptRecord => ({
  householdId: H, computedPence: 0, createdAt: '2026-10-10T12:00:00.000Z', status: 'reconciled', lines: [], orphanDiscountPence: 0, ignored: [], warnings: [], ...o,
});
const line = (description: string, netPence: number) => ({ id: description, raw: description, tokens: [], description, count: 1, discountPence: 0, discountLines: [], netPence, match: { classification: 'none', candidates: [] } }) as unknown as ReceiptRecord['lines'][number];

function spendingFixture(receipts: ReceiptRecord[], opts: { budget?: number | null; now?: string } = {}) {
  const repo = new InMemoryMoneyRepository();
  const svc = createSpendingService({
    repo,
    receipts: { reconciledBetween: async (_h, from, to) => receipts.filter((r) => r.status === 'reconciled' && (r.date ?? r.createdAt.slice(0, 10)) >= from && (r.date ?? r.createdAt.slice(0, 10)) <= to) },
    stores: async () => stores,
    plannedWeeks: async () => [{ weekStart: '2026-10-19', pence: 6500, partial: true, uncostedMeals: 1, meals: 5 }],
    weeklyBudgetPence: async () => (opts.budget === undefined ? 8000 : opts.budget),
    categoryOf: (d) => (/milk|cheese/i.test(d) ? 'Dairy & eggs' : /apple/i.test(d) ? 'Fruit & veg' : undefined),
    now: () => new Date(opts.now ?? '2026-10-21T10:00:00Z'),
  });
  return { svc, repo };
}

describe('spending service', () => {
  const receipts = [
    receipt({ id: 'r1', retailer: 'TESCO EXTRA', date: '2026-10-20', totalPence: 3000, computedPence: 3000, lines: [line('MILK 2L', 1000), line('APPLES', 500)] }),
    receipt({ id: 'r2', retailer: 'ALDI', date: '2026-10-13', totalPence: 2000, lines: [line('CHEESE', 2200)] }), // lines add up to more than the total
    receipt({ id: 'r3', retailer: 'Co-op', createdAt: '2026-10-21T08:00:00Z', totalPence: undefined, computedPence: 450, lines: [] }), // no printed date or total
    receipt({ id: 'r4', retailer: 'Old', date: '2026-10-19', totalPence: 100, status: 'needs_review' }), // not confirmed: never counted
  ];

  it('counts only confirmed receipts plus manual entries as actual, planned stays an estimate', async () => {
    const { svc } = spendingFixture(receipts);
    await svc.addSpend(H, { date: '2026-10-21', amountPence: 550, retailer: 'Market stall', category: 'Fruit & veg' });
    const v = await svc.spending(H, { weeks: 4 });
    const thisWeek = v.thisWeek!;
    expect(thisWeek.weekStart).toBe('2026-10-19');
    expect(thisWeek).toMatchObject({ receiptsPence: 3000 + 450, manualPence: 550, actualPence: 4000, plannedPence: 6500, plannedPartial: true, actualStatus: 'so_far_within', varianceToBudgetPence: -4000 });
    expect(v.weeks.find((w) => w.weekStart === '2026-10-12')).toMatchObject({ actualPence: 2000, actualStatus: 'under' });
    expect(v.totals).toMatchObject({ actualPence: 6000, receiptsPence: 5450, manualPence: 550, plannedPence: 6500, plannedPartial: true, plannedWeeks: 1 });
    expect(v.usedScanDate).toBe(1);
    expect(v.recent.map((r) => r.id)).not.toContain('r4');
  });

  it('categories add up to the money spent: unknown lines and the remainder are Uncategorised, over-counts scaled', async () => {
    const { svc } = spendingFixture(receipts);
    const v = await svc.spending(H, { weeks: 4 });
    expect(v.categories.reduce((t, c) => t + c.pence, 0)).toBe(v.totals.actualPence);
    expect(v.categories.find((c) => c.category === 'Dairy & eggs')?.pence).toBe(1000 + 2000); // r2's 2200 of cheese scaled to its 2000 total
    expect(v.categories.at(-1)?.category).toBe('Uncategorised');
  });

  it('shows retailers that are not linked to a store with a suggestion, and honours a confirmed link', async () => {
    const { svc } = spendingFixture(receipts);
    let v = await svc.spending(H, { weeks: 4 });
    const byKey = Object.fromEntries(v.unlinked.map((u) => [u.key, u]));
    expect(byKey['tesco extra']?.suggestion?.id).toBe('s-tesco');
    expect(byKey['aldi']?.suggestion?.id).toBe('s-aldi');
    expect(byKey['co op']?.suggestion).toBeNull();
    expect(v.shops.map((s) => s.shop)).toContain('TESCO EXTRA'); // not linked yet: the printed name
    await svc.linkRetailer(H, 'TESCO EXTRA', 's-tesco');
    v = await svc.spending(H, { weeks: 4 });
    expect(v.unlinked.map((u) => u.key)).not.toContain('tesco extra');
    expect(v.shops.map((s) => s.shop)).toContain('Tesco');
    await svc.linkRetailer(H, 'TESCO EXTRA', null);
    expect((await svc.spending(H, { weeks: 4 })).unlinked.map((u) => u.key)).toContain('tesco extra');
    const st = await svc.retailerStatus(H, 'TESCO EXTRA');
    expect(st.linked).toBeNull();
    expect(st.suggestion?.name).toBe('Tesco');
  });

  it('a retailer whose text is exactly a store name needs no confirmation', async () => {
    const { svc } = spendingFixture([receipt({ id: 'r9', retailer: 'Tesco', date: '2026-10-20', totalPence: 100 })]);
    const v = await svc.spending(H, { weeks: 2 });
    expect(v.unlinked).toEqual([]);
    expect((await svc.retailerStatus(H, 'tesco')).linked?.id).toBe('s-tesco');
  });

  it('no budget set is reported, not invented', async () => {
    const { svc } = spendingFixture(receipts, { budget: null });
    const v = await svc.spending(H, { weeks: 4 });
    expect(v.weeklyBudgetPence).toBeNull();
    expect(v.thisWeek?.actualStatus).toBe('no_budget');
    expect(v.months[0]?.budgetPence).toBeNull();
  });

  it('exports CSV with one row per category that adds up, formulas defused', async () => {
    const { svc } = spendingFixture([receipt({ id: 'r1', retailer: '=cmd()', date: '2026-10-20', totalPence: 1000, lines: [line('MILK', 400)] })]);
    await svc.addSpend(H, { date: '2026-10-21', amountPence: 250, note: 'cash, market' });
    const csv = await svc.csv(H, { weeks: 4 });
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe('Date,Week starting,Source,Shop,Category,Amount (GBP),Note');
    expect(rows).toContain("2026-10-20,2026-10-19,Receipt,'=cmd(),Dairy & eggs,4.00,");
    expect(rows).toContain("2026-10-20,2026-10-19,Receipt,'=cmd(),Uncategorised,6.00,");
    expect(rows).toContain('2026-10-21,2026-10-19,Manual entry,,Uncategorised,2.50,"cash, market"');
  });

  it('uses UK dates: a late-Sunday UTC scan in summer lands in the new week', async () => {
    // 23:30 UTC Sunday 7 June 2026 is 00:30 Monday 8 June in London
    const r = receiptRecord(receipt({ id: 'x', createdAt: '2026-06-07T23:30:00Z', totalPence: 500, retailer: 'Co-op' }), 'Co-op', () => undefined);
    expect(r?.date).toBe('2026-06-08');
    const { svc } = spendingFixture([], { now: '2026-06-07T23:30:00Z' });
    expect((await svc.spending(H, { weeks: 1 })).today).toBe('2026-06-08'); // "today" is Monday in London
  });
});


describe('price service', () => {
  const ingredients: CanonicalIngredient[] = [
    { id: ING, name: 'Basmati rice', category: 'pasta_rice_grains', aliases: [] },
    { id: MILK, name: 'Milk', category: 'dairy_eggs', aliases: [], densityGPerMl: { value: 1.03, source: 'test' } },
  ];
  const obs = (o: Partial<PriceObservation> & { pricePence: number; packQuantity: Quantity }): PriceObservation =>
    ({ ingredientId: ING, kind: 'receipt', observedOn: '2026-10-15', source: `r:${Math.random()}`, retailer: 'ALDI', ...o });

  function fixture(observations: PriceObservation[], needs: ListNeed[] = []) {
    const recorded: PriceObservation[] = [];
    const svc = createPriceService({
      observations: async () => [...observations, ...recorded],
      ingredient: (id) => ingredients.find((i) => i.id === id),
      ingredientsFor: () => ingredients,
      stores: async () => stores,
      links: async () => ({}),
      listNeeds: async () => needs,
      record: async (_h, o) => { recorded.push(...o); },
      newId: () => 'fixed-id',
      now: () => new Date('2026-10-21T10:00:00Z'),
    });
    return { svc, recorded };
  }

  it('gives badges and per-shop totals with coverage for the list', async () => {
    const { svc } = fixture(
      [
        obs({ pricePence: 150, packQuantity: q(500, 'g') }), // ALDI 3.00/kg
        obs({ pricePence: 230, packQuantity: q(1, 'kg'), retailer: 'LIDL' }), // 2.30/kg
        obs({ pricePence: 100, packQuantity: q(2, 'l'), ingredientId: MILK, retailer: 'ALDI' }),
      ],
      [
        { id: 'i-rice', name: 'rice', ingredientId: ING, outstanding: 1000, unit: 'g', quantified: true },
        { id: 'i-milk', name: 'milk', ingredientId: MILK, outstanding: 2, unit: 'l', quantified: true },
        { id: 'i-x', name: 'saffron', outstanding: 1, quantified: true },
      ],
    );
    const v = await svc.listComparison(H);
    expect(Object.keys(v.badges)).toEqual(['i-rice']);
    expect(v.badges['i-rice']).toMatchObject({ cheapestShop: 'LIDL', unitText: '£2.30 per kg', tied: false });
    expect(v.badges['i-rice']!.text).toBe('Cheapest at LIDL: £2.30 per kg (6 days ago)');
    const aldi = v.shops.find((s) => s.label === 'ALDI')!;
    expect(aldi).toMatchObject({ pricedItems: 2, coveragePct: 67, totalPence: 300 + 100, missing: ['saffron'] });
    expect(v.likeForLike?.itemNames).toEqual(['rice']);
    expect(v.likeForLike?.cheapest).toBe('LIDL');
  });

  it('history lists every observation with the shop comparison', async () => {
    const { svc } = fixture([
      obs({ pricePence: 150, packQuantity: q(500, 'g'), observedOn: '2026-10-01' }),
      obs({ pricePence: 160, packQuantity: q(500, 'g'), observedOn: '2026-10-18' }),
      obs({ pricePence: 230, packQuantity: q(1, 'kg'), retailer: 'LIDL' }),
    ]);
    const h = (await svc.history(H, ING))!;
    expect(h.name).toBe('Basmati rice');
    expect(h.history.map((x) => x.pricePence)).toEqual([160, 230, 150]);
    expect(h.comparison.shops.find((s) => s.label === 'ALDI')).toMatchObject({ pricePence: 160, count: 2, unitText: '£3.20 per kg', cheapest: false });
    expect(h.comparison.shops.find((s) => s.label === 'LIDL')?.cheapest).toBe(true);
    expect(await svc.history(H, 'nope')).toBeNull();
  });

  it('records a price you saw as user_confirmed, at a store or a named shop, and validates it', async () => {
    const { svc, recorded } = fixture([]);
    expect(await svc.addPrice(H, { ingredientId: ING, storeId: 's-tesco', pricePence: 120, packValue: 500, packUnit: 'g' })).toEqual({ ok: true });
    expect(recorded[0]).toMatchObject({ ingredientId: ING, retailer: 'Tesco', pricePence: 120, kind: 'user_confirmed', observedOn: '2026-10-21', source: 'manual:fixed-id' });
    expect(recorded[0]!.packQuantity).toMatchObject({ kind: 'exact', value: 500, unit: 'g' });
    expect(await svc.addPrice(H, { ingredientId: ING, retailer: ' Co-op ', pricePence: 99, packValue: 1, packUnit: 'kg', observedOn: '2026-10-01' })).toEqual({ ok: true });
    expect(recorded[1]!.retailer).toBe('Co-op');
    const bad = async (o: Partial<Parameters<typeof svc.addPrice>[1]>) =>
      svc.addPrice(H, { ingredientId: ING, storeId: 's-tesco', pricePence: 100, packValue: 1, packUnit: 'kg', ...o });
    expect((await bad({ ingredientId: 'nope' })).ok).toBe(false);
    expect((await bad({ pricePence: 0 })).ok).toBe(false);
    expect((await bad({ pricePence: 1.5 })).ok).toBe(false);
    expect((await bad({ packValue: 0 })).ok).toBe(false);
    expect((await bad({ packUnit: 'parsec' })).ok).toBe(false);
    expect((await bad({ observedOn: '2026-12-01' })).ok).toBe(false); // future
    expect((await bad({ storeId: 'other' })).ok).toBe(false);
    expect((await bad({ storeId: null, retailer: ' ' })).ok).toBe(false);
    expect(recorded).toHaveLength(2);
  });

  it('a price you entered at a store and a receipt linked to that store compare as one shop', async () => {
    const { svc } = fixture([
      obs({ pricePence: 150, packQuantity: q(500, 'g'), retailer: 'Tesco', kind: 'user_confirmed' }),
      obs({ pricePence: 230, packQuantity: q(1, 'kg'), retailer: 'LIDL' }),
    ]);
    const h = (await svc.history(H, ING))!;
    expect(h.comparison.shops.map((s) => [s.label, s.linked])).toEqual([['LIDL', false], ['Tesco', true]]);
  });
});

describe('plannedWeekFor (P2-C leftovers in the planned estimate)', () => {
  const lite = new Map([['r1', { costPerServingPence: 200, costPartial: false }], ['r2', { costPerServingPence: null, costPartial: false }]]) as never;
  const doc = (entries: Record<string, unknown>) => ({ weekStart: '2026-10-19', entries }) as never;
  it('counts leftover / freezer slots as 0 new spend, not unknown or partial', () => {
    const w = plannedWeekFor(doc({ a: { kind: 'recipe', recipeId: 'r1', servings: 4 }, b: { kind: 'leftovers', batchId: 'b1', portions: 2 } }), lite);
    expect(w).toMatchObject({ pence: 800, partial: false, uncostedMeals: 0, meals: 2 });
  });
  it('a week of only leftovers is a known 0', () => {
    expect(plannedWeekFor(doc({ a: { kind: 'leftovers' }, b: { kind: 'leftovers', batchId: 'b1' } }), lite)).toMatchObject({ pence: 0, partial: false, meals: 2 });
  });
  it('an uncosted recipe still makes it unknown/partial, leftovers do not hide that', () => {
    expect(plannedWeekFor(doc({ a: { kind: 'recipe', recipeId: 'r2', servings: 2 }, b: { kind: 'leftovers' } }), lite)).toMatchObject({ pence: null, partial: true, uncostedMeals: 1 });
    expect(plannedWeekFor(doc({ a: { kind: 'recipe', recipeId: 'r1', servings: 1 }, b: { kind: 'recipe', recipeId: 'r2', servings: 1 }, c: { kind: 'leftovers' } }), lite)).toMatchObject({ pence: 200, partial: true });
  });
  it('an empty week stays unknown', () => {
    expect(plannedWeekFor(doc({}), lite).pence).toBeNull();
  });
});
