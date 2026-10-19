import { z } from 'zod';

/** Mirror of CONTRACT-SEED.ts NutrientKey / ValueStatus / NutrientValue units. */
export const NUTRIENT_KEYS = [
  'energy_kcal', 'energy_kj', 'protein', 'carbohydrate', 'sugars',
  'fat', 'saturates', 'fibre', 'salt', 'sodium',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const NutrientKeySchema = z.enum(NUTRIENT_KEYS);
export const ValueStatusSchema = z.enum(['known', 'zero', 'unknown', 'unavailable']);
export type ValueStatus = z.infer<typeof ValueStatusSchema>;
export const NutrientUnitSchema = z.enum(['kcal', 'kJ', 'g', 'mg', 'ug']);
export type NutrientUnit = z.infer<typeof NutrientUnitSchema>;

/** The only unit each nutrient key may be expressed in. */
export const NUTRIENT_UNITS: Record<NutrientKey, NutrientUnit> = {
  energy_kcal: 'kcal', energy_kj: 'kJ', protein: 'g', carbohydrate: 'g', sugars: 'g',
  fat: 'g', saturates: 'g', fibre: 'g', salt: 'g', sodium: 'mg',
};
