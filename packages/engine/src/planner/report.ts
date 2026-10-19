import type { DietCategory, IsoDate, MealType, Pence } from '../contract';
import { shortDateLabel } from './dates';
import { countsTowards, type HardReasonCode, type Problem, type ResolvedTarget } from './problem';
import type { SkipReason } from './schemas';
import { computeStats, type Assignment, type PlanStats } from './score';

export type ConstraintStatus = 'met' | 'partially_met' | 'unmet' | 'uncertain' | 'not_applicable';

export type ConstraintKind =
  | 'hard_exclusions'
  | 'coverage'
  | 'diet_proportion'
  | 'budget'
  | 'favourites'
  | 'quick_meals'
  | 'include_tags'
  | 'variety'
  | 'pinned';

export interface ConstraintReportItem {
  id: string;
  kind: ConstraintKind;
  hard: boolean;
  status: ConstraintStatus;
  target?: string;
  actual?: string;
  explanation: string;
}

export interface ProposedSlot {
  key: string;
  date: IsoDate;
  mealType: MealType;
  servings: number;
  status: 'filled' | 'empty' | 'skipped';
  recipeId: string | null;
  title?: string;
  dietCategory?: DietCategory;
  skipReason?: SkipReason;
  pinned: boolean;
  costPence: Pence | null;
  totalMinutes: number | null;
  /** Why this recipe fits (favourite, quick, tags...). */
  reasons: string[];
}

export interface GapSuggestion {
  /** The planner never invents recipes; it flags where a new one is needed. */
  kind: 'new_recipe_suggestion_needed';
  reason: string;
  count: number;
  slotKeys: string[];
  criteria: {
    dietCategory?: DietCategory;
    mealType?: MealType;
    maxTotalMinutes?: number;
    maxCostPerServingPence?: number;
    excludeIngredientIds: string[];
    excludeAllergens: string[];
    excludeTerms: string[];
    excludeDietCategories: DietCategory[];
  };
}

export interface PlanCost {
  totalPence: Pence;
  costedMeals: number;
  uncostedMeals: number;
  budgetPence: Pence | null;
  withinBudget: boolean | null;
  /** True when some meals have no estimate, so totalPence understates the real cost. */
  isLowerBound: boolean;
}

export interface HardExclusionSummary {
  eligibleRecipes: number;
  excludedRecipes: { recipeId: string; title?: string; reasons: { code: HardReasonCode; message: string }[] }[];
}

export interface PlanEvaluation {
  slots: ProposedSlot[];
  report: ConstraintReportItem[];
  /** Human-readable explanations for every constraint not fully met. */
  explanations: string[];
  /** Informational notes (rounding, ignored inputs). */
  notes: string[];
  cost: PlanCost;
  suggestions: GapSuggestion[];
  hardExclusions: HardExclusionSummary;
  stats: PlanStats;
}

export const formatPence = (p: number): string => `£${(p / 100).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function dietLabel(cat: DietCategory, vegIncludesVegan: boolean): string {
  return cat === 'vegetarian' && vegIncludesVegan ? 'vegetarian (incl. vegan)' : cat;
}

function rangeText(t: ResolvedTarget): string {
  return t.lo === t.hi ? `${t.lo}` : `${t.lo}–${t.hi}`;
}

function memberNames(p: Problem): string {
  const names = p.constraints.favouritesOf.map((m) => p.labels.members?.[m] ?? m);
  if (names.length <= 1) return `${names[0] ?? ''}'s`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}'s`;
}

export function buildEvaluation(
  p: Problem,
  a: Assignment,
  opts: { hardViolationCount?: number } = {},
): PlanEvaluation {
  const k = p.constraints;
  const st = computeStats(p, a);
  const report: ConstraintReportItem[] = [];
  const suggestions: GapSuggestion[] = [];
  const notes = [...p.notes];
  const n = p.plannable.length;
  const baseCriteria = {
    excludeIngredientIds: [...k.excludeIngredientIds],
    excludeAllergens: [...k.excludeAllergens],
    excludeTerms: [...k.excludeTerms],
    excludeDietCategories: [...k.excludeDietCategories],
  };
  const mainMealType = p.slots.find((s) => !s.skipReason)?.mealType;

  // ---------- slots ----------
  const lockedSet = new Set(p.slots.filter((s) => s.lockedCandidate !== undefined).map((s) => s.index));
  const slots: ProposedSlot[] = p.slots.map((s) => {
    const ci = a[s.index];
    const base = { key: s.key, date: s.date, mealType: s.mealType, servings: k.servings };
    if (s.skipReason) {
      return { ...base, status: 'skipped', recipeId: null, skipReason: s.skipReason, pinned: false, costPence: null, totalMinutes: null, reasons: [] };
    }
    if (ci === null || ci === undefined) {
      return { ...base, status: 'empty', recipeId: null, pinned: false, costPence: null, totalMinutes: null, reasons: [] };
    }
    const c = p.candidates[ci]!;
    const reasons: string[] = [];
    if (lockedSet.has(s.index)) reasons.push('Pinned by you');
    if (p.isFavourite[ci]) {
      const who = c.favouritedBy.filter((m) => k.favouritesOf.includes(m)).map((m) => p.labels.members?.[m] ?? m);
      reasons.push(`Favourite of ${who.join(', ')}`);
    }
    if (s.quickMaxMinutes !== undefined) {
      if (c.totalMinutes !== null && c.totalMinutes <= s.quickMaxMinutes) {
        reasons.push(`Quick: ${c.totalMinutes} min (≤ ${s.quickMaxMinutes})`);
      }
    }
    const tags = c.tags.filter((t) => k.includeTags.some((it) => it.toLowerCase() === t.toLowerCase()));
    if (tags.length) reasons.push(`Tagged ${tags.map((t) => `'${t}'`).join(', ')}`);
    const slot: ProposedSlot = {
      ...base,
      status: 'filled',
      recipeId: c.id,
      dietCategory: c.dietCategory,
      pinned: lockedSet.has(s.index),
      costPence: c.estCostPerServingPence === null ? null : c.estCostPerServingPence * k.servings,
      totalMinutes: c.totalMinutes,
      reasons,
    };
    if (c.title !== undefined) slot.title = c.title;
    return slot;
  });

  // ---------- hard exclusions ----------
  const excludedRecipes = p.candidates
    .map((c, i) => ({ c, reasons: p.hardReasons[i]! }))
    .filter((x) => x.reasons.length > 0)
    .map(({ c, reasons }) => {
      const e: HardExclusionSummary['excludedRecipes'][number] = { recipeId: c.id, reasons };
      if (c.title !== undefined) e.title = c.title;
      return e;
    });
  const reasonCounts = new Map<string, number>();
  for (const e of excludedRecipes) for (const r of e.reasons) reasonCounts.set(r.code, (reasonCounts.get(r.code) ?? 0) + 1);
  const violations = opts.hardViolationCount ?? 0;
  report.push({
    id: 'hard_exclusions',
    kind: 'hard_exclusions',
    hard: true,
    status: violations > 0 ? 'unmet' : 'met',
    actual: `${p.globallyEligible.length} of ${p.candidates.length} recipes eligible`,
    explanation:
      violations > 0
        ? `${plural(violations, 'meal')} break a hard constraint (allergen/exclusion) and must be changed before saving.`
        : excludedRecipes.length
          ? `${plural(excludedRecipes.length, 'recipe')} excluded by allergies/exclusions (${[...reasonCounts.entries()].map(([c, v]) => `${c.replace(/_/g, ' ')}: ${v}`).join(', ')}); none are used.`
          : 'No recipes needed excluding.',
  });

  // ---------- coverage ----------
  const emptySlots = p.plannable.filter((s) => a[s] === null || a[s] === undefined);
  const skipped = p.slots.filter((s) => s.skipReason);
  {
    let explanation = `${st.filled} of ${plural(n, 'meal')} planned`;
    if (skipped.length) explanation += `; ${skipped.length} skipped (eating out / leftovers)`;
    explanation += '.';
    if (emptySlots.length) {
      const noneEligible = emptySlots.filter((s) => p.slots[s]!.eligible.length === 0);
      const exhausted = emptySlots.filter((s) => p.slots[s]!.eligible.length > 0);
      if (noneEligible.length) {
        explanation += ` ${plural(noneEligible.length, 'slot')} left empty: no recipe in your library meets the hard constraints` +
          (p.candidates.length ? ` (${excludedRecipes.length} of ${p.candidates.length} excluded).` : ' (library is empty).');
      }
      if (exhausted.length) {
        explanation += ` ${plural(exhausted.length, 'slot')} left empty: not enough different eligible recipes and repeats are set to 'never'.`;
      }
      // Group gap suggestions by meal type.
      const byMeal = new Map<MealType, string[]>();
      for (const s of emptySlots) {
        const sl = p.slots[s]!;
        byMeal.set(sl.mealType, [...(byMeal.get(sl.mealType) ?? []), sl.key]);
      }
      for (const [mealType, keys] of byMeal) {
        suggestions.push({
          kind: 'new_recipe_suggestion_needed',
          reason: `${plural(keys.length, `${mealType} slot`)} could not be filled from your library.`,
          count: keys.length,
          slotKeys: keys,
          criteria: { ...baseCriteria, mealType },
        });
      }
    }
    report.push({
      id: 'coverage',
      kind: 'coverage',
      hard: false,
      status: n === 0 ? 'not_applicable' : emptySlots.length === 0 ? 'met' : st.filled === 0 ? 'unmet' : 'partially_met',
      target: `${n}`,
      actual: `${st.filled}`,
      explanation,
    });
  }

  // ---------- pinned ----------
  if (k.locked.length) {
    report.push({
      id: 'pinned',
      kind: 'pinned',
      hard: false,
      status: p.lockIssues.length ? (p.lockIssues.length === k.locked.length ? 'unmet' : 'partially_met') : 'met',
      target: `${k.locked.length}`,
      actual: `${k.locked.length - p.lockIssues.length}`,
      explanation: p.lockIssues.length ? p.lockIssues.join(' ') : 'All pinned meals kept.',
    });
  }

  // ---------- diet proportions ----------
  // Distinct eligible recipes per category (for "library too small" explanations).
  const usableIdx = new Set<number>();
  for (const s of p.plannable) for (const ci of p.slots[s]!.eligible) usableIdx.add(ci);
  const minSum = (() => {
    // Lower bounds on disjoint groups: meat, fish, vegetarian-family (max of veg/vegan los if nested).
    const lo = (c: DietCategory): number => p.targets.find((t) => t.category === c)?.lo ?? 0;
    const vegFamily = k.vegetarianIncludesVegan ? Math.max(lo('vegetarian'), lo('vegan')) : lo('vegetarian') + lo('vegan');
    return lo('meat') + lo('fish') + vegFamily;
  })();
  if (p.targets.length && minSum > n) {
    notes.push(`Diet targets need at least ${minSum} meals but the plan has ${n}; they cannot all be met.`);
  }
  p.targets.forEach((t, i) => {
    const actual = st.dietActual[i]!;
    const dist = st.dietDistance[i]!;
    const label = dietLabel(t.category, k.vegetarianIncludesVegan);
    let rounding = '';
    if (t.raw !== undefined && 'fraction' in t.spec) {
      const pct = Math.round(t.spec.fraction * 100);
      const isInt = Math.abs(t.raw - Math.round(t.raw)) < 1e-9;
      rounding = isInt
        ? `${pct}% of ${n} meals = ${Math.round(t.raw)}.`
        : `${pct}% of ${n} meals = ${+t.raw.toFixed(2)}, so ${rangeText(t)} ${label} meals counts as on target (proportions are rounded to whole meals).`;
      if (!isInt) notes.push(`${label[0]!.toUpperCase()}${label.slice(1)}: ${rounding}`);
    }
    let explanation: string;
    let status: ConstraintStatus;
    if (dist === 0) {
      status = 'met';
      explanation = `${actual} ${label} meals (target ${rangeText(t)}).${rounding ? ` ${rounding}` : ''}`;
    } else {
      status = actual === 0 && t.lo > 0 ? 'unmet' : 'partially_met';
      const inCat = (ci: number): boolean => countsTowards(p.candidates[ci]!.dietCategory, t.category, k.vegetarianIncludesVegan);
      const distinct = [...usableIdx].filter(inCat).length;
      const excludedInCat = p.candidates.filter((c, ci) => p.hardReasons[ci]!.length > 0 && countsTowards(c.dietCategory, t.category, k.vegetarianIncludesVegan)).length;
      if (actual < t.lo) {
        const libraryLimit = k.repeats === 'allow' ? (distinct === 0 ? 0 : Infinity) : distinct;
        if (libraryLimit < t.lo) {
          explanation = `Only ${distinct} ${label} ${distinct === 1 ? 'recipe' : 'recipes'} in your library ${distinct === 1 ? 'meets' : 'meet'} the plan's hard constraints; ${t.lo} requested` +
            (excludedInCat ? ` (${excludedInCat} more excluded by allergies/exclusions).` : '.');
          const short = t.lo - (k.repeats === 'allow' ? 0 : distinct);
          if (short > 0) {
            suggestions.push({
              kind: 'new_recipe_suggestion_needed',
              reason: `Need ${plural(short, `more ${label} recipe`)} to meet the ${label} target.`,
              count: short,
              slotKeys: [],
              criteria: { ...baseCriteria, dietCategory: t.category, ...(mainMealType ? { mealType: mainMealType } : {}) },
            });
          }
        } else if (minSum > n) {
          explanation = `Got ${actual} ${label} meals vs target ${rangeText(t)}: the diet targets together need at least ${minSum} meals but the plan has ${n}.`;
        } else {
          explanation = `Got ${actual} ${label} meals vs target ${rangeText(t)}: traded off against other constraints (budget, other diet targets, quick meals or variety).`;
        }
      } else {
        explanation = `Got ${actual} ${label} meals, more than the target ${rangeText(t)}: not enough suitable recipes in other categories to fill the remaining slots.`;
      }
      if (rounding) explanation += ` ${rounding}`;
    }
    report.push({
      id: `diet:${t.category}`,
      kind: 'diet_proportion',
      hard: false,
      status,
      target: rangeText(t),
      actual: `${actual}`,
      explanation,
    });
  });

  // ---------- budget / cost ----------
  const budget = k.budgetPence ?? null;
  const cost: PlanCost = {
    totalPence: st.totalCostPence,
    costedMeals: st.costedMeals,
    uncostedMeals: st.uncostedMeals,
    budgetPence: budget,
    withinBudget: budget === null ? null : st.totalCostPence <= budget,
    isLowerBound: st.uncostedMeals > 0,
  };
  if (budget !== null) {
    const uncostedNote = st.uncostedMeals
      ? ` ${plural(st.uncostedMeals, 'meal')} ${st.uncostedMeals === 1 ? 'has' : 'have'} no cost estimate, so the real total may be higher.`
      : '';
    let status: ConstraintStatus;
    let explanation: string;
    if (st.totalCostPence > budget) {
      status = 'unmet';
      // Lower bound: cheapest costed eligible recipes for each planned slot.
      const costs = [...usableIdx]
        .map((ci) => p.candidates[ci]!.estCostPerServingPence)
        .filter((v): v is number => v !== null)
        .sort((x, y) => x - y);
      const need = st.filled;
      const cheapest = k.repeats !== 'never'
        ? (costs[0] ?? 0) * need * k.servings
        : costs.slice(0, need).reduce((s, v) => s + v * k.servings, 0);
      explanation = `Estimated ${formatPence(st.totalCostPence)} is ${formatPence(st.totalCostPence - budget)} over the ${formatPence(budget)} budget.`;
      if (cheapest > budget) {
        explanation += ` Even the cheapest eligible recipes would cost about ${formatPence(cheapest)}.`;
        suggestions.push({
          kind: 'new_recipe_suggestion_needed',
          reason: `Cheaper recipes are needed to fit ${formatPence(budget)} for ${plural(need, 'meal')}.`,
          count: need,
          slotKeys: [],
          criteria: { ...baseCriteria, maxCostPerServingPence: Math.floor(budget / Math.max(1, need * k.servings)) },
        });
      } else {
        explanation += ` A cheaper plan (about ${formatPence(cheapest)}) exists but would miss other constraints.`;
      }
      explanation += uncostedNote;
    } else if (st.uncostedMeals > 0) {
      status = 'uncertain';
      explanation = `Estimated ${formatPence(st.totalCostPence)} of ${formatPence(budget)} for costed meals.${uncostedNote}`;
    } else {
      status = 'met';
      explanation = `Estimated ${formatPence(st.totalCostPence)}, within the ${formatPence(budget)} budget (estimate from recipe costs; pack sizes may change the actual spend).`;
    }
    report.push({ id: 'budget', kind: 'budget', hard: false, status, target: formatPence(budget), actual: formatPence(st.totalCostPence), explanation });
  }

  // ---------- favourites ----------
  if (k.favouritesOf.length) {
    const eligibleFavs = [...usableIdx].filter((ci) => p.isFavourite[ci]).length;
    const possible = k.repeats === 'allow' ? (eligibleFavs > 0 ? st.filled : 0) : Math.min(st.filled, eligibleFavs);
    const who = memberNames(p);
    const excludedFavs = p.candidates.filter((_, ci) => p.isFavourite[ci] && p.hardReasons[ci]!.length > 0).length;
    let status: ConstraintStatus;
    let explanation: string;
    if (eligibleFavs === 0) {
      status = 'unmet';
      explanation = `None of ${who} favourites are eligible` + (excludedFavs ? ` (${excludedFavs} excluded by allergies/exclusions).` : '.');
    } else if (st.favourites >= possible) {
      status = 'met';
      explanation = `${st.favourites} of ${plural(st.filled, 'meal')} are ${who} favourites` +
        (possible < st.filled ? ` (all ${eligibleFavs} eligible favourites used).` : '.');
    } else {
      status = st.favourites > 0 ? 'partially_met' : 'unmet';
      explanation = `${st.favourites} of ${possible} possible ${who} favourites used; the rest were traded off against other constraints.`;
    }
    report.push({ id: 'favourites', kind: 'favourites', hard: false, status, target: `${possible}`, actual: `${st.favourites}`, explanation });
  }

  // ---------- quick meals ----------
  const quickSlots = p.plannable.filter((s) => p.slots[s]!.quickMaxMinutes !== undefined);
  if (k.quickMeals) {
    const max = k.quickMeals.maxTotalMinutes;
    const missed = quickSlots.filter((s) => {
      const ci = a[s];
      if (ci === null || ci === undefined) return false; // empty slots are reported under coverage
      const m = p.candidates[ci]!.totalMinutes;
      return m === null || m > max;
    });
    const quickEligible = [...usableIdx].filter((ci) => {
      const m = p.candidates[ci]!.totalMinutes;
      return m !== null && m <= max;
    });
    let status: ConstraintStatus;
    let explanation: string;
    if (quickSlots.length === 0) {
      status = 'not_applicable';
      explanation = 'No quick-meal days fall on planned slots.';
    } else if (missed.length === 0) {
      status = 'met';
      explanation = `All ${plural(quickSlots.length, 'quick-meal slot')} use recipes of ${max} min or less.`;
    } else {
      status = missed.length === quickSlots.length ? 'unmet' : 'partially_met';
      const details = missed.map((s) => {
        const c = p.candidates[a[s]!]!;
        return `${shortDateLabel(p.slots[s]!.date)} uses "${c.title ?? c.id}" (${c.totalMinutes === null ? 'time unknown' : `${c.totalMinutes} min`})`;
      });
      if (quickEligible.length === 0) {
        explanation = `No eligible recipe takes ${max} min or less. ${details.join('; ')}.`;
      } else if (k.repeats !== 'allow' && quickEligible.length < quickSlots.length) {
        explanation = `Only ${plural(quickEligible.length, 'eligible recipe')} ${quickEligible.length === 1 ? 'takes' : 'take'} ${max} min or less for ${plural(quickSlots.length, 'quick-meal slot')}. ${details.join('; ')}.`;
      } else {
        explanation = `${details.join('; ')}: quick recipes were traded off against other constraints.`;
      }
      const shortfall = k.repeats === 'allow' ? (quickEligible.length ? 0 : missed.length) : Math.max(0, quickSlots.length - quickEligible.length);
      if (shortfall > 0) {
        suggestions.push({
          kind: 'new_recipe_suggestion_needed',
          reason: `Need ${plural(shortfall, 'more quick recipe')} (≤ ${max} min) for busy days.`,
          count: shortfall,
          slotKeys: missed.map((s) => p.slots[s]!.key),
          criteria: { ...baseCriteria, maxTotalMinutes: max, ...(mainMealType ? { mealType: mainMealType } : {}) },
        });
      }
    }
    report.push({ id: 'quick_meals', kind: 'quick_meals', hard: false, status, target: `${quickSlots.length}`, actual: `${quickSlots.length - missed.length}`, explanation });
  }

  // ---------- include tags ----------
  if (k.includeTags.length) {
    const missingTags: string[] = [];
    const unavailable: string[] = [];
    for (const tag of k.includeTags) {
      const t = tag.toLowerCase();
      const has = (ci: number): boolean => p.candidates[ci]!.tags.some((x) => x.toLowerCase() === t);
      const used = p.plannable.some((s) => a[s] !== null && a[s] !== undefined && has(a[s]!));
      if (!used) {
        missingTags.push(tag);
        if (![...usableIdx].some(has)) unavailable.push(tag);
      }
    }
    const status: ConstraintStatus = missingTags.length === 0 ? 'met' : missingTags.length === k.includeTags.length ? 'unmet' : 'partially_met';
    let explanation = missingTags.length === 0
      ? `Every requested tag appears in the plan (${st.tagHits} tag matches).`
      : `Missing tags: ${missingTags.map((t) => `'${t}'`).join(', ')}.`;
    if (unavailable.length) explanation += ` No eligible recipe is tagged ${unavailable.map((t) => `'${t}'`).join(', ')}.`;
    else if (missingTags.length) explanation += ' Traded off against other constraints.';
    report.push({ id: 'include_tags', kind: 'include_tags', hard: false, status, target: k.includeTags.join(', '), actual: `${st.tagHits}`, explanation });
  }

  // ---------- variety ----------
  {
    const parts: string[] = [];
    let status: ConstraintStatus = 'met';
    if (k.repeats !== 'allow' && st.repeats > 0) {
      status = 'partially_met';
      parts.push(`${plural(st.repeats, 'repeated meal')}: only ${[...usableIdx].length} different eligible recipes for ${plural(st.filled, 'meal')}` +
        (usableIdx.size >= st.filled ? ' (repeats chosen to satisfy other constraints)' : '') + '.');
    }
    if (st.recent > 0) {
      if (status === 'met') status = 'partially_met';
      parts.push(`${plural(st.recent, 'meal')} cooked within the last ${k.avoidRecentDays} days.`);
    }
    report.push({
      id: 'variety',
      kind: 'variety',
      hard: k.repeats === 'never',
      status,
      actual: `${st.repeats} repeats, ${st.recent} recent`,
      explanation: parts.length ? parts.join(' ') : 'No repeated or recently cooked meals.',
    });
  }

  const explanations = report
    .filter((r) => r.status === 'unmet' || r.status === 'partially_met' || r.status === 'uncertain')
    .map((r) => r.explanation);

  return {
    slots,
    report,
    explanations,
    notes,
    cost,
    suggestions,
    hardExclusions: { eligibleRecipes: p.globallyEligible.length, excludedRecipes },
    stats: st,
  };
}
