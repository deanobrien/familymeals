/**
 * Compile-time proof that the zod-inferred types are mutually assignable with CONTRACT-SEED.ts
 * (checked by `tsc --noEmit`; the runtime test just keeps Vitest aware of the file).
 */
import { describe, expect, it } from 'vitest';
import type * as Seed from './contract-seed.snapshot';
import type * as D from '../src/index';

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const ok = <T extends true>(_: T) => _;

ok<Mutual<D.Unit, Seed.Unit>>(true);
ok<Mutual<D.MassUnit, Seed.MassUnit>>(true);
ok<Mutual<D.VolumeUnit, Seed.VolumeUnit>>(true);
ok<Mutual<D.CountUnit, Seed.CountUnit>>(true);
ok<Mutual<D.Dimension, Seed.Dimension>>(true);
ok<Mutual<D.QuantityKind, Seed.QuantityKind>>(true);
ok<Mutual<D.Quantity, Seed.Quantity>>(true);
ok<Mutual<D.CanonicalIngredient, Seed.CanonicalIngredient>>(true);
ok<Mutual<D.RecipeIngredientLine, Seed.RecipeIngredientLine>>(true);
ok<Mutual<D.Contribution, Seed.Contribution>>(true);
ok<Mutual<D.Requirement, Seed.Requirement>>(true);
ok<Mutual<D.ValueStatus, Seed.ValueStatus>>(true);
ok<Mutual<D.NutrientKey, Seed.NutrientKey>>(true);
ok<Mutual<D.NutrientValue, Seed.NutrientValue>>(true);
ok<Mutual<D.PriceKind, Seed.PriceKind>>(true);
ok<Mutual<D.PriceObservation, Seed.PriceObservation>>(true);
ok<Mutual<D.ProductPack, Seed.ProductPack>>(true);
ok<Mutual<D.MealType, Seed.MealType>>(true);
ok<Mutual<D.DietCategory, Seed.DietCategory>>(true);
ok<Mutual<D.Pence, Seed.Pence>>(true);
ok<Mutual<D.PurchaseEvent, Seed.PurchaseEvent>>(true);

describe('contract compatibility', () => {
  it('is enforced at compile time', () => {
    expect(true).toBe(true);
  });
});
