// PR1 (D280-D289): minimum stock ("par levels") and restock suggestions. Pure and deterministic.
//
// A par level says "keep at least `min` of X in" (optionally "restock to" a higher number, rounded up to whole packs).
// It is stored apart from pantry stock, so it survives the stock hitting zero. `restockSuggestions` is computed on read:
// nothing here writes anything.
import type { IsoDate, IsoDateTime, Quantity, Uuid } from '../contract';
import { assessConfidence, daysBetween, EPS, exactQ, isExact, round6, today } from './common';
import type { PantryItem, StalenessPolicy, UnitConverter } from './types';

export type RestockUnit = NonNullable<Quantity['unit']>;

export interface ParLevel {
  id: Uuid;
  householdId: Uuid;
  /** Canonical ingredient; absent for free-text items (matched by normalised name). */
  ingredientId?: Uuid;
  name: string;
  /** The unit the minimum is counted in (and the unit suggestions are expressed in). */
  unit: RestockUnit;
  minValue: number;
  /** Top-up target. Defaults to `minValue`; never below it. */
  restockToValue?: number;
  /** Preferred pack size, in any unit convertible to `unit` (e.g. 400 g). Suggestions round up to whole packs. */
  pack?: { value: number; unit: RestockUnit };
  enabled: boolean;
  /** Hidden while today is before this date (snooze / dismiss for N days). */
  snoozedUntil?: IsoDate;
}

/** An item that is already on the shopping list (outstanding), or bought but not yet in the pantry. */
export interface OutstandingItem {
  ingredientId?: Uuid;
  name: string;
  quantity: Quantity;
  /** 'list' (default) = still to buy; 'incoming' = bought, waiting to be confirmed into the pantry. */
  source?: 'list' | 'incoming';
}

export interface PlanRequirement { ingredientId?: Uuid; name: string; quantity: Quantity }

export interface RestockOpts {
  now: IsoDateTime;
  policy?: StalenessPolicy;
  /** Count stale (unconfirmed) stock as available. Default false: stale stock is not trusted. */
  countStale?: boolean;
  /** Return snoozed suggestions too (flagged `snoozed`). Default false. */
  includeSnoozed?: boolean;
  /** This week's approved-plan requirements: adds separate "will run low" suggestions. */
  planRequirements?: readonly PlanRequirement[];
}

export type RestockKind = 'below_min' | 'will_run_low';

export interface RestockSuggestion {
  parId: Uuid;
  kind: RestockKind;
  ingredientId?: Uuid;
  name: string;
  unit: RestockUnit;
  /** Trusted stock counted, in `unit`. */
  available: number;
  min: number;
  restockTo: number;
  /** Already on the list (and bought-not-yet-in-pantry), in `unit`. */
  onList: number;
  /** Planned use this week in `unit` (will_run_low only). */
  planned?: number;
  /** How much to add, in `unit`. Whole packs when a pack size is set; whole numbers for count units. Always > 0. */
  quantity: number;
  /** Number of packs and the pack size in `unit`, when a pack size is set. */
  packs?: number;
  packSize?: number;
  /** True when some stock / list quantity could not be compared (unit mismatch, approximate, no quantity). */
  checkQuantity: boolean;
  snoozed: boolean;
  /** One plain-English line, e.g. "You have 2 cans; minimum 6; 0 already on the list -> add 4". */
  explanation: string;
  notes: string[];
}

const COUNT_WORDS: Record<string, [string, string]> = {
  item: ['item', 'items'], clove: ['clove', 'cloves'], slice: ['slice', 'slices'], can: ['can', 'cans'],
  pack: ['pack', 'packs'], bunch: ['bunch', 'bunches'], sprig: ['sprig', 'sprigs'], stick: ['stick', 'sticks'],
};
const WHOLE_UNITS = new Set(Object.keys(COUNT_WORDS));

/** "4 cans", "400 g", "1 item". */
export function unitText(value: number, unit: RestockUnit): string {
  const v = round6(value);
  const words = COUNT_WORDS[unit];
  if (words) return `${v} ${v === 1 ? words[0] : words[1]}`;
  return `${v} ${unit === 'floz' ? 'fl oz' : unit}`;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const parKey = (p: { ingredientId?: Uuid; name: string }): string =>
  p.ingredientId ? `ing:${p.ingredientId}` : `name:${norm(p.name)}`;

/** A stock / list item belongs to a par level by canonical ingredient, or - for free text - by normalised name. */
function matches(par: ParLevel, other: { ingredientId?: Uuid; name: string }): boolean {
  if (par.ingredientId && other.ingredientId) return par.ingredientId === other.ingredientId;
  return norm(par.name) === norm(other.name);
}

interface Tally { total: number; check: string[]; staleCount: number; staleName?: string }

/** Convert `q` into `unit`; null if impossible (never guesses across mass/volume/count without data). */
function inUnit(q: Quantity, unit: RestockUnit, par: ParLevel, converter: UnitConverter): number | null {
  if (!isExact(q)) return null;
  if (q.unit === unit) return q.value;
  if (!q.unit) return null;
  const c = converter.convert(q, unit, par.ingredientId);
  return c && isExact(c) ? c.value : null;
}

/** Trusted stock for one par level (same counting rules as `restockSuggestions`): total in `par.unit` + anything not comparable. */
export function stockAvailable(
  par: ParLevel, stock: readonly PantryItem[], converter: UnitConverter, opts: Pick<RestockOpts, 'now' | 'policy' | 'countStale'>,
): { total: number; check: string[]; staleCount: number } {
  const t = sumStock(par, stock, converter, { ...opts });
  return { total: t.total, check: t.check, staleCount: t.staleCount };
}

function sumStock(par: ParLevel, stock: readonly PantryItem[], converter: UnitConverter, opts: Pick<RestockOpts, 'now' | 'policy' | 'countStale'>): Tally {
  const policy = opts.policy ?? { staleAfterDays: 14 };
  const t: Tally = { total: 0, check: [], staleCount: 0 };
  for (const it of stock) {
    if (!matches(par, it)) continue;
    const conf = assessConfidence(it, opts.now, policy);
    if (conf.status === 'expired') continue; // expired stock is never counted, and needs no flag: it is simply gone
    if (conf.status === 'stale' && !opts.countStale) { t.staleCount++; t.staleName = it.name; continue; }
    const v = inUnit(it.quantity, par.unit, par, converter);
    if (v === null) {
      t.check.push(isExact(it.quantity) ? `${it.name} (${unitText(it.quantity.value, it.quantity.unit ?? 'item')}) cannot be compared with ${par.unit}` : `${it.name} has an approximate quantity`);
      continue;
    }
    t.total += v;
  }
  t.total = round6(t.total);
  return t;
}

function sumOutstanding(par: ParLevel, list: readonly OutstandingItem[] | readonly PlanRequirement[], converter: UnitConverter, label: string): Tally {
  const t: Tally = { total: 0, check: [], staleCount: 0 };
  for (const it of list) {
    if (!matches(par, it)) continue;
    const v = inUnit(it.quantity, par.unit, par, converter);
    if (v === null) t.check.push(`${it.name} is ${label} without a comparable quantity`);
    else t.total += v;
  }
  t.total = round6(t.total);
  return t;
}

function roundToPacks(need: number, par: ParLevel, converter: UnitConverter): { quantity: number; packs?: number; packSize?: number; note?: string } {
  if (par.pack) {
    const size = inUnit(exactQ(par.pack.value, par.pack.unit), par.unit, par, converter);
    if (size !== null && size > EPS) {
      const packs = Math.ceil(round6(need / size) - 1e-9);
      return { quantity: round6(packs * size), packs, packSize: round6(size) };
    }
    return { quantity: WHOLE_UNITS.has(par.unit) ? Math.ceil(need - 1e-9) : round6(need), note: 'pack size could not be converted, so it was ignored' };
  }
  return { quantity: WHOLE_UNITS.has(par.unit) ? Math.ceil(need - 1e-9) : round6(need) };
}

/**
 * What to add to the shopping list to keep the pantry at its minimums.
 *
 * - Below minimum: trusted stock (confident, non-expired, convertible; stale only with `countStale`) < min.
 *   Suggest `restockTo - available - alreadyOnList`, never negative; nothing when the list already covers it.
 * - Will run low (opt-in via `planRequirements`): not below minimum now, but `available + onList - plannedUse < min`.
 *   Always labelled separately (`kind: 'will_run_low'`); never produced for a par that is already below minimum.
 * - Snoozed pars are hidden unless `includeSnoozed`. Disabled pars are ignored.
 * - Anything that cannot be compared safely (unit mismatch with no conversion, approximate quantities, list items with no
 *   quantity) sets `checkQuantity` instead of being guessed.
 *
 * Deterministic: sorted by name then par id.
 */
export function restockSuggestions(
  stock: readonly PantryItem[],
  pars: readonly ParLevel[],
  outstanding: readonly OutstandingItem[],
  converter: UnitConverter,
  opts: RestockOpts,
): RestockSuggestion[] {
  const out: RestockSuggestion[] = [];
  const day = today(opts.now);
  for (const par of pars) {
    if (!par.enabled || !(par.minValue > 0)) continue;
    const snoozed = !!par.snoozedUntil && daysBetween(day, par.snoozedUntil) > 0;
    if (snoozed && !opts.includeSnoozed) continue;

    const have = sumStock(par, stock, converter, opts);
    const list = sumOutstanding(par, outstanding, converter, 'on the list');
    const min = par.minValue;
    const restockTo = Math.max(min, par.restockToValue ?? min);
    const notes = [...have.check, ...list.check];
    if (have.staleCount > 0) {
      notes.push(`${have.staleCount === 1 ? have.staleName ?? 'One item' : `${have.staleCount} items`} not counted: please confirm in your pantry`);
    }

    let kind: RestockKind | null = null;
    let planned: number | undefined;
    let base = have.total + list.total;
    if (have.total < min - EPS) {
      kind = 'below_min';
    } else if (opts.planRequirements?.length) {
      const use = sumOutstanding(par, opts.planRequirements, converter, 'in the plan');
      notes.push(...use.check);
      if (use.total > EPS && have.total + list.total - use.total < min - EPS) {
        kind = 'will_run_low';
        planned = use.total;
        base = have.total + list.total - use.total;
      }
    }
    if (!kind) continue;

    const need = restockTo - base;
    if (need <= EPS) continue; // already covered by what is on the list
    const rounded = roundToPacks(need, par, converter);
    if (rounded.note) notes.push(rounded.note);

    const bits = kind === 'below_min'
      ? [`You have ${unitText(have.total, par.unit)}`, `minimum ${unitText(min, par.unit)}`, `${unitText(list.total, par.unit)} already on the list`]
      : [`After this week's plan you would have ${unitText(Math.max(0, base), par.unit)} (have ${unitText(have.total, par.unit)}, plan uses ${unitText(planned ?? 0, par.unit)}, ${unitText(list.total, par.unit)} on the list)`, `minimum ${unitText(min, par.unit)}`];
    let explanation = `${bits.join('; ')} -> add ${unitText(rounded.quantity, par.unit)}`;
    if (rounded.packs !== undefined && rounded.packSize !== undefined) {
      explanation += ` (${rounded.packs} x ${unitText(rounded.packSize, par.unit)})`;
    }
    if (restockTo > min + EPS) explanation += `; restock to ${unitText(restockTo, par.unit)}`;
    const check = have.check.length > 0 || list.check.length > 0;
    if (check) explanation += '. Check the quantity: some of what you have could not be compared';

    out.push({
      parId: par.id, kind, ...(par.ingredientId ? { ingredientId: par.ingredientId } : {}), name: par.name, unit: par.unit,
      available: have.total, min, restockTo, onList: list.total, ...(planned !== undefined ? { planned } : {}),
      quantity: rounded.quantity,
      ...(rounded.packs !== undefined ? { packs: rounded.packs, packSize: rounded.packSize as number } : {}),
      checkQuantity: check, snoozed, explanation, notes,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.parId.localeCompare(b.parId));
}
