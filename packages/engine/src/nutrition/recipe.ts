import type { Quantity } from '../contract';
import { combine, divideNutrient, type Part } from './combine';
import { normaliseProfile } from './profile';
import {
  NUTRIENT_KEYS, type CalcOptions, type MissingIngredient, type MissingReason, type NutrientMap,
  type NutritionLine, type RecipeNutrition, type UnitConverter,
} from './types';

export const METHOD = 'sum(per-100g profile x grams/100); per-serving = total / servings';

interface Resolved { grams: number; estimate: boolean }

function resolveGrams(line: NutritionLine, conv: UnitConverter): Resolved | MissingReason {
  const q = line.quantity;
  let eff: Quantity;
  let est = false;
  switch (q.kind) {
    case 'to_taste': return 'to_taste';
    case 'unparsed': return 'unparsed';
    case 'range':
      if (q.min === undefined || q.max === undefined) return 'no_grams';
      eff = { ...q, kind: 'exact', value: (q.min + q.max) / 2 }; est = true; break;
    case 'approximate':
      if (q.value === undefined) return 'no_grams'; // 'a pinch' is never converted
      eff = { ...q, kind: 'exact' }; est = true; break;
    default:
      if (q.value === undefined) return 'no_grams';
      eff = q;
  }
  const r = conv.toGrams(line.ingredientId, eff);
  if (!r || !Number.isFinite(r.grams) || r.grams < 0) return 'no_grams';
  let grams = r.grams;
  est = est || r.estimate;
  if (line.gramsFactor) {
    if (!(line.gramsFactor.factor > 0) || !Number.isFinite(line.gramsFactor.factor)) return 'no_grams';
    grams *= line.gramsFactor.factor; est = true;
  }
  return { grams, estimate: est };
}

export function calculateRecipeNutrition(
  lines: NutritionLine[], servings: number, converter: UnitConverter, options: CalcOptions = {},
): RecipeNutrition {
  if (!(servings > 0) || !Number.isFinite(servings)) throw new RangeError(`servings must be > 0, got ${servings}`);
  const calculatedAt = (options.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const included = lines.filter(l => !l.optional || options.includeOptional);
  const unmatched: MissingIngredient[] = [];
  const contributing: { line: NutritionLine; grams: Resolved }[] = [];
  const failedParts: { line: NutritionLine; reason: MissingReason }[] = [];
  let counted = 0;

  for (const line of included) {
    if (line.quantity.kind === 'to_taste' && options.treatToTasteAsNegligible) {
      warnings.push(`${line.name}: 'to taste' treated as negligible`);
      continue;
    }
    counted++;
    const g = resolveGrams(line, converter);
    if (typeof g === 'string') {
      failedParts.push({ line, reason: g });
      unmatched.push({ id: line.id, name: line.name, reason: g });
      continue;
    }
    if (!line.profile) {
      failedParts.push({ line, reason: 'no_profile' });
      unmatched.push({ id: line.id, name: line.name, reason: 'no_profile' });
      continue;
    }
    contributing.push({ line, grams: g });
  }

  const profiles = new Map(
    contributing.map(c => [c.line.id, normaliseProfile(c.line.profile, warnings, c.line.name)]));

  const totals = {} as NutrientMap;
  for (const key of NUTRIENT_KEYS) {
    const parts: Part[] = [];
    for (const { line, grams } of contributing) {
      const p = profiles.get(line.id)![key];
      const srcs = p.source ? [p.source] : [];
      if (p.status === 'known' || p.status === 'zero') {
        parts.push({
          id: line.id, name: line.name, status: p.status, value: (p.value ?? 0) * grams.grams / 100,
          sources: srcs, estimate: grams.estimate || !!p.estimate, derived: !!p.derived,
        });
      } else {
        parts.push({
          id: line.id, name: line.name, status: p.status, sources: srcs, estimate: false, derived: false,
          reason: p.status === 'unavailable' ? 'nutrient_unavailable' : 'nutrient_unknown',
        });
      }
    }
    for (const f of failedParts) {
      parts.push({
        id: f.line.id, name: f.line.name, status: 'unknown', reason: f.reason,
        sources: [], estimate: false, derived: false,
      });
    }
    totals[key] = combine(key, parts, calculatedAt);
  }

  const perServing = {} as NutrientMap;
  for (const key of NUTRIENT_KEYS) perServing[key] = divideNutrient(totals[key], servings);

  return {
    servings, totals, perServing,
    ingredientCoveragePct: counted === 0 ? 0 : (contributing.length / counted) * 100,
    missingIngredients: unmatched, warnings, calculatedAt, method: METHOD,
  };
}

/** Servings changed: totals are unchanged, per-serving is re-divided. */
export function withServings(result: RecipeNutrition, servings: number): RecipeNutrition {
  if (!(servings > 0) || !Number.isFinite(servings)) throw new RangeError(`servings must be > 0, got ${servings}`);
  const perServing = {} as NutrientMap;
  for (const key of NUTRIENT_KEYS) perServing[key] = divideNutrient(result.totals[key], servings);
  return { ...result, servings, perServing };
}
