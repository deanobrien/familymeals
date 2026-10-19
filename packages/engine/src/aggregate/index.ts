/**
 * Combine recipe ingredient lines (across recipes / planned meals) into shopping Requirements.
 *
 * Guarantees:
 *  - Full provenance: every input line appears exactly once in some requirement's `contributions`.
 *  - Only numeric (exact/range) quantities are summed, and only within a compatible bucket:
 *      mass | volume | count-of-<unit>. volume joins mass only with `densityGPerMl`;
 *      'item' counts join mass only with `unitWeightG` AND `allowEstimatedCountToMass` (flagged estimate).
 *  - Everything else (other buckets, approximate, to_taste, unparsed) is kept in `unresolved`.
 *  - Optional and required lines never combine — an optional garnish can't inflate a required amount.
 *  - Deterministic and order-independent: the result depends only on the multiset of inputs, so
 *    aggregation is commutative and associative (see `mergeRequirementSets`).
 */
import type {
  CanonicalIngredient,
  Contribution,
  Quantity,
  RecipeIngredientLine,
  Requirement,
  Unit,
  Uuid,
} from '../contract';
import { normaliseName } from '../normalise/index';
import { scaleQuantity } from '../scale/index';
import { baseUnitOf, conversionFactor, dimensionOf, isNumericQuantity, roundStored, UNIT_INFO } from '../units/index';

export interface AggregateInput {
  line: RecipeIngredientLine;
  plannedMealId?: Uuid;
  /** Name used for display and for grouping lines that have no `ingredientId`. */
  name?: string;
  /** Servings scale factor applied before combining (default 1). */
  scale?: number;
}

export interface AggregateOptions {
  /** Allow 'item' counts to join a mass total via `unitWeightG`. Result is flagged `estimate`. Default false. */
  allowEstimatedCountToMass?: boolean;
}

export interface AggregatedRequirement extends Requirement {
  /** Stable grouping key ("id:<uuid>", "name:<normalised>", or "line:<id>", plus "|optional"). */
  key: string;
  optional: boolean;
  /** True if any part of `quantity` relied on an estimated unit weight. */
  estimate: boolean;
}

export type Catalogue = Iterable<CanonicalIngredient> | ReadonlyMap<Uuid, CanonicalIngredient>;

function toCatalogueMap(catalogue: Catalogue): ReadonlyMap<Uuid, CanonicalIngredient> {
  if (catalogue instanceof Map) return catalogue as ReadonlyMap<Uuid, CanonicalIngredient>;
  const m = new Map<Uuid, CanonicalIngredient>();
  for (const ing of catalogue as Iterable<CanonicalIngredient>) m.set(ing.id, ing);
  return m;
}

/** Grouping key for one input line. */
export function requirementKey(input: AggregateInput): string {
  const { line } = input;
  let base: string;
  if (line.ingredientId) base = `id:${line.ingredientId}`;
  else {
    const k = input.name ? normaliseName(input.name).key : '';
    base = k ? `name:${k}` : `line:${line.id}`;
  }
  return line.optional ? `${base}|optional` : base;
}

interface Group {
  key: string;
  ingredientId?: Uuid;
  optional: boolean;
  names: string[];
  contributions: Contribution[];
}

/** Aggregate lines into requirements, sorted by displayName then key. */
export function aggregateRequirements(
  inputs: readonly AggregateInput[],
  catalogue: Catalogue = [],
  options: AggregateOptions = {},
): AggregatedRequirement[] {
  const groups = new Map<string, Group>();
  for (const input of inputs) {
    const key = requirementKey(input);
    let g = groups.get(key);
    if (!g) {
      g = { key, optional: input.line.optional, names: [], contributions: [] };
      if (input.line.ingredientId) g.ingredientId = input.line.ingredientId;
      groups.set(key, g);
    }
    const name = input.name?.trim();
    if (name) g.names.push(name);
    const quantity = input.scale === undefined || input.scale === 1 ? input.line.quantity : scaleQuantity(input.line.quantity, input.scale);
    const c: Contribution = { recipeId: input.line.recipeId, recipeIngredientId: input.line.id, quantity };
    if (input.plannedMealId) c.plannedMealId = input.plannedMealId;
    g.contributions.push(c);
  }
  const cat = toCatalogueMap(catalogue);
  return finish([...groups.values()], cat, options);
}

/**
 * Merge two previously aggregated sets (e.g. adding a meal to an existing list).
 * mergeRequirementSets(aggregate(A), aggregate(B)) deep-equals aggregate(A ++ B).
 */
export function mergeRequirementSets(
  a: readonly AggregatedRequirement[],
  b: readonly AggregatedRequirement[],
  catalogue: Catalogue = [],
  options: AggregateOptions = {},
): AggregatedRequirement[] {
  const groups = new Map<string, Group>();
  for (const r of [...a, ...b]) {
    let g = groups.get(r.key);
    if (!g) {
      g = { key: r.key, optional: r.optional, names: [], contributions: [] };
      if (r.ingredientId) g.ingredientId = r.ingredientId;
      groups.set(r.key, g);
    }
    if (r.displayName !== fallbackName(r.key, r.contributions)) g.names.push(r.displayName);
    g.contributions.push(...r.contributions);
  }
  return finish([...groups.values()], toCatalogueMap(catalogue), options);
}

function finish(groups: Group[], cat: ReadonlyMap<Uuid, CanonicalIngredient>, options: AggregateOptions): AggregatedRequirement[] {
  const out = groups.map((g) => buildRequirement(g, g.ingredientId ? cat.get(g.ingredientId) : undefined, options));
  return out.sort((x, y) => cmp(x.displayName, y.displayName) || cmp(x.key, y.key));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function quantitySortKey(q: Quantity): string {
  return [q.kind, q.unit ?? '', q.value ?? '', q.min ?? '', q.max ?? '', q.approxLabel ?? '', q.originalText].join('\u0001');
}

function contributionSortKey(c: Contribution): string {
  return [c.recipeIngredientId, c.recipeId, c.plannedMealId ?? '', quantitySortKey(c.quantity)].join('\u0002');
}

interface BucketEntry {
  q: Quantity;
  /** Unit after any cross-dimension conversion, plus the factor to reach it. */
  unit: Unit | undefined;
  factor: number;
  converted: boolean;
  estimate: boolean;
}

type BucketKey = string; // 'mass' | 'volume' | `count:${unit}`

function bucketKeyOf(unit: Unit | undefined): BucketKey {
  const dim = dimensionOf(unit);
  return dim === 'count' ? `count:${unit ?? 'item'}` : dim;
}

function bucketRank(key: BucketKey): string {
  if (key === 'mass') return '0';
  if (key === 'volume') return '1';
  if (key === 'count:item') return '2';
  return `3${key}`;
}

function buildRequirement(g: Group, ingredient: CanonicalIngredient | undefined, options: AggregateOptions): AggregatedRequirement {
  const contributions = [...g.contributions].sort((x, y) => cmp(contributionSortKey(x), contributionSortKey(y)));
  const displayName = ingredient?.name ?? [...g.names].sort(cmp)[0] ?? fallbackName(g.key, contributions);

  const buckets = new Map<BucketKey, BucketEntry[]>();
  const nonNumeric: Quantity[] = [];
  for (const c of contributions) {
    const q = c.quantity;
    if (!isNumericQuantity(q)) {
      nonNumeric.push(q);
      continue;
    }
    const key = bucketKeyOf(q.unit);
    const list = buckets.get(key) ?? [];
    list.push({ q, unit: q.unit, factor: 1, converted: false, estimate: false });
    buckets.set(key, list);
  }

  // volume -> mass, only with a density and only when both exist (otherwise keep the cook's unit).
  if (buckets.has('mass') && buckets.has('volume') && ingredient?.densityGPerMl) {
    moveBucket(buckets, 'volume', 'mass', ingredient, false);
  }
  // item -> mass, only with unit weight and explicit opt-in (estimate).
  if (options.allowEstimatedCountToMass && buckets.has('mass') && buckets.has('count:item') && ingredient?.unitWeightG) {
    moveBucket(buckets, 'count:item', 'mass', ingredient, true);
  }

  const summed = [...buckets.entries()]
    .map(([key, entries]) => ({ key, entries, ...sumBucket(entries) }))
    .sort((x, y) => y.entries.length - x.entries.length || cmp(bucketRank(x.key), bucketRank(y.key)));

  let quantity: Quantity;
  let unresolved: Quantity[] = [];
  let estimate = false;
  const primary = summed[0];
  if (primary) {
    quantity = primary.quantity;
    estimate = primary.estimate;
    unresolved = [...summed.slice(1).map((s) => s.quantity), ...nonNumeric];
  } else if (nonNumeric.every((q) => q.kind === 'to_taste')) {
    quantity = { kind: 'to_taste', originalText: joinTexts(nonNumeric) };
  } else if (nonNumeric.length === 1) {
    quantity = nonNumeric[0]!;
  } else {
    const approx = nonNumeric.filter((q) => q.kind === 'approximate');
    if (approx.length > 0) {
      const labels = [...new Set(approx.map((q) => q.approxLabel ?? ''))];
      quantity = { kind: 'approximate', originalText: joinTexts(nonNumeric) };
      if (labels.length === 1 && labels[0]) quantity.approxLabel = labels[0];
    } else {
      quantity = { kind: 'unparsed', originalText: joinTexts(nonNumeric) };
    }
    unresolved = [...nonNumeric];
  }

  const req: AggregatedRequirement = { key: g.key, displayName, quantity, contributions, optional: g.optional, estimate };
  if (g.ingredientId) req.ingredientId = g.ingredientId;
  if (unresolved.length > 0) req.unresolved = unresolved;
  return req;
}

/** Name used when neither the catalogue nor any input supplied one. Depends only on the group. */
function fallbackName(key: string, contributions: readonly Contribution[]): string {
  if (key.startsWith('line:')) {
    const texts = contributions.map((c) => c.quantity.originalText).sort(cmp);
    if (texts[0]) return texts[0];
  }
  return 'Unknown ingredient';
}

function joinTexts(qs: Quantity[]): string {
  return qs.map((q) => q.originalText).join(' + ');
}

function moveBucket(
  buckets: Map<BucketKey, BucketEntry[]>,
  from: BucketKey,
  to: BucketKey,
  ingredient: CanonicalIngredient,
  estimate: boolean,
): void {
  const src = buckets.get(from)!;
  const dst = buckets.get(to)!;
  for (const e of src) {
    // Caller guarantees the needed density / unit weight is present, so this cannot fail.
    const f = conversionFactor(e.unit, 'g', ingredient, { allowEstimate: estimate }) as { ok: true; factor: number; estimate: boolean };
    dst.push({ q: e.q, unit: 'g', factor: f.factor, converted: true, estimate: f.estimate });
  }
  buckets.delete(from);
}

/** Sum a bucket. Keeps the cook's unit when every entry shares it; otherwise uses the base unit. */
function sumBucket(entries: BucketEntry[]): { quantity: Quantity; estimate: boolean } {
  const first = entries[0]!;
  const sameUnit = entries.every((e) => !e.converted && e.q.unit === first.q.unit);
  const target: Unit | undefined = sameUnit ? first.q.unit : baseUnitOf(first.converted ? 'g' : first.q.unit);
  let min = 0;
  let max = 0;
  let anyRange = false;
  let estimate = false;
  for (const e of entries) {
    const lo = e.q.kind === 'exact' ? e.q.value! : e.q.min!;
    const hi = e.q.kind === 'exact' ? e.q.value! : e.q.max!;
    if (e.q.kind === 'range') anyRange = true;
    estimate ||= e.estimate;
    // value in target = value_in_original_unit * factor_to(e.unit) * toBase(e.unit) / toBase(target)
    const k = sameUnit ? 1 : (e.factor * UNIT_INFO[e.unit ?? 'item'].toBase) / UNIT_INFO[target ?? 'item'].toBase;
    min += lo * k;
    max += hi * k;
  }
  min = roundStored(min);
  max = roundStored(max);
  const originalText = entries.map((e) => e.q.originalText).join(' + ');
  const quantity: Quantity = anyRange && min !== max
    ? { kind: 'range', min, max, originalText }
    : { kind: 'exact', value: min, originalText };
  if (target !== undefined) quantity.unit = target;
  return { quantity, estimate };
}
