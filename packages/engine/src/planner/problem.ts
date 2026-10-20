import type { DietCategory, IsoDate, MealType } from '../contract';
import { addDays, daysBetween, weekdayOf, type Weekday } from './dates';
import {
  DEFAULT_WEIGHTS,
  DIET_CATEGORIES,
  MEAL_TYPES,
  PlanConstraintsSchema,
  RecipeCandidateSchema,
  type DietTarget,
  type PlanConstraints,
  type PlanConstraintsInput,
  type PlannerOptions,
  type PlannerWeights,
  type RecipeCandidate,
  type RecipeCandidateInput,
  type SkipReason,
} from './schemas';

export type HardReasonCode =
  | 'excluded_ingredient'
  | 'allergen'
  | 'excluded_term'
  | 'unmatched_line_term'
  | 'unverified_ingredients'
  | 'excluded_diet'
  | 'excluded_tag';

export interface HardReason {
  code: HardReasonCode;
  message: string;
}

export interface PreparedSlot {
  index: number;
  key: string;
  date: IsoDate;
  mealType: MealType;
  weekday: Weekday;
  skipReason?: SkipReason;
  skipNote?: string;
  quickMaxMinutes?: number;
  /** HARD quick slot (`quickMeals.strict`): only recipes within `quickMaxMinutes` may fill it. */
  quickStrict?: boolean;
  /** Candidate indices passing the hard filter AND suitable for this meal type, in id order. */
  eligible: number[];
  eligibleSet: Set<number>;
  lockedCandidate?: number;
}

export interface ResolvedTarget {
  category: DietCategory;
  spec: DietTarget;
  lo: number;
  hi: number;
  /** Unrounded expected count for fraction targets. */
  raw?: number;
}

export interface Problem {
  constraints: PlanConstraints;
  candidates: RecipeCandidate[];
  idIndex: Map<string, number>;
  hardReasons: HardReason[][];
  globallyEligible: number[];
  slots: PreparedSlot[];
  slotIndex: Map<string, number>;
  plannable: number[];
  targets: ResolvedTarget[];
  weights: PlannerWeights;
  firstDate: IsoDate;
  imputedCostPerServing: number;
  notes: string[];
  lockIssues: string[];
  labels: NonNullable<PlannerOptions['labels']>;
  /** Precomputed per-candidate flags. */
  isFavourite: boolean[];
  /** Per candidate: how many distinct members dislike something in it (soft). */
  dislikeCount: number[];
  tagHits: number[];
  isRecent: boolean[];
}

/** A recipe with unknown time is never 'quick' (honest: unknown is not fast). */
export const isQuickEnough = (c: RecipeCandidate, maxMinutes: number): boolean => c.totalMinutes !== null && c.totalMinutes <= maxMinutes;

export const slotKey = (date: IsoDate, mealType: MealType): string => `${date}|${mealType}`;

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Secondary-net term match: case-insensitive substring of the term or its naive singular
 * ('mushrooms' -> 'mushroom', 'berries' -> 'berry'). Deliberately over-inclusive ('nut' also hits
 * 'nutmeg'/'coconut'): a false exclusion is safe, a missed allergen is not.
 */
export function termMatches(text: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  const hay = norm(text);
  const stems = [t];
  if (t.length > 3 && t.endsWith('ies')) stems.push(`${t.slice(0, -3)}y`);
  if (t.length > 3 && t.endsWith('s')) stems.push(t.slice(0, -1));
  return stems.some((s) => hay.includes(s));
}

/** Does a recipe of `cat` count towards a target for `target`? */
export function countsTowards(cat: DietCategory, target: DietCategory, vegIncludesVegan: boolean): boolean {
  return cat === target || (target === 'vegetarian' && vegIncludesVegan && cat === 'vegan');
}

export function hardCheck(c: RecipeCandidate, k: PlanConstraints, labels: Problem['labels'] = {}): HardReason[] {
  const reasons: HardReason[] = [];
  if (k.excludeDietCategories.includes(c.dietCategory)) {
    reasons.push({ code: 'excluded_diet', message: `diet category '${c.dietCategory}' is excluded` });
  }
  const ingName = (i: string): string => labels.ingredients?.[i] ?? i;
  const ingSet = new Set(c.ingredientIds);

  // (1) PRIMARY: canonical ingredient ids.
  const hitIng = [...new Set(k.excludeIngredientIds.filter((i) => ingSet.has(i)))].sort();
  if (hitIng.length) {
    reasons.push({ code: 'excluded_ingredient', message: `contains excluded ingredient: ${hitIng.map(ingName).join(', ')}` });
  }

  // (1b) PRIMARY: allergen groups -> canonical ingredient ids.
  const exAll = [...new Set(k.excludeAllergens.map(norm))].sort();
  const groups = new Map<string, string[]>();
  for (const [g, ids] of Object.entries(k.allergenGroups)) groups.set(norm(g), [...(groups.get(norm(g)) ?? []), ...ids]);
  for (const a of exAll) {
    const hits = [...new Set((groups.get(a) ?? []).filter((i) => ingSet.has(i)))].sort();
    if (hits.length) reasons.push({ code: 'allergen', message: `contains ${a} (${hits.map(ingName).join(', ')})` });
  }
  // (2) Declared allergens on the recipe summary.
  const declared = new Set(c.allergens.map(norm));
  const hitAll = exAll.filter((a) => declared.has(a));
  if (hitAll.length) reasons.push({ code: 'allergen', message: `contains allergen: ${hitAll.join(', ')}` });

  // (3) SECONDARY safety net: case-insensitive terms on ingredient names/aliases.
  const terms = [...new Set([...k.excludeTerms.map(norm), ...exAll])].filter((t) => t.length > 0).sort();
  const nameHits = new Set<string>();
  for (const name of c.ingredientNames) {
    for (const t of terms) if (termMatches(name, t)) nameHits.add(`'${name}' ~ '${t}'`);
  }
  if (nameHits.size) {
    reasons.push({ code: 'excluded_term', message: `ingredient name matches an excluded term: ${[...nameHits].sort().join(', ')}` });
  }
  // Fail safe: an unmatched line whose original text contains an excluded term is a violation,
  // regardless of allowUnverifiedIngredients.
  const lineHits = new Set<string>();
  for (const line of c.unmatchedLines) {
    for (const t of terms) if (termMatches(line, t)) lineHits.add(`"${line.trim()}" ~ '${t}'`);
  }
  if (lineHits.size) {
    reasons.push({ code: 'unmatched_line_term', message: `unmatched ingredient line mentions an excluded term: ${[...lineHits].sort().join(', ')}` });
  }

  const unmatched = Math.max(c.unmatchedIngredientCount, c.unmatchedLines.length);
  const hasIngredientExclusions =
    k.excludeIngredientIds.length > 0 || k.excludeAllergens.length > 0 || k.excludeTerms.length > 0;
  if (hasIngredientExclusions && unmatched > 0 && !k.allowUnverifiedIngredients && !lineHits.size) {
    reasons.push({
      code: 'unverified_ingredients',
      message: `${unmatched} unmatched ingredient line(s) cannot be checked against exclusions`,
    });
  }
  const exTags = new Set(k.excludeTags.map(norm));
  const hitTags = [...new Set(c.tags.map(norm).filter((t) => exTags.has(t)))].sort();
  if (hitTags.length) {
    reasons.push({ code: 'excluded_tag', message: `has excluded tag: ${hitTags.join(', ')}` });
  }
  return reasons;
}

export function resolveTarget(category: DietCategory, spec: DietTarget, n: number): ResolvedTarget {
  if ('fraction' in spec) {
    const raw = spec.fraction * n;
    // Documented rounding: a fractional expectation x is satisfied by any whole count in
    // [floor(x), ceil(x)]. 50% of 7 = 3.5 -> 3 or 4 meals both count as met. Integer x is exact.
    const lo = Math.floor(raw + 1e-9);
    const hi = Math.ceil(raw - 1e-9);
    return { category, spec, lo, hi: Math.max(lo, hi), raw };
  }
  if ('count' in spec) return { category, spec, lo: spec.count, hi: spec.count };
  return { category, spec, lo: spec.min ?? 0, hi: spec.max ?? Math.max(n, spec.min ?? 0) };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export function prepareProblem(
  constraintsInput: PlanConstraintsInput,
  libraryInput: RecipeCandidateInput[],
  options: PlannerOptions = {},
): Problem {
  const k = PlanConstraintsSchema.parse(constraintsInput);
  const parsed = libraryInput.map((r) => RecipeCandidateSchema.parse(r));
  // Sort by id so the input order of the library never affects the result.
  const candidates = [...parsed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idIndex = new Map<string, number>();
  candidates.forEach((c, i) => {
    if (idIndex.has(c.id)) throw new Error(`Duplicate recipe id in library: ${c.id}`);
    idIndex.set(c.id, i);
  });
  const labels = options.labels ?? {};
  const weights: PlannerWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const notes: string[] = [];
  const lockIssues: string[] = [];

  const hardReasons = candidates.map((c) => hardCheck(c, k, labels));
  const globallyEligible = candidates.map((_, i) => i).filter((i) => hardReasons[i]!.length === 0);

  // Dates
  let dates: IsoDate[];
  if (k.dates) {
    dates = [...new Set(k.dates)].sort();
  } else {
    const n = k.days ?? 7;
    dates = Array.from({ length: n }, (_, i) => addDays(k.startDate!, i));
  }
  const firstDate = dates[0]!;
  const dateSet = new Set(dates);
  const mealTypes = MEAL_TYPES.filter((m) => k.mealTypes.includes(m));

  const quickDates = new Set(k.quickMeals?.dates ?? []);
  const quickWeekdays = new Set(k.quickMeals?.weekdays ?? []);

  const slots: PreparedSlot[] = [];
  const slotIndex = new Map<string, number>();
  for (const date of dates) {
    for (const mealType of mealTypes) {
      const index = slots.length;
      const key = slotKey(date, mealType);
      const weekday = weekdayOf(date);
      const skip = k.skip.find((s) => s.date === date && (s.mealType === undefined || s.mealType === mealType));
      const eligible = globallyEligible.filter((i) => {
        const mt = candidates[i]!.mealTypes;
        return !mt || mt.includes(mealType);
      });
      const slot: PreparedSlot = { index, key, date, mealType, weekday, eligible, eligibleSet: new Set(eligible) };
      if (skip) {
        slot.skipReason = skip.reason;
        if (skip.note) slot.skipNote = skip.note;
      }
      if (k.quickMeals && (quickDates.has(date) || quickWeekdays.has(weekday))) {
        slot.quickMaxMinutes = k.quickMeals.maxTotalMinutes;
        if (k.quickMeals.strict) {
          slot.quickStrict = true;
          const max = k.quickMeals.maxTotalMinutes;
          slot.eligible = slot.eligible.filter((i) => isQuickEnough(candidates[i]!, max));
          slot.eligibleSet = new Set(slot.eligible);
        }
      }
      slots.push(slot);
      slotIndex.set(key, index);
    }
  }
  for (const s of k.skip) {
    if (!dateSet.has(s.date)) notes.push(`Skip entry for ${s.date} is outside the plan dates and was ignored.`);
  }
  for (const d of quickDates) {
    if (!dateSet.has(d)) notes.push(`Quick-meal date ${d} is outside the plan dates and was ignored.`);
  }

  // Locked slots: honoured only if the recipe passes every hard constraint.
  for (const l of k.locked) {
    const si = slotIndex.get(slotKey(l.date, l.mealType));
    if (si === undefined) {
      lockIssues.push(`Pinned recipe ${l.recipeId} on ${l.date} ${l.mealType} is outside the plan and was ignored.`);
      continue;
    }
    const slot = slots[si]!;
    if (slot.skipReason) {
      lockIssues.push(`Pinned recipe ${l.recipeId} on ${l.date} ${l.mealType} conflicts with a skipped slot and was ignored.`);
      continue;
    }
    const ci = idIndex.get(l.recipeId);
    if (ci === undefined) {
      lockIssues.push(`Pinned recipe ${l.recipeId} is not in the library and was ignored.`);
      continue;
    }
    const reasons = hardReasons[ci]!;
    if (reasons.length) {
      const title = candidates[ci]!.title ?? l.recipeId;
      lockIssues.push(
        `Pinned recipe "${title}" on ${l.date} was removed: ${reasons.map((r) => r.message).join('; ')}.`,
      );
      continue;
    }
    if (slot.quickStrict && !isQuickEnough(candidates[ci]!, slot.quickMaxMinutes!)) {
      lockIssues.push(`Pinned recipe "${candidates[ci]!.title ?? l.recipeId}" on ${l.date} was removed: only quick meals (${slot.quickMaxMinutes} min or less) are allowed that day.`);
      continue;
    }
    if (!slot.eligibleSet.has(ci)) {
      // Meal-type suitability is advisory; a user pin overrides it.
      slot.eligible = [...slot.eligible, ci].sort((a, b) => a - b);
      slot.eligibleSet.add(ci);
    }
    slot.lockedCandidate = ci;
  }

  const plannable = slots.filter((s) => !s.skipReason).map((s) => s.index);
  const n = plannable.length;
  const targets: ResolvedTarget[] = [];
  for (const cat of DIET_CATEGORIES) {
    const spec = k.dietProportions?.[cat];
    if (spec) targets.push(resolveTarget(cat, spec, n));
  }

  const imputedCostPerServing = median(
    globallyEligible
      .map((i) => candidates[i]!.estCostPerServingPence)
      .filter((v): v is number => v !== null),
  );

  const favSet = new Set(k.favouritesOf);
  const includeTags = new Set(k.includeTags.map(norm));
  const isFavourite = candidates.map((c) => c.favouritedBy.some((m) => favSet.has(m)));
  const dislikeCount = candidates.map((c) => new Set(c.dislikedBy).size);
  const tagHits = candidates.map((c) => new Set(c.tags.map(norm).filter((t) => includeTags.has(t))).size);
  const isRecent = candidates.map((c) => {
    if (!c.lastCookedOn || k.avoidRecentDays === 0) return false;
    const gap = daysBetween(c.lastCookedOn, firstDate);
    return gap < k.avoidRecentDays;
  });

  return {
    constraints: k,
    candidates,
    idIndex,
    hardReasons,
    globallyEligible,
    slots,
    slotIndex,
    plannable,
    targets,
    weights,
    firstDate,
    imputedCostPerServing,
    notes,
    lockIssues,
    labels,
    isFavourite,
    dislikeCount,
    tagHits,
    isRecent,
  };
}
