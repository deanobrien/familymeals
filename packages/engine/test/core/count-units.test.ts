import { describe, expect, it } from 'vitest';
import { convertQuantity } from '../../src/units';
import { exact, range, ONION } from './fixtures';

// countUnitWeightsG (D90): per-count-unit weights (can, clove, slice, bunch, sprig, stick, pack).
describe('countUnitWeightsG: per-count-unit weights', () => {
  const est = (value: number) => ({ value, source: 'test', estimate: true as const });
  const CHICKPEAS = { countUnitWeightsG: { can: est(240) } };
  const GARLIC_CLOVE = { unitWeightG: est(4), countUnitWeightsG: { clove: est(4) } };
  const COCONUT = { densityGPerMl: { value: 0.97, source: 'test' }, countUnitWeightsG: { can: est(388) } };

  it('converts a non-item count unit to mass and back, flagged estimate', () => {
    expect(convertQuantity(exact(2, 'can'), 'g', CHICKPEAS)).toMatchObject({ ok: true, quantity: { value: 480, unit: 'g' }, estimate: true });
    expect(convertQuantity(exact(1, 'can'), 'kg', CHICKPEAS)).toMatchObject({ ok: true, quantity: { value: 0.24 }, estimate: true });
    expect(convertQuantity(exact(480, 'g'), 'can', CHICKPEAS)).toMatchObject({ ok: true, quantity: { value: 2, unit: 'can' }, estimate: true });
    expect(convertQuantity(range(2, 3, 'clove'), 'g', GARLIC_CLOVE)).toMatchObject({ ok: true, quantity: { min: 8, max: 12 }, estimate: true });
  });
  it('is backward compatible: no entry for that unit, or estimates disallowed, still refuses', () => {
    expect(convertQuantity(exact(1, 'can'), 'g', { unitWeightG: est(150) })).toEqual({ ok: false, reason: 'incompatible_count_unit' });
    expect(convertQuantity(exact(1, 'bunch'), 'g', CHICKPEAS)).toEqual({ ok: false, reason: 'incompatible_count_unit' });
    expect(convertQuantity(exact(1, 'can'), 'g', CHICKPEAS, { allowEstimate: false })).toEqual({ ok: false, reason: 'missing_unit_weight' });
  });
  it('item still uses unitWeightG, not the per-unit map', () => {
    expect(convertQuantity(exact(2, 'item'), 'g', { unitWeightG: est(150), countUnitWeightsG: { can: est(1) } })).toMatchObject({ ok: true, quantity: { value: 300 } });
    expect(convertQuantity(exact(2, 'item'), 'g', CHICKPEAS)).toEqual({ ok: false, reason: 'missing_unit_weight' });
  });
  it('converts a count unit to volume only with both a unit weight and a density (400 ml tin = 1 can)', () => {
    const r = convertQuantity(exact(1, 'can'), 'ml', COCONUT);
    expect(r.ok && r.estimate && Math.abs(r.quantity.value! - 400) < 0.01).toBe(true);
    const back = convertQuantity(exact(400, 'ml'), 'can', COCONUT);
    expect(back.ok && Math.abs(back.quantity.value! - 1) < 0.001).toBe(true);
    expect(convertQuantity(exact(1, 'can'), 'ml', CHICKPEAS)).toEqual({ ok: false, reason: 'incompatible_dimension' });
    expect(convertQuantity(exact(1, 'can'), 'ml', COCONUT, { allowEstimate: false })).toEqual({ ok: false, reason: 'incompatible_dimension' });
    // item never goes to volume, even with weight and density
    expect(convertQuantity(exact(2), 'ml', { ...ONION, densityGPerMl: { value: 1, source: 'x' } })).toEqual({ ok: false, reason: 'incompatible_dimension' });
  });
  it('never converts between two different count units', () => {
    expect(convertQuantity(exact(1, 'can'), 'pack', CHICKPEAS)).toEqual({ ok: false, reason: 'incompatible_count_unit' });
  });
});
