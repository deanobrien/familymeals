import { describe, expect, it } from 'vitest';
import type { CanonicalIngredient, PriceObservation, Quantity, Unit } from '../../src/contract';
import {
  addDays, ageLabel, buildMonths, buildShopResolver, buildWeeks, categoryBreakdown, cheapestBadgeText, compareIngredient, compareList,
  csvCell, daysBetween, formatUnitPrice, londonDateOf, mondayOf, normaliseSplits, priceHistory, retailerKey, shopBreakdown, spendCsv,
  statusText, suggestStore, unitPriceOf, weekStartsBetween, type SpendRecord,
} from '../../src/money';

const q = (value: number, unit: Unit, originalText = ''): Quantity => ({ kind: 'exact', value, unit, originalText: originalText || `${value} ${unit}` });
const ING = 'a0000000-0000-4000-8000-000000000001';
const ING2 = 'a0000000-0000-4000-8000-000000000002';
const obs = (o: Partial<PriceObservation> & { pricePence: number; packQuantity: Quantity }): PriceObservation =>
  ({ ingredientId: ING, kind: 'receipt', observedOn: '2026-10-10', source: `receipt:${Math.random()}`, retailer: 'ALDI', ...o });

describe('unit price normalisation', () => {
  it('normalises mass to per kg and volume to per litre whatever the pack unit', () => {
    expect(unitPriceOf(120, q(500, 'g'))).toMatchObject({ basis: 'kg', pencePerUnit: 240 });
    expect(unitPriceOf(150, q(1.5, 'kg'))).toMatchObject({ basis: 'kg', pencePerUnit: 100 });
    expect(unitPriceOf(55, q(1, 'pint'))?.pencePerUnit).toBeCloseTo(55 / 0.56826125, 5);
    expect(unitPriceOf(90, q(2, 'l'))).toMatchObject({ basis: 'l', pencePerUnit: 45 });
    expect(unitPriceOf(90, q(750, 'ml'))).toMatchObject({ basis: 'l', pencePerUnit: 120 });
  });
  it('counts are per item; a bare "1 item" is flagged as pack size unknown', () => {
    expect(unitPriceOf(180, q(6, 'item'))).toMatchObject({ basis: 'each', pencePerUnit: 30, packSizeKnown: true });
    expect(unitPriceOf(180, q(1, 'item'))).toMatchObject({ basis: 'each', pencePerUnit: 180, packSizeKnown: false });
    expect(unitPriceOf(80, q(4, 'can'))).toMatchObject({ basis: 'each', pencePerUnit: 20 });
  });
  it('never converts weight to volume and refuses unusable pack sizes', () => {
    expect(unitPriceOf(100, q(1, 'l'))!.basis).not.toBe(unitPriceOf(100, q(1, 'kg'))!.basis);
    expect(unitPriceOf(100, { kind: 'to_taste', originalText: 'x' })).toBeNull();
    expect(unitPriceOf(100, q(0, 'g'))).toBeNull();
    expect(unitPriceOf(-1, q(1, 'g'))).toBeNull();
    expect(unitPriceOf(Number.NaN, q(1, 'g'))).toBeNull();
    expect(unitPriceOf(100, { kind: 'exact', value: Infinity, unit: 'g', originalText: '' })).toBeNull();
  });
  it('formats unit prices in pence below a pound', () => {
    expect(formatUnitPrice({ basis: 'kg', pencePerUnit: 240 })).toBe('£2.40 per kg');
    expect(formatUnitPrice({ basis: 'l', pencePerUnit: 45 })).toBe('45p per litre');
    expect(formatUnitPrice({ basis: 'each', pencePerUnit: 4.5 })).toBe('4.5p per item');
  });
});

describe('Europe/London weeks (DST)', () => {
  it('turns instants into the London calendar date', () => {
    // BST (UTC+1): Sunday 23:30 UTC is already Monday 00:30 in London
    expect(londonDateOf('2026-06-07T23:30:00Z')).toBe('2026-06-08');
    // GMT: Sunday 23:30 UTC is still Sunday
    expect(londonDateOf('2026-12-06T23:30:00Z')).toBe('2026-12-06');
    // the clocks go forward on 2026-03-29 (01:00 UTC) and back on 2026-10-25 (01:00 UTC)
    expect(londonDateOf('2026-03-28T23:59:00Z')).toBe('2026-03-28');
    expect(londonDateOf('2026-03-29T00:30:00Z')).toBe('2026-03-29');
    expect(londonDateOf('2026-10-24T23:30:00Z')).toBe('2026-10-25'); // 00:30 BST
    expect(londonDateOf('2026-10-25T23:30:00Z')).toBe('2026-10-25'); // 23:30 GMT, the 25 hour day
    expect(londonDateOf('not a date')).toBeUndefined();
  });
  it('assigns a late Sunday shop to the right Monday-Sunday week on both sides of a clock change', () => {
    const week = (iso: string) => mondayOf(londonDateOf(iso)!);
    expect(week('2026-06-07T22:59:00Z')).toBe('2026-06-01'); // 23:59 BST Sunday: old week
    expect(week('2026-06-07T23:01:00Z')).toBe('2026-06-08'); // 00:01 BST Monday: new week
    expect(week('2026-12-06T23:59:00Z')).toBe('2026-11-30'); // 23:59 GMT Sunday: old week
    expect(week('2026-12-07T00:01:00Z')).toBe('2026-12-07'); // 00:01 GMT Monday: new week
    expect(week('2026-03-29T00:30:00Z')).toBe('2026-03-23'); // Sunday of the spring-forward weekend
    expect(week('2026-03-29T23:30:00Z')).toBe('2026-03-30'); // 00:30 BST Monday
    expect(week('2026-10-25T23:30:00Z')).toBe('2026-10-19'); // Sunday 23:30 GMT after the clocks went back
  });
  it('date arithmetic ignores the clock change', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(daysBetween('2026-03-27', '2026-03-31')).toBe(4);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(weekStartsBetween('2026-10-14', '2026-11-03')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  });
  it('labels ages', () => {
    expect(ageLabel(0)).toBe('today');
    expect(ageLabel(1)).toBe('yesterday');
    expect(ageLabel(5)).toBe('5 days ago');
    expect(ageLabel(21)).toBe('3 weeks ago');
    expect(ageLabel(120)).toBe('4 months ago');
  });
});

describe('retailer to store matching', () => {
  const stores = [{ id: 's1', name: 'Tesco', chain: 'Tesco' }, { id: 's2', name: 'ALDI Gosforth', chain: 'ALDI' }, { id: 's3', name: 'Lidl' }];
  it('normalises retailer text', () => {
    expect(retailerKey('TESCO STORES LTD')).toBe('tesco');
    expect(retailerKey("Sainsbury's Supermarkets")).toBe('sainsbury s');
    expect(retailerKey('  M&S  ')).toBe('m and s');
    expect(retailerKey(undefined)).toBe('');
  });
  it('suggests a store only when one clearly matches', () => {
    expect(suggestStore('TESCO EXTRA', stores)?.id).toBe('s1');
    expect(suggestStore('Aldi', stores)?.id).toBe('s2');
    expect(suggestStore('Waitrose', stores)).toBeNull();
    expect(suggestStore('', stores)).toBeNull();
    // two equally good matches: no suggestion
    expect(suggestStore('Aldi', [{ id: 'a', name: 'Aldi North' }, { id: 'b', name: 'Aldi South' }])).toBeNull();
  });
  it('a confirmed link groups differently-printed retailers into one shop; unlinked ones stay separate', () => {
    const resolve = buildShopResolver(stores, { [retailerKey('TESCO EXTRA')]: 's1', tesco: 's1' });
    expect(resolve('TESCO EXTRA')).toMatchObject({ key: 'store:s1', label: 'Tesco', linked: true });
    expect(resolve('Tesco')?.key).toBe('store:s1');
    expect(resolve('Co-op')).toMatchObject({ key: 'name:co op', linked: false, label: 'Co-op' });
    expect(resolve('  ')).toBeNull();
  });
});

describe('cheapest at', () => {
  const resolve = buildShopResolver([], {});
  const today = '2026-10-21';
  it('needs two shops with recent comparable prices', () => {
    const one = compareIngredient([obs({ pricePence: 100, packQuantity: q(1, 'kg') })], ING, resolve, { today });
    expect(one.cheapest).toBeNull();
    expect(one.note).toMatch(/Only ALDI/);
    const stale = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), observedOn: '2026-10-20' }),
      obs({ pricePence: 80, packQuantity: q(1, 'kg'), retailer: 'LIDL', observedOn: '2026-07-01' }),
    ], ING, resolve, { today });
    expect(stale.cheapest).toBeNull();
    expect(stale.note).toMatch(/Fewer than two shops/);
    expect(stale.shops.find((s) => s.shop.label === 'LIDL')?.stale).toBe(true);
  });
  it('compares by unit price, not pack price', () => {
    const c = compareIngredient([
      obs({ pricePence: 150, packQuantity: q(500, 'g'), observedOn: '2026-10-19' }), // 3.00 per kg
      obs({ pricePence: 230, packQuantity: q(1, 'kg'), retailer: 'LIDL', observedOn: '2026-10-15' }), // 2.30 per kg
      obs({ pricePence: 90, packQuantity: q(250, 'g'), retailer: 'Tesco', observedOn: '2026-10-01' }), // 3.60 per kg
    ], ING, resolve, { today });
    expect(c.basis).toBe('kg');
    expect(c.cheapest?.shop.label).toBe('LIDL');
    expect(c.tied).toBe(false);
    expect(c.shops.map((s) => s.shop.label)).toEqual(['LIDL', 'ALDI', 'Tesco']);
    expect(c.savingPct).toBe(Math.round((1 - 2.3 / 3.6) * 100));
    expect(cheapestBadgeText(c)).toBe('Cheapest at LIDL: £2.30 per kg (6 days ago)');
  });
  it('uses each shop\'s LATEST price and counts all observations', () => {
    const c = compareIngredient([
      obs({ pricePence: 300, packQuantity: q(1, 'kg'), observedOn: '2026-09-20', source: 'a' }),
      obs({ pricePence: 150, packQuantity: q(1, 'kg'), observedOn: '2026-10-18', source: 'b' }),
      obs({ pricePence: 200, packQuantity: q(1, 'kg'), retailer: 'LIDL', observedOn: '2026-10-10', source: 'c' }),
    ], ING, resolve, { today });
    const aldi = c.shops.find((s) => s.shop.label === 'ALDI')!;
    expect(aldi.latest.pricePence).toBe(150);
    expect(aldi.count).toBe(2);
    expect(c.cheapest?.shop.label).toBe('ALDI');
  });
  it('a price the user entered beats a receipt on the same day', () => {
    const c = compareIngredient([
      obs({ pricePence: 150, packQuantity: q(1, 'kg'), observedOn: '2026-10-18', source: 'r' }),
      obs({ pricePence: 140, packQuantity: q(1, 'kg'), observedOn: '2026-10-18', source: 'u', kind: 'user_confirmed' }),
      obs({ pricePence: 200, packQuantity: q(1, 'kg'), retailer: 'LIDL', observedOn: '2026-10-10' }),
    ], ING, resolve, { today });
    expect(c.shops.find((s) => s.shop.label === 'ALDI')!.latest.pricePence).toBe(140);
  });
  it('refuses to compare weight with count, and says so', () => {
    const c = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg') }),
      obs({ pricePence: 30, packQuantity: q(1, 'item'), retailer: 'LIDL' }),
    ], ING, resolve, { today });
    expect(c.cheapest).toBeNull();
    expect(c.note).toMatch(/different pack types/);
  });
  it('prefers the basis most shops share and leaves the others unranked', () => {
    const c = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg') }),
      obs({ pricePence: 90, packQuantity: q(1, 'kg'), retailer: 'LIDL' }),
      obs({ pricePence: 30, packQuantity: q(1, 'item'), retailer: 'Tesco' }),
    ], ING, resolve, { today });
    expect(c.basis).toBe('kg');
    expect(c.shops.find((s) => s.shop.label === 'Tesco')?.comparable).toBe(false);
    expect(c.cheapest?.shop.label).toBe('LIDL');
  });
  it('a tie is joint cheapest, not a winner', () => {
    const c = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg') }),
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), retailer: 'LIDL' }),
    ], ING, resolve, { today });
    expect(c.tied).toBe(true);
    expect(cheapestBadgeText(c)).toMatch(/^Joint cheapest at/);
  });
  it('ignores generic estimates, other ingredients, packs and priceless retailers', () => {
    const c = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), kind: 'generic_estimate', retailer: undefined }),
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), kind: 'retailer_verified' }),
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), ingredientId: ING2 }),
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), retailer: undefined }),
    ], ING, resolve, { today });
    expect(c.shops).toEqual([]);
    expect(c.withoutRetailer).toBe(1);
    expect(c.note).toMatch(/No shop prices yet/);
  });
  it('linked stores merge retailer spellings into one shop', () => {
    const r = buildShopResolver([{ id: 's1', name: 'Tesco' }], { tesco: 's1', 'tesco extra': 's1' });
    const c = compareIngredient([
      obs({ pricePence: 100, packQuantity: q(1, 'kg'), retailer: 'TESCO EXTRA' }),
      obs({ pricePence: 90, packQuantity: q(1, 'kg'), retailer: 'Tesco', observedOn: '2026-10-12' }),
    ], ING, r, { today });
    expect(c.shops).toHaveLength(1);
    expect(c.shops[0]!.count).toBe(2);
  });
  it('price history is newest first with unit prices', () => {
    const h = priceHistory([
      obs({ pricePence: 100, packQuantity: q(500, 'g'), observedOn: '2026-10-01' }),
      obs({ pricePence: 120, packQuantity: q(500, 'g'), observedOn: '2026-10-15' }),
    ], ING, resolve, today);
    expect(h.map((x) => x.pricePence)).toEqual([120, 100]);
    expect(h[0]).toMatchObject({ unitText: '£2.40 per kg', ageText: '6 days ago' });
  });
});

describe('where is the list cheapest', () => {
  const resolve = buildShopResolver([], {});
  const today = '2026-10-21';
  const ingredients: CanonicalIngredient[] = [];
  const need = (id: string, name: string, ingredientId: string | undefined, outstanding: number, unit?: Unit) =>
    ({ id, name, ingredientId, outstanding, unit, quantified: true });
  const observations = [
    obs({ pricePence: 150, packQuantity: q(500, 'g'), retailer: 'ALDI' }),
    obs({ pricePence: 200, packQuantity: q(500, 'g'), retailer: 'LIDL' }),
    obs({ pricePence: 100, packQuantity: q(1, 'l'), ingredientId: ING2, retailer: 'ALDI' }),
  ];
  const needs = [need('n1', 'rice', ING, 1000, 'g'), need('n2', 'milk', ING2, 2, 'l'), need('n3', 'mystery', undefined, 1, 'item')];

  it('totals only what each shop has a price for and always reports coverage', () => {
    const r = compareList({ needs, observations, ingredients, resolve, today });
    expect(r.totalItems).toBe(3);
    const aldi = r.shops.find((s) => s.shop.label === 'ALDI')!;
    const lidl = r.shops.find((s) => s.shop.label === 'LIDL')!;
    expect(aldi).toMatchObject({ totalPence: 300 + 200, pricedItems: 2, coveragePct: 67 });
    expect(aldi.missing).toEqual(['mystery']);
    expect(lidl).toMatchObject({ totalPence: 400, pricedItems: 1, coveragePct: 33 });
    expect(lidl.missing).toEqual(['milk', 'mystery']);
    // ALDI covers more, so it leads; the cheaper-looking LIDL total (less coverage) does not win
    expect(r.shops.map((s) => s.shop.label)).toEqual(['ALDI', 'LIDL']);
  });
  it('the like-for-like row totals only the items priced at every shop', () => {
    const r = compareList({ needs, observations, ingredients, resolve, today });
    expect(r.likeForLike?.itemNames).toEqual(['rice']);
    expect(r.likeForLike?.totals.map((t) => [t.shop.label, t.totalPence])).toEqual([['ALDI', 300], ['LIDL', 400]]);
    expect(r.likeForLike?.cheapest?.label).toBe('ALDI');
  });
  it('flags a per-item cheapest call only where two shops are comparable', () => {
    const r = compareList({ needs, observations, ingredients, resolve, today });
    expect(Object.keys(r.byItem)).toEqual(['n1']);
    expect(r.byItem.n1!.comparison.cheapest?.shop.label).toBe('ALDI');
  });
  it('says so when there is nothing to compare', () => {
    expect(compareList({ needs, observations: [], ingredients, resolve, today }).note).toMatch(/No shop prices/);
    const single = compareList({ needs, observations: [observations[0]!], ingredients, resolve, today });
    expect(single.note).toMatch(/Only ALDI/);
    expect(single.likeForLike).toBeNull();
  });
  it('an incompatible unit leaves the item uncovered rather than guessing', () => {
    const r = compareList({ needs: [need('n1', 'rice', ING, 3, 'item')], observations, ingredients, resolve, today });
    expect(r.shops).toEqual([]);
  });
  it('an unquantified item is costed as one pack and finished items are skipped', () => {
    const r = compareList({
      needs: [{ id: 'n1', name: 'salt', ingredientId: ING, outstanding: 0, quantified: false }, need('n9', 'done', ING, 0, 'g')],
      observations, ingredients, resolve, today,
    });
    expect(r.totalItems).toBe(1);
    expect(r.shops.find((s) => s.shop.label === 'ALDI')?.totalPence).toBe(150);
  });
});

describe('spend aggregation', () => {
  const rec = (id: string, date: string, totalPence: number, splits: { category: string; pence: number }[] = [], source: 'receipt' | 'manual' = 'receipt', shop: string | null = 'ALDI'): SpendRecord =>
    ({ id, source, date, shop, totalPence, splits });

  it('splits always add up to the total: remainder to Uncategorised, over-count scaled down', () => {
    expect(normaliseSplits(1000, [{ category: 'Dairy', pence: 300 }, { category: 'Dairy', pence: 200 }])).toEqual([{ category: 'Dairy', pence: 500 }, { category: 'Uncategorised', pence: 500 }]);
    const scaled = normaliseSplits(900, [{ category: 'A', pence: 600 }, { category: 'B', pence: 600 }]);
    expect(scaled.reduce((t, s) => t + s.pence, 0)).toBe(900);
    expect(scaled).toEqual([{ category: 'A', pence: 450 }, { category: 'B', pence: 450 }]);
    const odd = normaliseSplits(100, [{ category: 'A', pence: 100 }, { category: 'B', pence: 100 }, { category: 'C', pence: 100 }]);
    expect(odd.reduce((t, s) => t + s.pence, 0)).toBe(100);
    expect(normaliseSplits(500, [])).toEqual([{ category: 'Uncategorised', pence: 500 }]);
    expect(normaliseSplits(0, [])).toEqual([]);
  });

  const weekStarts = weekStartsBetween('2026-10-05', '2026-10-26');
  const records = [
    rec('r1', '2026-10-06', 3000, [{ category: 'Fruit & veg', pence: 1000 }]),
    rec('r2', '2026-10-11', 2500, [], 'receipt', 'LIDL'), // Sunday: still the week of 5 Oct
    rec('m1', '2026-10-12', 1200, [{ category: 'Bakery', pence: 1200 }], 'manual', null),
    rec('r3', '2026-10-21', 4000, [{ category: 'Meat & fish', pence: 2500 }]),
  ];
  const planned = [
    { weekStart: '2026-10-05', pence: 7000, partial: false, uncostedMeals: 0, meals: 5 },
    { weekStart: '2026-10-12', pence: 9500, partial: true, uncostedMeals: 1, meals: 5 },
    { weekStart: '2026-10-19', pence: null, partial: false, uncostedMeals: 4, meals: 4 },
  ];
  const weeks = buildWeeks({ records, planned, budgetPence: 8000, weekStarts, today: '2026-10-21' });

  it('weekly rows: budget vs planned estimate vs actual, with the right statuses', () => {
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(weeks[0]).toMatchObject({ actualPence: 5500, receiptsPence: 5500, manualPence: 0, actualStatus: 'under', varianceToBudgetPence: -2500, plannedStatus: 'within', varianceToPlannedPence: -1500 });
    expect(weeks[1]).toMatchObject({ actualPence: 1200, manualPence: 1200, plannedPartial: true, plannedStatus: 'over', varianceToPlannedPence: null });
    // the current week is "so far", never "under"
    expect(weeks[2]).toMatchObject({ inProgress: true, actualPence: 4000, actualStatus: 'so_far_within', plannedPence: null, plannedStatus: 'unknown' });
    expect(weeks[3]).toMatchObject({ actualPence: 0, actualStatus: 'no_spend', plannedStatus: 'none' });
  });
  it('over budget is over even mid-week; no budget is stated, not guessed', () => {
    const over = buildWeeks({ records: [rec('x', '2026-10-21', 9000)], planned: [], budgetPence: 8000, weekStarts: ['2026-10-19'], today: '2026-10-21' });
    expect(over[0]).toMatchObject({ actualStatus: 'over', varianceToBudgetPence: 1000 });
    const none = buildWeeks({ records, planned, budgetPence: null, weekStarts, today: '2026-10-21' });
    expect(none.every((w) => w.actualStatus === 'no_budget' && w.varianceToBudgetPence === null)).toBe(true);
    expect(none[0]!.plannedStatus).toBe('no_budget');
    const exact = buildWeeks({ records: [rec('x', '2026-10-06', 8000)], planned: [], budgetPence: 8000, weekStarts: ['2026-10-05'], today: '2026-10-21' });
    expect(exact[0]!.actualStatus).toBe('on');
  });
  it('a record on the week boundary goes to the week its date is in', () => {
    const w = buildWeeks({ records: [rec('a', '2026-10-18', 100), rec('b', '2026-10-19', 200)], planned: [], budgetPence: 1000, weekStarts: ['2026-10-12', '2026-10-19'], today: '2026-11-01' });
    expect(w.map((x) => x.actualPence)).toEqual([100, 200]);
  });
  it('months are made of whole weeks and carry the same three measures', () => {
    const wk = buildWeeks({ records, planned, budgetPence: 8000, weekStarts: weekStartsBetween('2026-09-21', '2026-10-26'), today: '2026-10-21' });
    const months = buildMonths(wk);
    expect(months.map((m) => [m.month, m.weeks])).toEqual([['2026-09', 2], ['2026-10', 4]]);
    const oct = months.find((m) => m.month === '2026-10')!;
    expect(oct).toMatchObject({ budgetPence: 32000, actualPence: 10700, plannedPence: 16500, plannedPartial: true, plannedWeeks: 2, actualStatus: 'so_far_within' });
    expect(months[0]).toMatchObject({ actualPence: 0, actualStatus: 'no_spend' });
    expect(buildMonths(buildWeeks({ records, planned, budgetPence: null, weekStarts, today: '2026-10-21' }))[0]!.budgetPence).toBeNull();
  });
  it('category and shop breakdowns', () => {
    const cats = categoryBreakdown(records, '2026-10-01', '2026-10-31');
    expect(cats[0]).toMatchObject({ category: 'Meat & fish', pence: 2500 });
    expect(cats.find((c) => c.category === 'Fruit & veg')?.pence).toBe(1000);
    expect(cats[cats.length - 1]!.category).toBe('Uncategorised');
    expect(cats.reduce((t, c) => t + c.pence, 0)).toBe(10700);
    expect(Math.round(cats.reduce((t, c) => t + c.sharePct, 0))).toBe(100);
    expect(categoryBreakdown(records, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(shopBreakdown(records, '2026-10-01', '2026-10-31')).toEqual([
      { shop: 'ALDI', pence: 7000, trips: 2 }, { shop: 'LIDL', pence: 2500, trips: 1 }, { shop: 'Shop not recorded', pence: 1200, trips: 1 },
    ]);
  });
  it('status wording', () => {
    expect(statusText('over', 1050)).toBe('£10.50 over budget');
    expect(statusText('under', -250)).toBe('£2.50 under budget');
    expect(statusText('so_far_within', -3000)).toBe('£30.00 left so far');
  });
});

describe('CSV export', () => {
  it('defuses formulas and quotes awkward text', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+44')).toBe("'+44");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell('-')).toBe("'-");
  });
  it('writes one row per category, oldest first, adding up to each total', () => {
    const csv = spendCsv([
      { id: 'b', source: 'manual', date: '2026-10-12', shop: null, totalPence: 1200, splits: [], note: 'market, cash' },
      { id: 'a', source: 'receipt', date: '2026-10-06', shop: '=ALDI', totalPence: 1000, splits: [{ category: 'Dairy & eggs', pence: 400 }] },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Week starting,Source,Shop,Category,Amount (GBP),Note');
    expect(lines.slice(1)).toEqual([
      "2026-10-06,2026-10-05,Receipt,'=ALDI,Dairy & eggs,4.00,",
      "2026-10-06,2026-10-05,Receipt,'=ALDI,Uncategorised,6.00,",
      '2026-10-12,2026-10-12,Manual entry,,Uncategorised,12.00,"market, cash"',
    ]);
    expect(spendCsv([], '2026-01-01', '2026-12-31').trim()).toBe('Date,Week starting,Source,Shop,Category,Amount (GBP),Note');
    expect(spendCsv([{ id: 'x', source: 'manual', date: '2026-10-12', shop: null, totalPence: 100, splits: [] }], '2026-10-13').trim().split('\r\n')).toHaveLength(1);
  });
});
