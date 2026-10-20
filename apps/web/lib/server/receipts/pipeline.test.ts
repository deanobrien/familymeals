import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAiProvider, type ReceiptParse } from '@fr/ai';
import type { OutstandingItem, Quantity } from '../../receipts/matcher';
import { buildReviewModel } from '../../receipts/review';
import { createMemoryServices, fixtureOutstandingItems, DEMO_HOUSEHOLD_ID, DEMO_USER_ID } from './memory';
import {
  confirmReceipt,
  loadReview,
  processReceiptUpload,
  ReceiptError,
  toTillLines,
  type PipelineDeps,
} from './pipeline';

const FIXTURES = fileURLToPath(new URL('../../../../../e2e/fixtures/receipts/', import.meta.url));

interface ExpectedLine { rawText: string; kind: string; quantity: number; linePricePence: number; expectedIngredient: string | null }
interface Expected { image: string; retailer: string; date: string; totalPence: number; lines: ExpectedLine[] }

const expected = (name: string): Expected => JSON.parse(readFileSync(`${FIXTURES}${name}.expected.json`, 'utf8'));
const image = (name: string) => new Uint8Array(readFileSync(`${FIXTURES}${name}.png`));

/** Build the AI parse the real provider would return for a fixture receipt (OCR ground truth). */
function parseFromExpected(e: Expected, totalPence = e.totalPence): ReceiptParse {
  return {
    retailer: e.retailer,
    date: e.date,
    totalPence,
    warnings: [],
    lines: e.lines.map((l) => ({ text: l.rawText, qty: l.quantity, pricePence: l.linePricePence })),
  };
}

const q = (value: number, unit: Quantity['unit']): Quantity => ({ kind: 'exact', value, unit, originalText: `${value}${unit}` });
const item = (n: number, name: string, outstanding: Quantity): OutstandingItem => ({
  shoppingListItemId: `item-${n}`, name, aliases: [], outstanding,
});

/** What the household still needs, per fixture receipt. */
const LISTS: Record<string, OutstandingItem[]> = {
  'r1-weekly-shop': [
    item(1, 'spaghetti', q(500, 'g')), item(2, 'tinned chopped tomatoes', q(800, 'g')),
    item(3, 'onion', q(1, 'kg')), item(4, 'milk', q(2, 'l')), item(5, 'chicken', q(1.5, 'kg')),
  ],
  'r2-multibuy': [
    item(1, 'chickpeas', q(1200, 'g')), item(2, 'coconut milk', q(400, 'ml')), item(3, 'spinach', q(200, 'g')),
  ],
  'r3-fish-promo': [
    item(1, 'white fish fillets', q(500, 'g')), item(2, 'smoked haddock', q(250, 'g')),
    item(3, 'floury potatoes', q(2.5, 'kg')), item(4, 'frozen peas', q(500, 'g')),
  ],
  'r4-baking': [
    item(1, 'self-raising flour', q(1.5, 'kg')), item(2, 'caster sugar', q(1, 'kg')), item(3, 'butter', q(500, 'g')),
    item(4, 'lemons', q(4, 'item')), item(5, 'eggs', q(12, 'item')),
  ],
};

function makeDeps(parse: ReceiptParse | undefined, items: OutstandingItem[] = fixtureOutstandingItems()) {
  const mem = createMemoryServices(items);
  let n = 0;
  const deps: PipelineDeps = {
    householdId: DEMO_HOUSEHOLD_ID,
    userId: DEMO_USER_ID,
    prepareImage: async (b) => b,
    parser: { parseReceipt: async () => parse! },
    outstanding: mem.outstanding,
    receipts: mem.receipts,
    purchases: mem.purchases,
    newId: () => `id-${++n}`,
    now: () => new Date('2026-10-19T12:00:00Z'),
  };
  return { deps, mem };
}

describe('toTillLines', () => {
  it('formats prices, quantities and discounts as till text', () => {
    const lines = toTillLines({
      warnings: [],
      lines: [
        { text: 'CHICKPEAS 400G', qty: 3, pricePence: 270 },
        { text: 'MULTIBUY 3 FOR 2', qty: 1, pricePence: -90 },
        { text: 'GARLIC', pricePence: 45 },
      ],
    });
    expect(lines).toEqual(['3 X CHICKPEAS 400G 2.70', 'MULTIBUY 3 FOR 2 -0.90', 'GARLIC 0.45']);
  });
});

describe.each(['r1-weekly-shop', 'r2-multibuy', 'r3-fish-promo', 'r4-baking'])('fixture receipt %s', (name) => {
  const exp = expected(name);

  it('parses every real line, attaches discounts and passes the total check', async () => {
    const { deps } = makeDeps(parseFromExpected(exp), LISTS[name]);
    const rec = await processReceiptUpload(deps, { bytes: image(name), imageName: `${name}.png` });
    const products = exp.lines.filter((l) => l.kind === 'item');
    expect(rec.lines).toHaveLength(products.length);
    expect(rec.status).toBe('needs_review');
    expect(rec.totalPence).toBe(exp.totalPence);
    expect(rec.computedPence).toBe(exp.totalPence);
    const review = buildReviewModel(rec, LISTS[name]!);
    expect(review.totalOk).toBe(true);
    expect(review.discrepancyPence).toBe(0);
    // discount lines are not items; their value reduces the item they follow
    const discounts = exp.lines.filter((l) => l.linePricePence < 0);
    expect(rec.lines.reduce((s, l) => s + l.discountPence, 0)).toBe(discounts.reduce((s, l) => s - l.linePricePence, 0));
  });

  it('never suggests a list item for non-food lines and never creates purchases', async () => {
    const { deps, mem } = makeDeps(parseFromExpected(exp), LISTS[name]);
    const rec = await processReceiptUpload(deps, { bytes: image(name) });
    const products = exp.lines.filter((l) => l.kind === 'item');
    products.forEach((p, i) => {
      if (p.expectedIngredient === null) expect(rec.lines[i]!.match.classification).not.toBe('confident');
    });
    expect(mem.purchases.events).toHaveLength(0);
    expect(mem.purchases.priceObservations).toHaveLength(0);
    expect((await mem.outstanding.list()).length).toBe(LISTS[name]!.length);
  });
});

describe('matching quality on well-formed fixtures', () => {
  it.each([
    ['r1-weekly-shop', ['spaghetti', 'tinned chopped tomatoes', 'onion', 'milk']],
    ['r2-multibuy', ['chickpeas', 'coconut milk', 'spinach']],
    ['r3-fish-promo', ['white fish fillets', 'smoked haddock', 'floury potatoes']],
  ])('%s: top candidate is the expected ingredient', async (name, names) => {
    const exp = expected(name);
    const { deps } = makeDeps(parseFromExpected(exp), LISTS[name]);
    const rec = await processReceiptUpload(deps, { bytes: image(name) });
    const byName = new Map(LISTS[name]!.map((i) => [i.shoppingListItemId, i.name]));
    const products = exp.lines.filter((l) => l.kind === 'item');
    products.forEach((p, i) => {
      if (!p.expectedIngredient || !names.includes(p.expectedIngredient)) return;
      const top = rec.lines[i]!.match.candidates[0];
      expect(top ? byName.get(top.shoppingListItemId) : undefined).toBe(p.expectedIngredient);
    });
  });
});

describe('receipt total discrepancy', () => {
  it('flags a total that does not match the lines', async () => {
    const exp = expected('r1-weekly-shop');
    const { deps } = makeDeps(parseFromExpected(exp, exp.totalPence + 250), LISTS['r1-weekly-shop']);
    const rec = await processReceiptUpload(deps, { bytes: image('r1-weekly-shop') });
    const review = await loadReview(deps, rec.id);
    expect(review!.totalOk).toBe(false);
    expect(review!.discrepancyPence).toBe(250);
  });
});

describe('confirmation', () => {
  async function setup() {
    const exp = expected('r1-weekly-shop');
    const ctx = makeDeps(parseFromExpected(exp), LISTS['r1-weekly-shop']);
    const rec = await processReceiptUpload(ctx.deps, { bytes: image('r1-weekly-shop') });
    return { ...ctx, rec };
  }

  it('records purchases only for lines the user confirmed; the rest stay outstanding', async () => {
    const { deps, mem, rec } = await setup();
    const onion = rec.lines[2]!;
    const summary = await confirmReceipt(deps, rec.id, [
      { lineId: onion.id, outcome: 'purchase', shoppingListItemId: 'item-3' },
      { lineId: rec.lines[4]!.id, outcome: 'extra', addToPantry: true },
    ]);
    expect(summary).toMatchObject({ purchases: 1, extras: 1, pantryAdds: 1 });
    expect(mem.purchases.events).toHaveLength(1);
    expect(mem.purchases.events[0]).toMatchObject({ shoppingListItemId: 'item-3', receiptLineId: onion.id, actualPricePence: 110, createdBy: DEMO_USER_ID });
    // spaghetti etc. were NOT confirmed so are still outstanding; onion is fulfilled
    const names = (await mem.outstanding.list()).map((i) => i.name);
    expect(names).toEqual(['spaghetti', 'tinned chopped tomatoes', 'milk', 'chicken']);
    expect(mem.purchases.pantry).toHaveLength(1);
    expect(mem.purchases.pantry[0]!.name).toContain('carrierbag');
    // receipt preserved as history
    const saved = await mem.receipts.get(DEMO_HOUSEHOLD_ID, rec.id);
    expect(saved!.status).toBe('reconciled');
    expect(saved!.lines).toHaveLength(5);
    expect(saved!.reconciliation!.decisions).toHaveLength(2);
  });

  it('records actual price history as receipt observations (per pack)', async () => {
    const { deps, mem, rec } = await setup();
    const toms = rec.lines[1]!; // 2 x 400G for 130p
    await confirmReceipt(deps, rec.id, [{ lineId: toms.id, outcome: 'purchase', shoppingListItemId: 'item-2' }]);
    expect(mem.purchases.priceObservations).toEqual([
      expect.objectContaining({ kind: 'receipt', pricePence: 65, observedOn: '2026-10-10', retailer: 'FICTIONAL FOODS' }),
    ]);
    expect(mem.purchases.events[0]!.quantity).toMatchObject({ value: 800, unit: 'g' });
  });

  it('adjusted quantity reduces the outstanding amount instead of removing the item', async () => {
    const { deps, mem, rec } = await setup();
    await confirmReceipt(deps, rec.id, [
      { lineId: rec.lines[3]!.id, outcome: 'purchase', shoppingListItemId: 'item-4', quantityValue: 1 },
    ]);
    const milk = (await mem.outstanding.list()).find((i) => i.name === 'milk');
    expect(milk?.outstanding).toMatchObject({ value: 1000, unit: 'ml' });
  });

  it('rejects a second confirmation, unknown lines, unavailable items and bad quantities', async () => {
    const { deps, rec } = await setup();
    await expect(confirmReceipt(deps, rec.id, [{ lineId: 'nope', outcome: 'extra' }])).rejects.toBeInstanceOf(ReceiptError);
    await expect(
      confirmReceipt(deps, rec.id, [{ lineId: rec.lines[0]!.id, outcome: 'purchase', shoppingListItemId: 'missing' }]),
    ).rejects.toThrow(/no longer outstanding/);
    await expect(
      confirmReceipt(deps, rec.id, [{ lineId: rec.lines[0]!.id, outcome: 'purchase', shoppingListItemId: 'item-1', quantityValue: 0 }]),
    ).rejects.toThrow(/greater than zero/);
    await confirmReceipt(deps, rec.id, [{ lineId: rec.lines[0]!.id, outcome: 'purchase', shoppingListItemId: 'item-1' }]);
    await expect(confirmReceipt(deps, rec.id, [])).rejects.toMatchObject({ code: 'ALREADY_RECONCILED' });
  });

  it('an uncertain match only becomes a purchase when the user decides it', async () => {
    const { deps, mem, rec } = await setup();
    const uncertain = rec.lines.filter((l) => l.match.classification === 'uncertain');
    // confirming with an empty decision list (user ticked nothing) records nothing
    await confirmReceipt(deps, rec.id, []);
    expect(mem.purchases.events).toHaveLength(0);
    expect(uncertain.every((l) => l.match.classification !== 'confident')).toBe(true);
  });
});

describe('default mock AI provider (AI_PROVIDER=mock)', () => {
  it('runs prepareImage -> parseReceipt -> matcher into a review model', async () => {
    const { prepareImage } = await import('@fr/ai');
    const provider = createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' });
    const mem = createMemoryServices();
    const deps: PipelineDeps = {
      householdId: DEMO_HOUSEHOLD_ID,
      userId: DEMO_USER_ID,
      prepareImage: async (b) => (await prepareImage(b)).data,
      parser: provider,
      outstanding: mem.outstanding,
      receipts: mem.receipts,
      purchases: mem.purchases,
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    };
    const rec = await processReceiptUpload(deps, { bytes: image('r1-weekly-shop'), imageName: 'r1.png' });
    expect(rec.retailer).toBe('Example Supermarket');
    expect(rec.lines.map((l) => l.raw)).toHaveLength(3);
    expect(rec.totalPence).toBe(574);
    expect(rec.computedPence).toBe(574);
    const review = await loadReview(deps, rec.id);
    expect(review!.totalOk).toBe(true);
    const names = new Map(review!.items.map((i) => [i.shoppingListItemId, i.name]));
    const top = review!.lines.map((l) => names.get(l.candidates[0]?.itemId ?? ''));
    expect(top).toEqual(['red lentils', 'onions', 'semi skimmed milk']);
    expect(mem.purchases.events).toHaveLength(0);
  });

  it('rejects a non-image upload before calling the provider', async () => {
    const { prepareImage } = await import('@fr/ai');
    await expect(prepareImage(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE' });
  });
});

describe('receipt photo storage (D190)', () => {
  const noop = { get: async () => undefined, signedUrl: async () => undefined, finishUpload: async () => {}, sweep: async () => {} };
  it('keeps the photo in the receipt-images bucket and records its path on the receipt', async () => {
    const { deps } = makeDeps(parseFromExpected(expected('r1-weekly-shop')), LISTS['r1-weekly-shop']);
    const stored: string[] = [];
    let n = 0;
    deps.newId = () => `cccccccc-dddd-4eee-8fff-00000000000${++n}`;
    deps.images = {
      backend: 'supabase',
      put: async (kind, id, file) => { const p = `hh/${kind}/${id}/${file}`; stored.push(p); return p; },
      ...noop,
    };
    const rec = await processReceiptUpload(deps, { bytes: image('r1-weekly-shop') });
    expect(rec.id).toBe('cccccccc-dddd-4eee-8fff-000000000001');
    expect(rec.imagePaths).toEqual(['hh/receipt/cccccccc-dddd-4eee-8fff-000000000001/receipt.jpg']);
    expect(stored).toHaveLength(1);
  });
  it('carries on without a photo when storage fails, and stores nothing in local mode', async () => {
    const { deps } = makeDeps(parseFromExpected(expected('r1-weekly-shop')), LISTS['r1-weekly-shop']);
    deps.images = { backend: 'supabase', put: async () => { throw new Error('boom'); }, ...noop };
    expect((await processReceiptUpload(deps, { bytes: image('r1-weekly-shop') })).imagePaths).toBeUndefined();
    const { deps: local } = makeDeps(parseFromExpected(expected('r1-weekly-shop')), LISTS['r1-weekly-shop']);
    expect((await processReceiptUpload(local, { bytes: image('r1-weekly-shop') })).imagePaths).toBeUndefined();
  });
});
