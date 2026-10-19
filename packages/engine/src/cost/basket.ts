import type { Pence, PriceObservation, ProductPack, Quantity, Requirement, Unit, Uuid } from '../contract';
import { roundHalfUp } from './money';
import { matchingObservations, rankObservations, toChoice } from './price';
import { usableQuantity, type UncostedReason } from './recipeCost';
import type { IngredientLookup, PantryStock, PriceChoice, UnitConverter } from './types';

export interface BasketInput {
  requirements: readonly Requirement[];
  pantry: readonly PantryStock[];
  packs: readonly ProductPack[];
  prices: readonly PriceObservation[];
  converter: UnitConverter;
  ingredients?: IngredientLookup;
  asOf?: string;
  /** Safety cap on pack-combination search; greedy fallback beyond it. */
  maxCombinations?: number;
}

export interface PackChoice {
  packId?: Uuid; name: string; count: number; unitPricePence: Pence; price: PriceChoice;
  /** true when the pack price was derived from a per-ingredient price rather than a pack observation. */
  derivedPrice: boolean;
}

export type BasketStatus = 'costed' | 'covered_by_pantry' | 'uncosted';

export interface BasketItem {
  displayName: string;
  ingredientId?: Uuid;
  status: BasketStatus;
  needed?: Quantity;
  pantryDeducted?: Quantity;
  toBuy?: Quantity;
  packs: PackChoice[];
  costPence?: Pence;
  leftover?: Quantity;
  /** leftover / purchased supply, 0-100 */
  wastePct?: number;
  isEstimate?: boolean;
  reason?: UncostedReason | 'no_packs' | 'pack_not_convertible';
  unresolved?: Quantity[];
  explanation: string;
}

export interface BasketCost {
  /** Sum of costed items; null when nothing was costed or covered by pantry. */
  totalPence: Pence | null;
  items: BasketItem[];
  uncosted: BasketItem[];
  /** (costed + pantry-covered) / all items, 0-100. */
  coveragePct: number;
  isPartial: boolean;
  includesEstimates: boolean;
}

export interface PackCandidate {
  name: string; packId?: Uuid; size: number; pricePence: Pence; price: PriceChoice; derived: boolean;
}

const EPS = 1e-9;
const fmt = (q: Quantity) => `${Math.round((q.value ?? 0) * 1000) / 1000}${q.unit ? ' ' + q.unit : ''}`;
const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;
const exact = (value: number, unit: Unit): Quantity => ({ kind: 'exact', value, unit, originalText: '' });

function candidatesFor(ingredientId: Uuid, unit: Unit, input: BasketInput): PackCandidate[] | 'no_packs' | 'pack_not_convertible' {
  const ing = input.ingredients?.(ingredientId);
  const packs = input.packs.filter(p => p.ingredientId === ingredientId);
  if (packs.length === 0) return 'no_packs';
  const asOf = input.asOf !== undefined ? { asOf: input.asOf } : {};
  const out: PackCandidate[] = [];
  let convertibleAny = false;
  for (const p of packs) {
    const pq = p.quantity;
    if (pq.unit === undefined || pq.value === undefined || !(pq.value > 0)) continue;
    const size = input.converter.convert(pq, unit, ing);
    if (!size || size.value === undefined || !(size.value > 0)) continue;
    convertibleAny = true;
    // Prefer a price observed for this exact pack; else derive from the best ingredient-level price.
    const direct = rankObservations(matchingObservations(input.prices, { productPackId: p.id, ...asOf }))[0];
    if (direct) {
      out.push({ name: p.name, packId: p.id, size: size.value, pricePence: direct.pricePence, price: toChoice(direct), derived: false });
      continue;
    }
    for (const o of rankObservations(matchingObservations(input.prices, { ingredientId, ...asOf }))) {
      const ou = o.packQuantity.unit;
      if (ou === undefined || !(o.packQuantity.value && o.packQuantity.value > 0)) continue;
      const inObsUnit = input.converter.convert(pq, ou, ing);
      if (!inObsUnit || inObsUnit.value === undefined) continue;
      out.push({ name: p.name, packId: p.id, size: size.value,
        pricePence: roundHalfUp(o.pricePence * inObsUnit.value / o.packQuantity.value), price: toChoice(o), derived: true });
      break;
    }
  }
  return convertibleAny ? out : 'pack_not_convertible';
}

interface Pick { counts: number[]; cost: Pence; supply: number; n: number }

/**
 * Minimum-cost multiset of packs covering `need`. Ties: least waste, then fewest packs, then
 * candidate order. Exhaustive with per-pack bound ceil(need/size) (buying more of one pack than
 * would cover the need alone is never optimal); greedy fallback if the search space exceeds the cap.
 */
export function choosePacks(need: number, cands: readonly PackCandidate[], maxCombinations = 200_000): Pick | null {
  if (cands.length === 0) return null;
  const bounds = cands.map(c => Math.ceil(need / c.size - EPS));
  let combos = 1;
  for (const b of bounds) { combos *= b + 1; if (combos > maxCombinations) break; }

  if (combos > maxCombinations) {
    const order = cands.map((_, i) => i).sort((a, b) =>
      cands[a]!.pricePence / cands[a]!.size - cands[b]!.pricePence / cands[b]!.size);
    const top = order[0]!;
    const counts = cands.map(() => 0);
    const full = Math.floor(need / cands[top]!.size + EPS);
    counts[top] = full;
    let supply = full * cands[top]!.size;
    let cost = full * cands[top]!.pricePence;
    let n = full;
    if (supply < need - EPS) {
      let bi = -1;
      for (const i of order) {
        if (cands[i]!.size >= need - supply - EPS && (bi < 0 || cands[i]!.pricePence < cands[bi]!.pricePence)) bi = i;
      }
      const i = bi >= 0 ? bi : top;
      counts[i] = (counts[i] ?? 0) + 1; supply += cands[i]!.size; cost += cands[i]!.pricePence; n += 1;
    }
    return { counts, cost, supply, n };
  }

  let best: Pick | null = null;
  const counts = cands.map(() => 0);
  const rec = (i: number, cost: number, supply: number, n: number): void => {
    if (i === cands.length) {
      if (supply < need - EPS) return;
      if (!best || cost < best.cost
        || (cost === best.cost && (supply < best.supply - EPS || (Math.abs(supply - best.supply) <= EPS && n < best.n)))) {
        best = { counts: [...counts], cost, supply, n };
      }
      return;
    }
    for (let k = 0; k <= bounds[i]!; k++) {
      counts[i] = k;
      rec(i + 1, cost + k * cands[i]!.pricePence, supply + k * cands[i]!.size, n + k);
    }
    counts[i] = 0;
  };
  rec(0, 0, 0, 0);
  return best;
}

function pantryFor(ingredientId: Uuid, unit: Unit, input: BasketInput): number {
  const ing = input.ingredients?.(ingredientId);
  let total = 0;
  for (const s of input.pantry) {
    if (s.ingredientId !== ingredientId) continue;
    const u = usableQuantity(s.quantity);
    if ('reason' in u) continue; // unknown pantry amounts are never assumed to cover anything
    const c = input.converter.convert(u.q, unit, ing);
    if (c?.value !== undefined && c.value > 0) total += c.value;
  }
  return total;
}

export function costBasket(input: BasketInput): BasketCost {
  const items: BasketItem[] = [];
  // Pantry stock is shared across requirements of the same ingredient+unit (never double-counted).
  const pantryUsed = new Map<string, number>();

  for (const req of input.requirements) {
    const unresolved = req.unresolved?.length ? { unresolved: [...req.unresolved] } : {};
    const unc = (reason: NonNullable<BasketItem['reason']>, explanation: string): BasketItem => ({
      displayName: req.displayName, ...(req.ingredientId !== undefined ? { ingredientId: req.ingredientId } : {}),
      status: 'uncosted', packs: [], reason, explanation, ...unresolved,
    });
    if (req.ingredientId === undefined) {
      items.push(unc('unmatched_ingredient', `${req.displayName}: ingredient not matched, cannot price.`)); continue;
    }
    const u = usableQuantity(req.quantity);
    if ('reason' in u) {
      items.push(unc(u.reason, `${req.displayName}: quantity "${req.quantity.originalText}" is not exact; left uncosted (not assumed free).`)); continue;
    }
    const unit = u.q.unit;
    if (unit === undefined) { items.push(unc('missing_unit', `${req.displayName}: no unit on quantity.`)); continue; }
    const needed = u.q.value ?? 0;

    const key = `${req.ingredientId}|${unit}`;
    const available = Math.max(0, pantryFor(req.ingredientId, unit, input) - (pantryUsed.get(key) ?? 0));
    const deducted = Math.min(available, needed);
    pantryUsed.set(key, (pantryUsed.get(key) ?? 0) + deducted);
    const remaining = needed - deducted;
    const base = {
      displayName: req.displayName, ingredientId: req.ingredientId,
      needed: exact(needed, unit), pantryDeducted: exact(deducted, unit), ...unresolved,
    };

    if (remaining <= EPS) {
      items.push({ ...base, status: 'covered_by_pantry', packs: [], costPence: 0, toBuy: exact(0, unit),
        explanation: `${req.displayName}: need ${fmt(exact(needed, unit))}, pantry covers it all. Nothing to buy.` });
      continue;
    }
    const cands = candidatesFor(req.ingredientId, unit, input);
    if (typeof cands === 'string') {
      items.push({ ...base, status: 'uncosted', packs: [], toBuy: exact(remaining, unit), reason: cands,
        explanation: `${req.displayName}: ${cands === 'no_packs' ? 'no pack sizes known' : 'pack sizes cannot be converted to the required unit'}; left uncosted.` });
      continue;
    }
    const pick = choosePacks(remaining, cands, input.maxCombinations);
    if (!pick) {
      items.push({ ...base, status: 'uncosted', packs: [], toBuy: exact(remaining, unit), reason: 'no_price',
        explanation: `${req.displayName}: packs known but no price available; left uncosted.` });
      continue;
    }
    const packs: PackChoice[] = pick.counts.flatMap((count, i) => count > 0 ? [{
      ...(cands[i]!.packId !== undefined ? { packId: cands[i]!.packId } : {}),
      name: cands[i]!.name, count, unitPricePence: cands[i]!.pricePence, price: cands[i]!.price, derivedPrice: cands[i]!.derived,
    }] : []);
    const leftover = Math.max(0, pick.supply - remaining);
    const isEstimate = packs.some(p => p.price.isEstimate);
    const desc = packs.map(p => `${p.count} x ${p.name} @ ${pounds(p.unitPricePence)}`).join(' + ');
    items.push({
      ...base, status: 'costed', toBuy: exact(remaining, unit), packs, costPence: pick.cost,
      leftover: exact(leftover, unit), wastePct: Math.round((leftover / pick.supply) * 1000) / 10, isEstimate,
      explanation: `${req.displayName}: need ${fmt(exact(needed, unit))}`
        + (deducted > 0 ? `, pantry ${fmt(exact(deducted, unit))}, buy ${fmt(exact(remaining, unit))}` : '')
        + `. Cheapest cover: ${desc} = ${pounds(pick.cost)}; leftover ${fmt(exact(leftover, unit))}${isEstimate ? ' (estimated price)' : ''}.`,
    });
  }

  const priced = items.filter(i => i.status !== 'uncosted');
  const uncosted = items.filter(i => i.status === 'uncosted');
  return {
    totalPence: priced.length ? priced.reduce((s, i) => s + (i.costPence ?? 0), 0) : null,
    items, uncosted,
    coveragePct: items.length === 0 ? 0 : Math.round((priced.length / items.length) * 1000) / 10,
    isPartial: uncosted.length > 0,
    includesEstimates: items.some(i => i.isEstimate),
  };
}
