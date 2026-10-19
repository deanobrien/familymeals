import { describe, expect, it } from 'vitest';
import { buildDemoPantryService } from '../pantry/deps';
import { PantryServiceReceiptPort, toPantryAmount } from './pantry-port';

const HH = 'cccccccc-0000-4000-8000-0000000000c1';
const q = (value: number, unit: string) => ({ kind: 'exact' as const, value, unit: unit as never, originalText: `${value} ${unit}` });

describe('receipt extras -> pantry service (D103)', () => {
  it('maps receipt quantities to pantry amounts, never inventing one', () => {
    expect(toPantryAmount(q(500, 'g'))).toEqual({ value: 500, unit: 'g' });
    expect(toPantryAmount(q(2, 'pack'))).toEqual({ value: 2, unit: 'pack' });
    expect(toPantryAmount(q(3, 'pint'))).toEqual({ value: 1, unit: 'item' }); // not a pantry unit
    expect(toPantryAmount({ kind: 'unparsed', originalText: 'x' } as never)).toEqual({ value: 1, unit: 'item' });
  });

  it('confirmed extras appear in the household pantry (and only that household\'s)', async () => {
    const svc = buildDemoPantryService(() => '2026-10-19T10:00:00.000Z', HH);
    const before = (await svc.getView(HH)).categories.flatMap((c) => c.items).length;
    await new PantryServiceReceiptPort(HH, svc).addToPantry([
      { name: 'red lentils', quantity: q(500, 'g'), receiptId: 'r1', receiptLineId: 'l1' },
      { name: 'mystery treat', quantity: q(1, 'pack'), receiptId: 'r1', receiptLineId: 'l2' },
    ]);
    const items = (await svc.getView(HH)).categories.flatMap((c) => c.items);
    expect(items.length).toBe(before + 2);
    expect(items.find((i) => i.name === 'lentils' || i.name === 'red lentils')?.quantityLabel).toMatch(/500/);
    expect(items.some((i) => i.name === 'mystery treat')).toBe(true);
  });

  it('skips lines the engine rejects and writes nothing when none are valid', async () => {
    const svc = buildDemoPantryService(() => '2026-10-19T10:00:00.000Z', HH);
    const r = await svc.addPurchased(HH, [{ name: '', value: 1, unit: 'g' }, { name: 'x', value: -1, unit: 'g' }]);
    expect(r).toEqual({ added: 0, skipped: 2 });
  });
});
