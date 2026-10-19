import { describe, expect, it } from 'vitest';
import {
  assignGreedy, assignOptimal, buildReconciliation, learnedKey, matchReceipt, normaliseReceiptLine,
  parseReceipt, rankCandidates, scoreCandidate, totalCheck, type OutstandingItem,
} from '../../src/receipt-match';

const item = (id: string, name: string, extra: Partial<OutstandingItem> = {}): OutstandingItem => ({
  shoppingListItemId: id, name, aliases: [], ...extra,
});
const one = (raw: string) => {
  const p = parseReceipt([raw]);
  const l = p.items[0];
  if (!l) throw new Error('no item parsed: ' + raw);
  return l;
};

describe('normaliser', () => {
  it('expands abbreviations, strips brand and pack size, parses price', () => {
    const l = one('TSCO SEMI SKMD MLK 2PT      1.65 A');
    expect(l.tokens).toEqual(['semi', 'skimmed', 'milk']);
    expect(l.packQuantity).toMatchObject({ value: 2, unit: 'pint' });
    expect(l.pricePence).toBe(165);
  });

  it('attaches a weighted continuation line to the previous item', () => {
    const p = parseReceipt(['BNNAS LOOSE', '0.536kg @ £1.20/kg   0.64']);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ tokens: ['banana', 'loose'], weightG: 536, pricePence: 64 });
    expect(p.items[0]!.packQuantity).toMatchObject({ value: 0.536, unit: 'kg' });
  });

  it('computes price from weight x rate when no trailing price is printed', () => {
    expect(parseReceipt(['LOOSE CARROTS', '1.250kg @ £0.90/kg']).items[0]!.pricePence).toBe(Math.round(1.25 * 90));
  });

  it('handles multiples on the same and following line', () => {
    expect(one('TSCO CHERRY TOMS 2 @ £1.50  3.00')).toMatchObject({ count: 2, pricePence: 300, tokens: ['cherry', 'tomato'] });
    const p = parseReceipt(['TSCO CHERRY TOMS', '2 @ £1.50  3.00']);
    expect(p.items[0]).toMatchObject({ count: 2, pricePence: 300 });
  });

  it('parses multipacks', () => {
    expect(one('YOGHURT 4 X 125G 1.50').packQuantity).toMatchObject({ value: 500, unit: 'g' });
  });

  it('attaches discount lines (negative, trailing minus, keyword) to the previous item', () => {
    const p = parseReceipt([
      'TSCO CHERRY TOMS 2 @ £1.50  3.00', 'MULTIBUY SAVING -1.00', 'CLUBCARD PRICE 0.20-', 'RED ONIONS 1.10',
    ]);
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ pricePence: 300, discountPence: 120, netPence: 180 });
    expect(p.items[1]).toMatchObject({ discountPence: 0, netPence: 110 });
  });

  it('ignores header/footer and picks up totals', () => {
    const p = parseReceipt(['TESCO SUPERSTORE', 'RED ONIONS 1.10', 'SUBTOTAL 1.10', 'TOTAL £1.10', 'VISA DEBIT 1.10', 'THANK YOU']);
    expect(p.items.map((i) => i.tokens.join(' '))).toEqual(['red onion']);
    expect(p.totalPence).toBe(110);
    expect(p.subtotalPence).toBe(110);
    expect(p.ignored).toContain('TESCO SUPERSTORE');
  });

  it('does not mistake a size like 2.27L for a price', () => {
    expect(normaliseReceiptLine('MILK 2.27L')).toMatchObject({ kind: 'item', pricePence: undefined });
  });
});

describe('scoring and classification', () => {
  const milkSemi = item('milk-semi', 'semi skimmed milk', { outstanding: { kind: 'exact', value: 2, unit: 'pint', originalText: '2 pints' } });
  const milkWhole = item('milk-whole', 'whole milk', { outstanding: { kind: 'exact', value: 1, unit: 'pint', originalText: '1 pint' } });

  it('exact text + size is confident', () => {
    const [m] = matchReceipt([one('TSCO SEMI SKMD MLK 2PT 1.65')], [milkSemi, milkWhole]);
    expect(m!.classification).toBe('confident');
    expect(m!.suggestion!.shoppingListItemId).toBe('milk-semi');
    expect(m!.suggestion!.reasons.join(' ')).toMatch(/text match/);
  });

  it('plain MILK against semi and whole is ambiguous -> uncertain', () => {
    const [m] = matchReceipt([one('MILK 2PT 1.55')], [milkSemi, milkWhole]);
    expect(m!.candidates.length).toBe(2);
    expect(m!.classification).toBe('uncertain');
  });

  it('milk 1pt vs 2pt: both lines for one outstanding item -> only one suggested, and only as uncertain', () => {
    const lines = [one('SEMI SKMD MLK 1PT 1.10'), one('SEMI SKMD MLK 2PT 1.65')];
    lines[0]!.id = 'l1'; lines[1]!.id = 'l2';
    const [a, b] = matchReceipt(lines, [milkSemi]);
    expect(b!.suggestion?.shoppingListItemId).toBe('milk-semi'); // 2pt fits the 2pt outstanding better
    expect(b!.classification).toBe('uncertain'); // competing line within margin
    expect(a!.suggestion).toBeUndefined();
    expect(a!.classification).toBe('none');
  });

  it('fresh vs dried herbs are never merged silently', () => {
    const freshBasil = item('basil', 'basil', { form: 'fresh' });
    const fresh = scoreCandidate(one('FRSH BASIL 30G 0.90'), freshBasil)!;
    expect(matchReceipt([one('FRSH BASIL 30G 0.90')], [freshBasil])[0]!.classification).toBe('confident');
    const dried = one('DRIED BASIL 10G 0.95');
    const [m] = matchReceipt([dried], [freshBasil]);
    expect(m!.classification).toBe('none');
    expect(m!.candidates[0]!.flags).toContain('form_conflict');
    expect(fresh.score).toBeGreaterThan(m!.candidates[0]!.score);
  });

  it('list item that does not state a form cannot be confidently matched to a dried/ground line', () => {
    const [m] = matchReceipt([one('GROUND CORIANDER 1.10')], [item('cor', 'coriander')]);
    expect(m!.suggestion!.flags).toContain('form_unspecified');
    expect(m!.classification).toBe('uncertain');
  });

  it('dried line matches an explicitly dried list item', () => {
    const [m] = matchReceipt([one('DRD BASIL 10G 0.95')], [item('db', 'dried basil')]);
    expect(m!.classification).toBe('confident');
  });

  it('uses aliases and fuzzy spelling', () => {
    const [m] = matchReceipt([one('COURGETTES 0.80')], [item('z', 'zucchini', { aliases: ['courgette'] })]);
    expect(m!.suggestion!.shoppingListItemId).toBe('z');
    const fuzzy = scoreCandidate(one('CHILLIES RED 0.75'), item('c', 'red chilli'))!;
    expect(fuzzy.flags).toContain('fuzzy');
  });

  it('learned mappings surface a candidate but never make it confident on their own', () => {
    const line = one('PRK SSGS 8S 2.50');
    const sausages = item('s', 'pork sausages', { ingredientId: 'ing-sausage' });
    expect(matchReceipt([line], [sausages])[0]!.classification).toBe('none'); // weak abbreviation hit only
    const learned = { [learnedKey(line.tokens)]: 'ing-sausage' };
    const ranked = rankCandidates(line, [sausages], { learned });
    expect(ranked[0]!.flags).toContain('learned');
    const [m] = matchReceipt([line], [sausages], { learned });
    expect(m!.classification).toBe('uncertain');
  });

  it('unrelated lines get none', () => {
    const [m] = matchReceipt([one('CHOCOLATE DIGESTIVES 1.25')], [milkSemi]);
    expect(m!.classification).toBe('none');
    expect(m!.suggestion).toBeUndefined();
  });

  it('is deterministic', () => {
    const lines = parseReceipt(['MILK 2PT 1.55', 'RED ONIONS 1.10']).items;
    expect(matchReceipt(lines, [milkSemi, milkWhole])).toEqual(matchReceipt(lines, [milkSemi, milkWhole]));
  });
});

describe('assignment', () => {
  it('optimal beats greedy when greedy would steal the only option', () => {
    const s = [[0.9, 0.8], [0.85, 0]];
    expect(assignGreedy(s)).toEqual([0, -1]);
    expect(assignOptimal(s)).toEqual([1, 0]);
  });
  it('handles rectangular matrices and zero cells', () => {
    expect(assignOptimal([[0.9], [0.8], [0]])).toEqual([0, -1, -1]);
    expect(assignOptimal([[0, 0.7, 0.6]])).toEqual([1]);
    expect(assignOptimal([])).toEqual([]);
  });
});

describe('reconciliation', () => {
  const receiptText = [
    'TESCO SUPERSTORE',
    'TSCO SEMI SKMD MLK 2PT      1.65 A',
    'BNNAS LOOSE',
    '0.536kg @ £1.20/kg   0.64',
    'RED ONIONS 3PK  1.10',
    'TSCO CHERRY TOMS 2 @ £1.50  3.00',
    'MULTIBUY SAVING -1.00',
    'DRIED BASIL 10G 0.95',
    'CHOCOLATE DIGESTIVES 1.25',
    'SUBTOTAL 7.59',
    'TOTAL £7.59',
    'VISA DEBIT 7.59',
  ];
  const parsed = parseReceipt(receiptText, { idPrefix: 'r1' });
  const items = [
    item('milk', 'semi skimmed milk', { outstanding: { kind: 'exact', value: 2, unit: 'pint', originalText: '2 pints' } }),
    item('banana', 'bananas', { outstanding: { kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' } }),
    item('onion', 'red onion'),
    item('tomato', 'cherry tomatoes'),
    item('basil', 'basil', { form: 'fresh' }),
    item('eggs', 'eggs'),
  ];
  let n = 0;
  const base = { lines: parsed.items, items, createdBy: 'u1', now: '2026-10-19T12:00:00Z', newId: () => `ev-${++n}` };

  it('parses the receipt fully and the total check passes', () => {
    expect(parsed.items).toHaveLength(6);
    expect(parsed.totalPence).toBe(759);
    expect(totalCheck(parsed.items, parsed.totalPence).ok).toBe(true);
  });

  it('suggestions: confident where clear, none for form conflict and extras', () => {
    const ms = matchReceipt(parsed.items, items);
    const cls = Object.fromEntries(ms.map((m, i) => [parsed.items[i]!.tokens.join(' '), m.classification]));
    expect(cls['semi skimmed milk']).toBe('confident');
    expect(cls['banana loose']).toBe('confident');
    expect(cls['red onion']).toBe('confident');
    expect(cls['cherry tomato']).toBe('confident');
    expect(cls['dried basil']).toBe('none');
    expect(cls['chocolate digestive']).toBe('none');
  });

  it('no confirmations -> no purchase events (suggestions never auto-confirm)', () => {
    const r = buildReconciliation({ ...base, confirmations: [], receiptTotalPence: 759 });
    expect(r.purchaseEvents).toEqual([]);
    expect(r.unmatchedItems).toHaveLength(items.length);
    expect(r.extras).toHaveLength(6);
  });

  it('builds events only for confirmed matches, with net price and receipt line link', () => {
    n = 0;
    const [milk, banana, , tomato] = parsed.items;
    const r = buildReconciliation({
      ...base, receiptTotalPence: 759,
      confirmations: [
        { receiptLineId: milk!.id, shoppingListItemId: 'milk' },
        { receiptLineId: banana!.id, shoppingListItemId: 'banana' },
        { receiptLineId: tomato!.id, shoppingListItemId: 'tomato', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: 'only 1' } },
      ],
    });
    expect(r.purchaseEvents.map((e) => e.shoppingListItemId)).toEqual(['milk', 'banana', 'tomato']);
    expect(r.purchaseEvents[0]).toMatchObject({ id: 'ev-1', receiptLineId: milk!.id, actualPricePence: 165, quantity: { value: 2, unit: 'pint' } });
    expect(r.purchaseEvents[1]).toMatchObject({ actualPricePence: 64, quantity: { value: 0.536, unit: 'kg' } });
    expect(r.purchaseEvents[2]).toMatchObject({ actualPricePence: 200, quantity: { value: 1 } }); // net of multibuy
    expect(r.extras.map((l) => l.description)).toContain('dried basil');
    expect(r.extras).toHaveLength(3);
    expect(r.unmatchedItems.map((i) => i.shoppingListItemId)).toEqual(['onion', 'basil', 'eggs']);
    expect(r.totalCheck.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('reports a total discrepancy', () => {
    const r = buildReconciliation({ ...base, confirmations: [], receiptTotalPence: 799 });
    expect(r.totalCheck).toMatchObject({ computedPence: 759, discrepancyPence: 40, ok: false });
    expect(r.warnings.join(' ')).toMatch(/40p/);
  });

  it('allows several lines to feed one item but ignores a line confirmed twice and unknown ids', () => {
    n = 0;
    const [a, b] = parsed.items;
    const r = buildReconciliation({
      ...base, receiptTotalPence: 759,
      confirmations: [
        { receiptLineId: a!.id, shoppingListItemId: 'milk' },
        { receiptLineId: b!.id, shoppingListItemId: 'milk' },
        { receiptLineId: a!.id, shoppingListItemId: 'eggs' },
        { receiptLineId: 'nope', shoppingListItemId: 'eggs' },
        { receiptLineId: a!.id, shoppingListItemId: 'ghost' },
      ],
    });
    expect(r.purchaseEvents).toHaveLength(2);
    expect(r.warnings.filter((w) => /already confirmed|unknown/.test(w))).toHaveLength(3);
  });

  it('flags missing receipt total and unpriced lines', () => {
    const lines = [{ ...parsed.items[0]!, netPence: undefined, pricePence: undefined }];
    const tc = totalCheck(lines, 100);
    expect(tc.ok).toBe(false);
    expect(tc.linesMissingPrice).toHaveLength(1);
    expect(buildReconciliation({ ...base, confirmations: [] }).warnings.join(' ')).toMatch(/no receipt total/);
  });
});
