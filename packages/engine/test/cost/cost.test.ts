import { describe, expect, it } from 'vitest';
import {
  checkBudget, checkPlanBudget, costBasket, costRecipe, roundBankers, roundHalfUp, selectPrice,
  type Requirement,
} from '../../src/cost/index';
import { approx, line, obs, pack, q, testConverter } from './helpers';

const FLOUR = 'ing-flour', ONION = 'ing-onion', MILK = 'ing-milk';

describe('price hierarchy', () => {
  const pq = q(1, 'kg');
  const all = [
    obs({ ingredientId: FLOUR, pricePence: 100, packQuantity: pq, kind: 'generic_estimate', observedOn: '2026-10-18', source: 'seed' }),
    obs({ ingredientId: FLOUR, pricePence: 110, packQuantity: pq, kind: 'retailer_verified', observedOn: '2026-10-10', source: 'tesco' }),
    obs({ ingredientId: FLOUR, pricePence: 120, packQuantity: pq, kind: 'receipt', observedOn: '2026-09-01', source: 'rcpt' }),
    obs({ ingredientId: FLOUR, pricePence: 130, packQuantity: pq, kind: 'user_confirmed', observedOn: '2026-01-01', source: 'me' }),
  ];
  it('prefers user_confirmed over fresher lower-ranked kinds', () => {
    const p = selectPrice(all, { ingredientId: FLOUR })!;
    expect(p.kind).toBe('user_confirmed');
    expect(p.pricePence).toBe(130);
    expect(p.observedOn).toBe('2026-01-01');
    expect(p.source).toBe('me');
    expect(p.isEstimate).toBe(false);
  });
  it('falls down the hierarchy', () => {
    expect(selectPrice(all.slice(0, 3), { ingredientId: FLOUR })!.kind).toBe('receipt');
    expect(selectPrice(all.slice(0, 2), { ingredientId: FLOUR })!.kind).toBe('retailer_verified');
    const est = selectPrice(all.slice(0, 1), { ingredientId: FLOUR })!;
    expect(est.kind).toBe('generic_estimate');
    expect(est.isEstimate).toBe(true);
  });
  it('breaks ties within a kind by recency, then lower price', () => {
    const o = [
      obs({ ingredientId: FLOUR, pricePence: 90, packQuantity: pq, kind: 'receipt', observedOn: '2026-08-01' }),
      obs({ ingredientId: FLOUR, pricePence: 150, packQuantity: pq, kind: 'receipt', observedOn: '2026-09-15' }),
      obs({ ingredientId: FLOUR, pricePence: 140, packQuantity: pq, kind: 'receipt', observedOn: '2026-09-15' }),
    ];
    expect(selectPrice(o, { ingredientId: FLOUR })!.pricePence).toBe(140);
  });
  it('honours asOf and returns null when nothing matches', () => {
    expect(selectPrice(all, { ingredientId: FLOUR, asOf: '2025-01-01' })).toBeNull();
    expect(selectPrice(all, { ingredientId: 'other' })).toBeNull();
  });
});

describe('rounding policy', () => {
  it('half-up rounds .5 up, banker rounds to even', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundBankers(2.5)).toBe(2);
    expect(roundHalfUp(3.5)).toBe(4);
    expect(roundBankers(3.5)).toBe(4);
    expect(roundHalfUp(1.005 * 100)).toBe(101); // float noise guard
    expect(roundHalfUp(2.4)).toBe(2);
  });
  it('recipe lines round half-up independently and the total is the sum of rounded lines', () => {
    // 50g @ 100p/kg = 5p ; 25g @ 100p/kg = 2.5p -> 3p
    const prices = [obs({ ingredientId: FLOUR, pricePence: 100, packQuantity: q(1, 'kg') })];
    const r = costRecipe({
      lines: [line('a', FLOUR, q(50, 'g'), 0), line('b', FLOUR, q(25, 'g'), 1)],
      servings: 2, prices, converter: testConverter,
    });
    expect(r.lines.map(l => l.costPence)).toEqual([5, 3]);
    expect(r.totalPence).toBe(8);
    expect(r.perServingPence).toBe(4);
  });
});

describe('recipe consumption cost', () => {
  const prices = [
    obs({ ingredientId: FLOUR, pricePence: 150, packQuantity: q(1.5, 'kg'), kind: 'receipt' }),
    obs({ ingredientId: MILK, pricePence: 130, packQuantity: q(2, 'l') }),
  ];
  it('costs proportional consumption with unit conversion, per serving, and flags estimates', () => {
    const r = costRecipe({
      lines: [line('f', FLOUR, q(300, 'g'), 0), line('m', MILK, q(500, 'ml'), 1)],
      servings: 4, prices, converter: testConverter,
    });
    expect(r.lines[0]!.costPence).toBe(30); // 300g of 1.5kg @150p
    expect(r.lines[1]!.costPence).toBe(33); // 0.25 * 130 = 32.5 -> 33
    expect(r.totalPence).toBe(63);
    expect(r.perServingPence).toBe(16); // 15.75 -> 16
    expect(r.coveragePct).toBe(100);
    expect(r.isPartial).toBe(false);
    expect(r.includesEstimates).toBe(true);
    expect(r.lines[0]!.price!.kind).toBe('receipt');
  });
  it('scales quantities', () => {
    const r = costRecipe({ lines: [line('f', FLOUR, q(300, 'g'))], servings: 8, scale: 2, prices, converter: testConverter });
    expect(r.totalPence).toBe(60);
  });
  it('reports partial coverage: unpriced, unmatched and non-convertible lines are uncosted, never zero', () => {
    const r = costRecipe({
      lines: [
        line('f', FLOUR, q(300, 'g'), 0),
        line('x', 'ing-unpriced', q(100, 'g'), 1),
        line('u', undefined, q(1, 'g'), 2),
        line('c', MILK, q(2, 'item'), 3), // count vs volume: converter returns null
      ],
      servings: 2, prices, converter: testConverter,
    });
    expect(r.totalPence).toBe(30);
    expect(r.coveragePct).toBe(25);
    expect(r.isPartial).toBe(true);
    expect(r.uncosted.map(l => [l.lineId, l.reason])).toEqual([
      ['x', 'no_price'], ['u', 'unmatched_ingredient'], ['c', 'not_convertible'],
    ]);
    expect(r.uncosted.every(l => l.costPence === undefined)).toBe(true);
  });
  it('returns null (not 0) when nothing can be costed', () => {
    const r = costRecipe({ lines: [line('x', 'nope', q(1, 'g'))], servings: 2, prices, converter: testConverter });
    expect(r.totalPence).toBeNull();
    expect(r.perServingPence).toBeNull();
    expect(r.coveragePct).toBe(0);
  });
  it('leaves approximate / to-taste / unparsed quantities uncosted', () => {
    const r = costRecipe({
      lines: [
        line('f', FLOUR, q(300, 'g'), 0),
        line('p', FLOUR, approx('pinch'), 1),
        line('t', FLOUR, { kind: 'to_taste', originalText: 'to taste' }, 2),
        line('n', FLOUR, { kind: 'unparsed', originalText: '??' }, 3),
      ],
      servings: 2, prices, converter: testConverter,
    });
    expect(r.uncosted.map(l => l.reason)).toEqual(['approximate_quantity', 'to_taste', 'unparsed_quantity']);
    expect(r.totalPence).toBe(30);
    expect(r.coveragePct).toBe(25);
  });
  it('skips optional lines by default (excluded from coverage), includes on request; range costs at max', () => {
    const lines = [
      line('f', FLOUR, q(300, 'g'), 0),
      line('o', FLOUR, q(150, 'g'), 1, true),
      line('r', FLOUR, { kind: 'range', min: 100, max: 200, unit: 'g', originalText: '100-200g' }, 2),
    ];
    const a = costRecipe({ lines, servings: 2, prices, converter: testConverter });
    expect(a.lines[1]!.status).toBe('skipped_optional');
    expect(a.lines[2]!.basis).toBe('range_max');
    expect(a.lines[2]!.costPence).toBe(20);
    expect(a.coveragePct).toBe(100);
    const b = costRecipe({ lines, servings: 2, prices, converter: testConverter, includeOptional: true });
    expect(b.totalPence).toBe(30 + 15 + 20);
  });
});

describe('basket cost', () => {
  const flourPacks = [pack('p1kg', FLOUR, q(1, 'kg'), 'Flour 1kg'), pack('p500', FLOUR, q(500, 'g'), 'Flour 500g')];
  const flourPrices = [
    obs({ productPackId: 'p1kg', ingredientId: FLOUR, pricePence: 150, packQuantity: q(1, 'kg'), kind: 'retailer_verified' }),
    obs({ productPackId: 'p500', ingredientId: FLOUR, pricePence: 80, packQuantity: q(500, 'g'), kind: 'retailer_verified' }),
  ];
  const req = (ingredientId: string | undefined, quantity: ReturnType<typeof q>, displayName = 'Flour'): Requirement =>
    ({ ...(ingredientId ? { ingredientId } : {}), displayName, quantity, contributions: [] });

  it('pack optimisation: 1.2kg with 1kg/500g picks 1kg + 500g, reports waste', () => {
    const b = costBasket({ requirements: [req(FLOUR, q(1.2, 'kg'))], pantry: [], packs: flourPacks, prices: flourPrices, converter: testConverter });
    const it = b.items[0]!;
    expect(it.status).toBe('costed');
    expect(it.costPence).toBe(230);
    expect(it.packs.map(p => [p.packId, p.count])).toEqual([['p1kg', 1], ['p500', 1]]);
    expect(it.leftover!.value).toBeCloseTo(0.3, 9);
    expect(it.wastePct).toBe(20);
    expect(it.explanation).toContain('£2.30');
    expect(b.totalPence).toBe(230);
    expect(b.isPartial).toBe(false);
  });
  it('allows multiple units of one pack and mixes when cheaper', () => {
    // 2.2kg: 2x1kg + 500g = 380 ; alt 3x1kg = 450 ; 4x500g+... fine
    const b = costBasket({ requirements: [req(FLOUR, q(2.2, 'kg'))], pantry: [], packs: flourPacks, prices: flourPrices, converter: testConverter });
    expect(b.items[0]!.costPence).toBe(380);
    expect(b.items[0]!.packs.map(p => [p.packId, p.count])).toEqual([['p1kg', 2], ['p500', 1]]);
  });
  it('picks a cheaper larger pack over exact-fit smaller packs', () => {
    const packs = [pack('big', FLOUR, q(2, 'kg')), pack('small', FLOUR, q(500, 'g'))];
    const prices = [
      obs({ productPackId: 'big', pricePence: 200, packQuantity: q(2, 'kg') }),
      obs({ productPackId: 'small', pricePence: 90, packQuantity: q(500, 'g') }),
    ];
    const b = costBasket({ requirements: [req(FLOUR, q(1.5, 'kg'))], pantry: [], packs, prices, converter: testConverter });
    expect(b.items[0]!.costPence).toBe(200); // 3 x small = 270
    expect(b.items[0]!.packs).toHaveLength(1);
    expect(b.includesEstimates).toBe(true);
  });
  it('deducts pantry stock (with unit conversion) before choosing packs', () => {
    const b = costBasket({
      requirements: [req(FLOUR, q(1.2, 'kg'))],
      pantry: [{ ingredientId: FLOUR, quantity: q(700, 'g') }],
      packs: flourPacks, prices: flourPrices, converter: testConverter,
    });
    const it = b.items[0]!;
    expect(it.pantryDeducted!.value).toBeCloseTo(0.7, 9);
    expect(it.toBuy!.value).toBeCloseTo(0.5, 9);
    expect(it.costPence).toBe(80);
    expect(it.packs.map(p => p.packId)).toEqual(['p500']);
    expect(it.explanation).toContain('pantry');
  });
  it('fully covered by pantry costs 0 genuinely and buys nothing; stock is not double-counted', () => {
    const b = costBasket({
      requirements: [req(FLOUR, q(500, 'g')), req(FLOUR, q(500, 'g'))],
      pantry: [{ ingredientId: FLOUR, quantity: q(600, 'g') }],
      packs: flourPacks, prices: flourPrices, converter: testConverter,
    });
    expect(b.items[0]!.status).toBe('covered_by_pantry');
    expect(b.items[0]!.packs).toEqual([]);
    expect(b.items[1]!.pantryDeducted!.value).toBe(100);
    expect(b.items[1]!.toBuy!.value).toBe(400);
    expect(b.items[1]!.costPence).toBe(80);
    expect(b.totalPence).toBe(80);
  });
  it('approximate / unmatched / pack-less / unpriced requirements are uncosted, not free', () => {
    const b = costBasket({
      requirements: [
        req(FLOUR, q(1, 'kg')),
        req(ONION, approx('handful'), 'Parsley'),
        req(undefined, q(1, 'kg'), 'Mystery'),
        req(ONION, q(2, 'item'), 'Onion'),
        req(MILK, q(1, 'l'), 'Milk'),
      ],
      pantry: [],
      packs: [...flourPacks, pack('milk2', MILK, q(2, 'l'))],
      prices: flourPrices, converter: testConverter,
    });
    expect(b.items.map(i => i.status)).toEqual(['costed', 'uncosted', 'uncosted', 'uncosted', 'uncosted']);
    expect(b.items.map(i => i.reason)).toEqual([undefined, 'approximate_quantity', 'unmatched_ingredient', 'no_packs', 'no_price']);
    expect(b.totalPence).toBe(150);
    expect(b.coveragePct).toBe(20);
    expect(b.isPartial).toBe(true);
  });
  it('derives pack price from an ingredient-level price when no pack price exists', () => {
    const b = costBasket({
      requirements: [req(FLOUR, q(1, 'kg'))],
      pantry: [], packs: [pack('p1kg', FLOUR, q(1, 'kg'))],
      prices: [obs({ ingredientId: FLOUR, pricePence: 120, packQuantity: q(1.5, 'kg') })],
      converter: testConverter,
    });
    expect(b.items[0]!.costPence).toBe(80);
    expect(b.items[0]!.packs[0]!.derivedPrice).toBe(true);
    expect(b.items[0]!.isEstimate).toBe(true);
  });
  it('is deterministic', () => {
    const run = () => JSON.stringify(costBasket({ requirements: [req(FLOUR, q(1.7, 'kg'))], pantry: [], packs: flourPacks, prices: flourPrices, converter: testConverter }));
    expect(run()).toBe(run());
  });
});

describe('budget check', () => {
  it('within / over / unknown', () => {
    expect(checkBudget(400, 500)).toMatchObject({ status: 'within', variancePence: -100, headroomPence: 100 });
    expect(checkBudget(600, 500)).toMatchObject({ status: 'over', variancePence: 100, headroomPence: 0 });
    expect(checkBudget(null, 500).status).toBe('unknown');
  });
  it('partial cost under target is unknown; partial cost over target is still over', () => {
    expect(checkBudget(400, 500, { costIsPartial: true }).status).toBe('unknown');
    expect(checkBudget(600, 500, { costIsPartial: true }).status).toBe('over');
  });
  it('plan budget sums known meals and flags unknown ones', () => {
    const r = checkPlanBudget([{ costPence: 300 }, { costPence: null }, { costPence: 250 }], 1000);
    expect(r.costPence).toBe(550);
    expect(r.unknownMeals).toBe(1);
    expect(r.status).toBe('unknown');
    expect(checkPlanBudget([{ costPence: 300 }, { costPence: 250 }], 500).status).toBe('over');
  });
});
