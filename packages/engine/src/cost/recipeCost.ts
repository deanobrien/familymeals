import type { Pence, PriceObservation, Quantity, RecipeIngredientLine, Uuid } from '../contract';
import { roundHalfUp } from './money';
import { matchingObservations, rankObservations, toChoice } from './price';
import type { IngredientLookup, PriceChoice, UnitConverter } from './types';

export type UncostedReason =
  | 'unmatched_ingredient' | 'approximate_quantity' | 'to_taste' | 'unparsed_quantity'
  | 'no_price' | 'not_convertible' | 'missing_unit';

export interface LineCost {
  lineId: Uuid;
  ingredientId?: Uuid;
  status: 'costed' | 'uncosted' | 'skipped_optional';
  costPence?: Pence;
  price?: PriceChoice;
  basis?: 'exact' | 'range_max';
  reason?: UncostedReason;
}

export interface RecipeCost {
  /** Sum of costed lines only. null when NOTHING could be costed (never a misleading 0). */
  totalPence: Pence | null;
  perServingPence: Pence | null;
  servings: number;
  lines: LineCost[];
  uncosted: LineCost[];
  /** costed / (costed + uncosted) by line count, 0-100. Skipped optional lines are excluded. */
  coveragePct: number;
  isPartial: boolean;
  /** true if any costed line used a generic_estimate price. */
  includesEstimates: boolean;
}

export interface RecipeCostInput {
  lines: readonly RecipeIngredientLine[];
  servings: number;
  /** Multiplier applied to every quantity (scaling to requested servings). Default 1. */
  scale?: number;
  prices: readonly PriceObservation[];
  converter: UnitConverter;
  ingredients?: IngredientLookup;
  includeOptional?: boolean;
  asOf?: string;
}

/** Resolve a usable amount from a quantity, or an uncosted reason. Ranges cost at their max (conservative). */
export function usableQuantity(q: Quantity, scale = 1):
  { q: Quantity; basis: 'exact' | 'range_max' } | { reason: UncostedReason } {
  switch (q.kind) {
    case 'exact':
      if (q.value === undefined || !(q.value >= 0)) return { reason: 'unparsed_quantity' };
      return { q: { ...q, value: q.value * scale }, basis: 'exact' };
    case 'range':
      if (q.max === undefined || !(q.max >= 0)) return { reason: 'unparsed_quantity' };
      return { q: { ...q, kind: 'exact', value: q.max * scale }, basis: 'range_max' };
    case 'approximate': return { reason: 'approximate_quantity' };
    case 'to_taste': return { reason: 'to_taste' };
    default: return { reason: 'unparsed_quantity' };
  }
}

/** Proportional price of `need` of an ingredient, trying ranked prices until one is convertible. */
export function proportionalCost(
  need: Quantity, ingredientId: Uuid, input: Pick<RecipeCostInput, 'prices' | 'converter' | 'ingredients' | 'asOf'>,
): { costPence: Pence; price: PriceChoice } | { reason: UncostedReason } {
  const ranked = rankObservations(matchingObservations(input.prices,
    { ingredientId, ...(input.asOf !== undefined ? { asOf: input.asOf } : {}) }));
  if (ranked.length === 0) return { reason: 'no_price' };
  // A unitless count is an 'item' (as in L3); the converter decides if a unit weight makes it priceable.
  const needQ: Quantity = need.unit === undefined ? { ...need, unit: 'item' } : need;
  const ing = input.ingredients?.(ingredientId);
  for (const o of ranked) {
    const pu = o.packQuantity.unit;
    if (pu === undefined || o.packQuantity.value === undefined || !(o.packQuantity.value > 0)) continue;
    const conv = input.converter.convert(needQ, pu, ing);
    if (!conv || conv.value === undefined) continue;
    return { costPence: roundHalfUp(o.pricePence * conv.value / o.packQuantity.value), price: toChoice(o) };
  }
  return { reason: 'not_convertible' };
}

export function costRecipe(input: RecipeCostInput): RecipeCost {
  const scale = input.scale ?? 1;
  const lines: LineCost[] = [];
  for (const line of [...input.lines].sort((a, b) => a.order - b.order)) {
    const base = { lineId: line.id, ...(line.ingredientId !== undefined ? { ingredientId: line.ingredientId } : {}) };
    if (line.optional && !input.includeOptional) { lines.push({ ...base, status: 'skipped_optional' }); continue; }
    if (line.ingredientId === undefined) { lines.push({ ...base, status: 'uncosted', reason: 'unmatched_ingredient' }); continue; }
    const u = usableQuantity(line.quantity, scale);
    if ('reason' in u) { lines.push({ ...base, status: 'uncosted', reason: u.reason }); continue; }
    const r = proportionalCost(u.q, line.ingredientId, input);
    if ('reason' in r) lines.push({ ...base, status: 'uncosted', reason: r.reason });
    else lines.push({ ...base, status: 'costed', costPence: r.costPence, price: r.price, basis: u.basis });
  }
  const costed = lines.filter(l => l.status === 'costed');
  const uncosted = lines.filter(l => l.status === 'uncosted');
  const denom = costed.length + uncosted.length;
  const totalPence = costed.length ? costed.reduce((s, l) => s + (l.costPence ?? 0), 0) : null;
  const servings = input.servings;
  return {
    totalPence,
    perServingPence: totalPence !== null && servings > 0 ? roundHalfUp(totalPence / servings) : null,
    servings, lines, uncosted,
    coveragePct: denom === 0 ? 0 : Math.round((costed.length / denom) * 1000) / 10,
    isPartial: uncosted.length > 0,
    includesEstimates: costed.some(l => l.price?.isEstimate),
  };
}
