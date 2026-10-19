import type { CanonicalIngredient, Quantity, RecipeIngredientLine, Unit } from '../../src/contract';
import type { AggregateInput } from '../../src/aggregate';

export const ONION: CanonicalIngredient = {
  id: 'ing-onion', name: 'onion', category: 'veg', aliases: ['brown onion', 'yellow onion'],
  unitWeightG: { value: 150, source: 'test', estimate: true },
};
export const RED_ONION: CanonicalIngredient = { id: 'ing-red-onion', name: 'red onion', category: 'veg', aliases: [] };
export const MILK: CanonicalIngredient = {
  id: 'ing-milk', name: 'milk', category: 'dairy', aliases: ['semi-skimmed milk'],
  densityGPerMl: { value: 1.03, source: 'test' },
};
export const FLOUR_NO_DENSITY: CanonicalIngredient = { id: 'ing-flour', name: 'plain flour', category: 'baking', aliases: ['flour', 'all-purpose flour'] };
export const FLOUR_WITH_DENSITY: CanonicalIngredient = { ...FLOUR_NO_DENSITY, densityGPerMl: { value: 0.53, source: 'test' } };
export const SALT: CanonicalIngredient = { id: 'ing-salt', name: 'salt', category: 'store', aliases: ['sea salt'], densityGPerMl: { value: 1.2, source: 'test' } };
export const CORIANDER_FRESH: CanonicalIngredient = {
  id: 'ing-coriander-fresh', name: 'coriander', category: 'herb', aliases: ['fresh coriander', 'cilantro', 'coriander leaves'], form: 'fresh',
};
export const CORIANDER_GROUND: CanonicalIngredient = {
  id: 'ing-coriander-ground', name: 'ground coriander', category: 'spice', aliases: ['coriander powder'], form: 'ground',
};
export const CHICKEN_BREAST: CanonicalIngredient = { id: 'ing-chicken-breast', name: 'chicken breast', category: 'meat', aliases: ['chicken breast fillet'] };
export const CHICKEN_THIGH: CanonicalIngredient = { id: 'ing-chicken-thigh', name: 'chicken thigh', category: 'meat', aliases: ['boneless chicken thigh'] };
export const BEEF_MINCE: CanonicalIngredient = { id: 'ing-beef-mince', name: 'beef mince', category: 'meat', aliases: ['minced beef'] };
export const BEEF_STEAK: CanonicalIngredient = { id: 'ing-beef-steak', name: 'sirloin steak', category: 'meat', aliases: ['beef sirloin'] };
export const OREGANO_DRIED: CanonicalIngredient = { id: 'ing-oregano-dried', name: 'oregano', category: 'herb', aliases: [], form: 'dried' };
export const GARLIC: CanonicalIngredient = { id: 'ing-garlic', name: 'garlic', category: 'veg', aliases: ['garlic clove'], unitWeightG: { value: 40, source: 'bulb', estimate: true } };
export const TOMATO: CanonicalIngredient = { id: 'ing-tomato', name: 'tomato', category: 'veg', aliases: ['vine tomato'] };
export const CHOPPED_TOMATOES: CanonicalIngredient = { id: 'ing-chopped-tom', name: 'chopped tomatoes', category: 'tins', aliases: ['tinned chopped tomatoes'], form: 'canned' };

export const CATALOGUE: CanonicalIngredient[] = [
  ONION, RED_ONION, MILK, FLOUR_NO_DENSITY, SALT, CORIANDER_FRESH, CORIANDER_GROUND, CHICKEN_BREAST, CHICKEN_THIGH,
  BEEF_MINCE, BEEF_STEAK, OREGANO_DRIED, GARLIC, TOMATO, CHOPPED_TOMATOES,
];

export function exact(value: number, unit?: Unit, originalText = `${value}${unit ?? ''}`): Quantity {
  const q: Quantity = { kind: 'exact', value, originalText };
  if (unit) q.unit = unit;
  return q;
}
export function range(min: number, max: number, unit?: Unit, originalText = `${min}-${max}${unit ?? ''}`): Quantity {
  const q: Quantity = { kind: 'range', min, max, originalText };
  if (unit) q.unit = unit;
  return q;
}
export function approx(label: string, originalText = `a ${label}`): Quantity {
  return { kind: 'approximate', approxLabel: label, originalText };
}
export function toTaste(originalText = 'to taste'): Quantity {
  return { kind: 'to_taste', originalText };
}
export function unparsed(originalText: string): Quantity {
  return { kind: 'unparsed', originalText };
}

let seq = 0;
export function line(
  quantity: Quantity,
  opts: { ingredientId?: string; recipeId?: string; optional?: boolean; id?: string; name?: string; plannedMealId?: string; scale?: number } = {},
): AggregateInput {
  seq += 1;
  const l: RecipeIngredientLine = {
    id: opts.id ?? `line-${seq}`,
    recipeId: opts.recipeId ?? 'recipe-1',
    quantity,
    optional: opts.optional ?? false,
    order: seq,
  };
  if (opts.ingredientId) l.ingredientId = opts.ingredientId;
  const input: AggregateInput = { line: l };
  if (opts.name) input.name = opts.name;
  if (opts.plannedMealId) input.plannedMealId = opts.plannedMealId;
  if (opts.scale !== undefined) input.scale = opts.scale;
  return input;
}
