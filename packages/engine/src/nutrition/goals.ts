// Per-person nutrition goals (P3-B, D430-D439). Pure and deterministic. DESCRIPTIVE ONLY, never advice: every figure is an
// ESTIMATE from planned (or cooked) recipes, scaled by the person's usual portion. Reference values are UK public guidance
// for ADULTS, each cited with its page and review date. There are no calorie, weight or body targets, and no goals for
// children (a person confirms they are an adult before any goal is stored). Unknown never becomes zero: when data is
// missing the amount is reported as "at least X" and the status is only ever as strong as what is known.
import type { IsoDate, MealType, NutrientKey } from '../contract';
import type { RecipeVarietyProfile, VarietyLine } from './variety';
import type { NutrientMap } from './types';

export type GoalId = 'more_fibre' | 'less_salt' | 'less_sugar' | 'more_fruit_veg' | 'more_oily_fish' | 'less_red_processed_meat';
export const GOAL_IDS: readonly GoalId[] = ['more_fibre', 'less_salt', 'less_sugar', 'more_fruit_veg', 'more_oily_fish', 'less_red_processed_meat'];
export const isGoalId = (v: unknown): v is GoalId => typeof v === 'string' && (GOAL_IDS as readonly string[]).includes(v);

export interface GoalSource {
  publisher: string;
  title: string;
  url: string;
  /** "Last reviewed" date shown on the page when we read it (2026-10-21). */
  reviewed: string;
}

export type GoalMetric = { kind: 'nutrient'; key: NutrientKey } | { kind: 'fruit_veg' } | { kind: 'oily_fish' } | { kind: 'red_meat' };

export interface GoalDef {
  id: GoalId;
  label: string;
  /** Short noun for sentences: "fibre". */
  noun: string;
  /** 'at_least' = more is better up to the guidance; 'at_most' = a limit. */
  direction: 'at_least' | 'at_most';
  metric: GoalMetric;
  /** 'day' goals are per day (scaled by how much of a day the planned meals cover); 'week' goals are per week. */
  basis: 'day' | 'week';
  /** Reference per `basis`, in `unit`. */
  reference: number;
  unit: string;
  /** The guidance in words, as shown in the app. */
  referenceText: string;
  /** Honest limits of the estimate. */
  caveat?: string;
  source: GoalSource;
}

const NHS = 'NHS';

/** Looked up from the official NHS pages on 2026-10-21 (see DECISIONS D431). Review dates are the pages' own. */
export const GOAL_DEFS: Record<GoalId, GoalDef> = {
  more_fibre: {
    id: 'more_fibre', label: 'More fibre', noun: 'fibre', direction: 'at_least', metric: { kind: 'nutrient', key: 'fibre' }, basis: 'day',
    reference: 30, unit: 'g', referenceText: 'Adults: aim for 30 g of fibre a day (NHS).',
    source: { publisher: NHS, title: 'How to get more fibre into your diet', url: 'https://www.nhs.uk/live-well/eat-well/digestive-health/how-to-get-more-fibre-into-your-diet/', reviewed: '2026-03-02' },
  },
  less_salt: {
    id: 'less_salt', label: 'Less salt', noun: 'salt', direction: 'at_most', metric: { kind: 'nutrient', key: 'salt' }, basis: 'day',
    reference: 6, unit: 'g', referenceText: 'Adults: no more than 6 g of salt a day (NHS).',
    caveat: 'Salt added at the table and in snacks is not in a recipe, so the real total is higher.',
    source: { publisher: NHS, title: 'Salt: nutrition and healthy eating', url: 'https://www.nhs.uk/live-well/eat-well/food-types/salt-in-your-diet/', reviewed: '2023-04-17' },
  },
  less_sugar: {
    id: 'less_sugar', label: 'Less sugar', noun: 'sugar', direction: 'at_most', metric: { kind: 'nutrient', key: 'sugars' }, basis: 'day',
    reference: 30, unit: 'g', referenceText: 'Adults: no more than 30 g of free sugars a day (NHS).',
    caveat: 'The data has total sugars, which also includes sugar naturally in fruit and milk, so this over-counts free sugars.',
    source: { publisher: NHS, title: 'How does sugar in our diet affect our health?', url: 'https://www.nhs.uk/live-well/eat-well/food-types/how-does-sugar-in-our-diet-affect-our-health/', reviewed: '2023-05-19' },
  },
  more_fruit_veg: {
    id: 'more_fruit_veg', label: 'More fruit and veg', noun: 'fruit and veg', direction: 'at_least', metric: { kind: 'fruit_veg' }, basis: 'day',
    reference: 5, unit: 'portions', referenceText: 'Aim for at least 5 portions of fruit and veg a day; a portion is 80 g (NHS).',
    caveat: 'Counted from recipe weights; potatoes, juice, garlic, ginger, chilli and herbs are not counted, pulses count once a day.',
    source: { publisher: NHS, title: 'Why 5 A Day?', url: 'https://www.nhs.uk/live-well/eat-well/5-a-day/why-5-a-day/', reviewed: '2026-09-30' },
  },
  more_oily_fish: {
    id: 'more_oily_fish', label: 'More oily fish', noun: 'oily fish', direction: 'at_least', metric: { kind: 'oily_fish' }, basis: 'week',
    reference: 1, unit: 'portions', referenceText: 'At least 2 portions of fish a week, one of them oily; a portion is about 140 g (NHS).',
    caveat: 'Only fresh, frozen and tinned oily fish such as salmon, mackerel, sardines and trout are counted; tinned tuna is not oily fish.',
    source: { publisher: NHS, title: 'Fish and shellfish: nutrition and healthy eating', url: 'https://www.nhs.uk/live-well/eat-well/food-types/fish-and-shellfish-nutrition/', reviewed: '2026-06-26' },
  },
  less_red_processed_meat: {
    id: 'less_red_processed_meat', label: 'Less red and processed meat', noun: 'red and processed meat', direction: 'at_most', metric: { kind: 'red_meat' }, basis: 'day',
    reference: 70, unit: 'g', referenceText: 'If you eat more than 90 g a day (cooked weight), cut down to 70 g a day or less (NHS).',
    caveat: 'The NHS figure is cooked weight; recipe weights are raw, so this reads higher than the cooked amount.',
    source: { publisher: NHS, title: 'Meat in your diet', url: 'https://www.nhs.uk/live-well/eat-well/food-types/meat-nutrition/', reviewed: '2024-05-01' },
  },
};

export const GOALS_DISCLAIMER =
  'Goals and progress are rough estimates from your planned or cooked recipes and the portion you choose. They leave out snacks, drinks, seasoning and anything not in a recipe. ' +
  'They are not medical or dietary advice and do not say whether your own needs are being met. If you have a health condition or concern, ask a GP, pharmacist or registered dietitian.';

/** Separate, specific consent for health-related data (UK GDPR special category). Wording is versioned; bump the version if it changes. */
export const GOALS_CONSENT_VERSION = 'g1';
export const GOALS_CONSENT = {
  version: GOALS_CONSENT_VERSION,
  title: 'Nutrition goals (optional)',
  paragraphs: [
    'You can choose simple weekly nutrition goals, such as more fibre or less salt, and see how your planned meals compare with UK guidance. This is health-related information, which the law treats as especially sensitive.',
    'We store only the goals you tick, your usual portion size and whether you want the planner to favour them. We do not ask for or store your weight, age, health conditions or calorie targets.',
    'Only you can see your goals. Other household members and the household owner cannot. They are never sent to our AI provider. If you turn on "favour my goals" the planner receives an anonymous list of goals, never your name.',
    'You can change your goals or withdraw consent at any time in Settings. Withdrawing deletes your goals. They are included in your data export and are deleted if you leave the household or delete your account.',
  ],
  checkbox: 'I agree to my nutrition goals being stored and used as described.',
  adultCheckbox: 'I am 18 or over. (These goals use adult guidance and are not available for children.)',
} as const;

/** Rough convention for how much of a day's food a planned meal represents (sums to 1). Shown to the user. */
export const MEAL_DAY_SHARE: Record<MealType, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };
export const MEAL_SHARE_NOTE = 'A planned dinner is treated as about a third of a day’s food, lunch as 30%, breakfast as 25% and a snack as 10%, so guidance for a whole day is scaled to the meals you planned.';

export const PORTION_SHARES: readonly { value: number; label: string }[] = [
  { value: 0.5, label: 'Small (half a serving)' },
  { value: 1, label: 'Usual (one serving)' },
  { value: 1.5, label: 'Large (one and a half servings)' },
];
export const isPortionShare = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0.25 && v <= 2;

// ---------------------------------------------------------------------------------------------------------------
// Per-recipe data for the two goals that need ingredient classification.
// ---------------------------------------------------------------------------------------------------------------

/** Small and serialisable: ships with each recipe to web and Android (not personal data). */
export interface RecipeGoalProfile {
  /** Oily fish portions (140 g) per serving. */
  oilyFishPortions: number;
  /** Oily fish lines whose weight is unknown (portions are then a lower bound). */
  oilyUnweighed: number;
  /** Raw grams of red and processed meat per serving. */
  redProcessedMeatG: number;
  redUnweighed: number;
}

export const OILY_FISH_PORTION_G = 140;

const NOT_THE_FOOD = /\b(?:sauce|paste|stock|cubes?|bouillon|gravy|flavou?r\w*|seasoning|spread|oil|p[aâ]t[eé]|vegetarian|vegan|meat-?free|plant-?based|quorn|substitute)\b/i;
const OILY = /\b(?:salmon|mackerel|sardines?|pilchards?|herrings?|kippers?|trout|whitebait|anchov\w+|eel|swordfish|fresh tuna|tuna steaks?)\b/i;
const POULTRY = /\b(?:chicken|turkey|duck|goose)\b/i;
const PROCESSED = /\b(?:bacon|ham|gammon|sausages?|chorizo|salami|pepperoni|pancetta|prosciutto|black pudding|hot ?dogs?|frankfurters?|corned beef|lardons|mortadella|spam)\b/i;
const RED = /\b(?:beef|steak|mince|minced|lamb|pork|veal|venison|mutton|goat|brisket|ribs?|ox|oxtail|hamburgers?|burgers?|meatballs?)\b/i;

export interface GoalLineClass { oilyFish: boolean; redMeat: boolean }
export function classifyForGoals(name: string, category: string | undefined): GoalLineClass {
  const text = name.toLowerCase();
  const cat = category ?? '';
  if (NOT_THE_FOOD.test(text)) return { oilyFish: false, redMeat: false };
  const fishCat = cat === 'fish_seafood' || cat === 'tinned_jarred' || cat === 'frozen' || cat === 'chilled' || cat === '';
  const oilyFish = fishCat && OILY.test(text) && !(/\btuna\b/i.test(text) && !/\b(?:fresh tuna|tuna steaks?)\b/i.test(text));
  // Processed meats are meat or tinned (corned beef); a plain "chicken sausage" is poultry so it is not counted here.
  const meatCat = cat === 'meat_poultry' || cat === 'tinned_jarred' || cat === 'frozen' || cat === 'chilled' || cat === '';
  const redMeat = meatCat && !POULTRY.test(text) && (PROCESSED.test(text) || RED.test(text));
  return { oilyFish, redMeat };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function recipeGoalProfile(lines: readonly VarietyLine[], servings: number): RecipeGoalProfile {
  const per = servings > 0 && Number.isFinite(servings) ? servings : 1;
  let oily = 0;
  let oilyUnweighed = 0;
  let red = 0;
  let redUnweighed = 0;
  for (const l of lines) {
    if (l.optional || !l.ingredientId) continue;
    const c = classifyForGoals(l.name, l.category);
    const weighed = l.grams != null && l.grams > 0;
    if (c.oilyFish) {
      if (weighed) oily += l.grams! / per / OILY_FISH_PORTION_G;
      else oilyUnweighed++;
    }
    if (c.redMeat) {
      if (weighed) red += l.grams! / per;
      else redUnweighed++;
    }
  }
  return { oilyFishPortions: r2(oily), oilyUnweighed, redProcessedMeatG: Math.round(red), redUnweighed };
}

// ---------------------------------------------------------------------------------------------------------------
// Weekly progress
// ---------------------------------------------------------------------------------------------------------------

export interface GoalMeal {
  /** Any stable id (planned slot key). */
  id: string;
  recipeId?: string | undefined;
  date: IsoDate;
  mealType?: MealType | undefined;
  title?: string | undefined;
  perServing?: NutrientMap | null | undefined;
  variety?: RecipeVarietyProfile | null | undefined;
  goals?: RecipeGoalProfile | null | undefined;
}

export type GoalStatus = 'met' | 'close' | 'off' | 'unclear' | 'none';

export interface GoalProgress {
  goal: GoalId;
  label: string;
  direction: GoalDef['direction'];
  status: GoalStatus;
  /** Amount from the meals, in the goal's unit: per planned day for 'day' goals, per week for 'week' goals. */
  amount: number;
  /** The amount is a lower bound because some meals or ingredients had no data ("at least X"). */
  atLeast: boolean;
  /** The reference for the days / meals covered (same unit and basis as `amount`). */
  reference: number;
  /** The reference for a whole day (or week) as published. */
  fullReference: number;
  unit: string;
  basis: GoalDef['basis'];
  /** amount / reference, 0 when nothing is known. */
  ratio: number;
  mealsCounted: number;
  mealsMissingData: number;
  /** One plain sentence, with the "at least" wording when partial. */
  headline: string;
  /** Why the status is what it is (or why it cannot be said). */
  detail: string;
  caveat?: string;
}

export interface GoalsSummary {
  disclaimer: string;
  shareNote: string;
  portionShare: number;
  mealCount: number;
  dayCount: number;
  /** Average share of a day's food the planned meals represent (0..1). */
  dayCoverage: number;
  progress: GoalProgress[];
}

interface Sum { total: number; partial: boolean; missing: number }

function nutrientSum(key: NutrientKey, meals: readonly GoalMeal[], share: number): Sum {
  const out: Sum = { total: 0, partial: false, missing: 0 };
  for (const m of meals) {
    const n = m.perServing?.[key];
    if (!n) { out.partial = true; out.missing++; continue; }
    if (n.status === 'known' || n.status === 'zero') out.total += (n.value ?? 0) * share;
    else {
      out.partial = true;
      out.missing++;
      if (n.lowerBound !== undefined) out.total += n.lowerBound * share;
    }
  }
  return out;
}

function fruitVegSum(meals: readonly GoalMeal[], share: number): Sum {
  const out: Sum = { total: 0, partial: false, missing: 0 };
  const byDay = new Map<string, { fv: number; pulses: number }>();
  for (const m of meals) {
    const d = byDay.get(m.date) ?? { fv: 0, pulses: 0 };
    byDay.set(m.date, d);
    if (!m.variety) { out.partial = true; out.missing++; continue; }
    if (m.variety.unweighed > 0) out.partial = true;
    d.fv += m.variety.fv * share;
    d.pulses += m.variety.pulses * share;
  }
  for (const d of byDay.values()) out.total += d.fv + Math.min(1, d.pulses);
  return out;
}

function profileSum(meals: readonly GoalMeal[], share: number, field: 'oilyFishPortions' | 'redProcessedMeatG'): Sum {
  const out: Sum = { total: 0, partial: false, missing: 0 };
  const unweighedField = field === 'oilyFishPortions' ? 'oilyUnweighed' : 'redUnweighed';
  for (const m of meals) {
    if (!m.goals) { out.partial = true; out.missing++; continue; }
    if (m.goals[unweighedField] > 0) out.partial = true;
    out.total += m.goals[field] * share;
  }
  return out;
}

const fmt = (n: number, unit: string): string => {
  const v = unit === 'g' ? (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) : Math.round(n * 10) / 10;
  return `${v}${unit === 'g' ? ' g' : ` ${unit}`}`;
};

function classify(def: GoalDef, ratio: number): Exclude<GoalStatus, 'unclear' | 'none'> {
  if (def.direction === 'at_least') return ratio >= 1 ? 'met' : ratio >= 0.75 ? 'close' : 'off';
  return ratio <= 1 ? 'met' : ratio <= 1.25 ? 'close' : 'off';
}

const dayShare = (types: readonly (MealType | undefined)[]): number => {
  const seen = new Set(types.map((t) => t ?? 'dinner'));
  let s = 0;
  for (const t of seen) s += MEAL_DAY_SHARE[t];
  return Math.min(1, s);
};

/**
 * Progress for one person's goals over planned (or cooked) recipe meals. Each meal counts `portionShare` servings of the
 * recipe's per-serving figures. Missing data makes the amount a lower bound and weakens the status; it never counts as zero.
 */
export function summariseGoals(goals: readonly GoalId[], meals: readonly GoalMeal[], opts: { portionShare?: number } = {}): GoalsSummary {
  const share = opts.portionShare !== undefined && isPortionShare(opts.portionShare) ? opts.portionShare : 1;
  const dates = [...new Set(meals.map((m) => m.date))].sort();
  const dayCount = dates.length;
  const perDayShare = dates.map((d) => dayShare(meals.filter((m) => m.date === d).map((m) => m.mealType)));
  const sumShare = perDayShare.reduce((a, b) => a + b, 0);
  const dayCoverage = dayCount > 0 ? sumShare / dayCount : 0;

  const progress: GoalProgress[] = [];
  for (const id of GOAL_IDS) {
    if (!goals.includes(id)) continue;
    const def = GOAL_DEFS[id];
    const base = { goal: id, label: def.label, direction: def.direction, unit: def.unit, basis: def.basis, fullReference: def.reference, ...(def.caveat ? { caveat: def.caveat } : {}) };
    if (meals.length === 0) {
      progress.push({ ...base, status: 'none', amount: 0, atLeast: false, reference: 0, ratio: 0, mealsCounted: 0, mealsMissingData: 0,
        headline: `${def.label}: no recipe meals planned yet.`, detail: 'Plan some recipe meals to see this.' });
      continue;
    }
    const sum = def.metric.kind === 'nutrient' ? nutrientSum(def.metric.key, meals, share)
      : def.metric.kind === 'fruit_veg' ? fruitVegSum(meals, share)
      : def.metric.kind === 'oily_fish' ? profileSum(meals, share, 'oilyFishPortions')
      : profileSum(meals, share, 'redProcessedMeatG');
    const week = def.basis === 'week';
    const amount = week ? sum.total : sum.total / dayCount;
    const reference = week ? def.reference : def.reference * dayCoverage;
    const ratio = reference > 0 ? amount / reference : 0;
    let status: GoalStatus;
    if (!sum.partial) {
      // A weekly goal cannot be judged "off" from a few planned days.
      status = week && dayCount < 5 && classify(def, ratio) !== 'met' ? 'unclear' : classify(def, ratio);
    } else if (def.direction === 'at_least') {
      status = ratio >= 1 ? 'met' : 'unclear';
    } else {
      // A lower bound can only show that a limit is already passed.
      status = ratio > 1 ? classify(def, ratio) : 'unclear';
    }
    const atLeast = sum.partial;
    const what = week ? 'this week' : `a day from planned meals`;
    const amountText = `${atLeast ? 'at least ' : 'about '}${fmt(amount, def.unit)}`;
    const headline = `${def.label}: ${amountText} ${what}${week ? '' : ` (the matching share of the ${fmt(def.reference, def.unit)} a day guidance is ${fmt(reference, def.unit)})`}.`;
    let detail: string;
    if (status === 'unclear') {
      detail = sum.missing > 0
        ? `${sum.missing} planned ${sum.missing === 1 ? 'meal has' : 'meals have'} no data for this, so we can only say "at least". We cannot tell how this week compares.`
        : 'Some ingredients could not be weighed, so we can only say "at least". We cannot tell how this week compares.';
      if (week && dayCount < 5 && !sum.partial) detail = 'Only a few days are planned, so a weekly goal cannot be judged yet.';
    } else if (def.direction === 'at_least') {
      detail = status === 'met' ? `Your planned meals reach the matching share${atLeast ? ' even counting only what we know' : ''}.` : status === 'close' ? 'Close to the matching share.' : 'Below the matching share.';
    } else {
      detail = status === 'met' ? 'Within the matching share.' : status === 'close' ? 'A little over the matching share.' : `Over the matching share${atLeast ? ' even counting only what we know' : ''}.`;
    }
    progress.push({ ...base, status, amount: Math.round(amount * 100) / 100, atLeast, reference: Math.round(reference * 100) / 100, ratio: Math.round(ratio * 100) / 100,
      mealsCounted: meals.length - sum.missing, mealsMissingData: sum.missing, headline, detail });
  }
  return { disclaimer: GOALS_DISCLAIMER, shareNote: MEAL_SHARE_NOTE, portionShare: share, mealCount: meals.length, dayCount, dayCoverage: Math.round(dayCoverage * 100) / 100, progress };
}

// ---------------------------------------------------------------------------------------------------------------
// Gentle hints and cheap swaps
// ---------------------------------------------------------------------------------------------------------------

/** Per-serving amount of the goal's metric in one recipe, or null when it is not fully known. */
export function perServingValue(goal: GoalId, r: Pick<GoalMeal, 'perServing' | 'variety' | 'goals'>): number | null {
  const def = GOAL_DEFS[goal];
  switch (def.metric.kind) {
    case 'nutrient': {
      const n = r.perServing?.[def.metric.key];
      return n && (n.status === 'known' || n.status === 'zero') ? (n.value ?? 0) : null;
    }
    case 'fruit_veg':
      return r.variety && r.variety.unweighed === 0 ? r.variety.fv + r.variety.pulses : null;
    case 'oily_fish':
      return r.goals && r.goals.oilyUnweighed === 0 ? r.goals.oilyFishPortions : null;
    case 'red_meat':
      return r.goals && r.goals.redUnweighed === 0 ? r.goals.redProcessedMeatG : null;
  }
}

export interface GoalCandidate extends Pick<GoalMeal, 'recipeId' | 'title' | 'perServing' | 'variety' | 'goals'> {
  recipeId: string;
  title: string;
  mealTypes?: readonly MealType[] | undefined;
}

export interface GoalSwap { fromMealId: string; fromTitle: string; toRecipeId: string; toTitle: string }

/** One planned meal that moves the goal the wrong way and one saved recipe that moves it the right way; null when nothing clearly better exists. */
export function suggestSwap(goal: GoalId, meals: readonly GoalMeal[], candidates: readonly GoalCandidate[]): GoalSwap | null {
  const def = GOAL_DEFS[goal];
  const up = def.direction === 'at_least';
  const planned = new Set(meals.map((m) => m.recipeId).filter((x): x is string => !!x));
  const scored = meals.flatMap((m) => {
    const v = perServingValue(goal, m);
    return v === null || !m.title ? [] : [{ m, v }];
  });
  if (scored.length === 0) return null;
  const from = scored.reduce((a, b) => (up ? (b.v < a.v ? b : a) : (b.v > a.v ? b : a)));
  const pool = candidates.flatMap((c) => {
    if (planned.has(c.recipeId)) return [];
    if (c.mealTypes && from.m.mealType && !c.mealTypes.includes(from.m.mealType)) return [];
    const v = perServingValue(goal, c);
    return v === null ? [] : [{ c, v }];
  });
  if (pool.length === 0) return null;
  const to = pool.reduce((a, b) => (up ? (b.v > a.v ? b : a) : (b.v < a.v ? b : a)));
  const clearlyBetter = up ? to.v > from.v * 1.25 && to.v - from.v > 0 : to.v < from.v * 0.75 && from.v - to.v > 0;
  return clearlyBetter ? { fromMealId: from.m.id, fromTitle: from.m.title!, toRecipeId: to.c.recipeId, toTitle: to.c.title } : null;
}

export interface GoalHint { goal: GoalId; text: string; swap?: GoalSwap }

/** Gentle, never prescriptive: only when the status is clearly "off" on known data, and at most `max` hints. */
export function goalHints(progress: readonly GoalProgress[], meals: readonly GoalMeal[], candidates: readonly GoalCandidate[], max = 2): GoalHint[] {
  const out: GoalHint[] = [];
  for (const p of progress) {
    if (p.status !== 'off' || out.length >= max) continue;
    const def = GOAL_DEFS[p.goal];
    const text = def.direction === 'at_least' ? `This week’s planned meals are on the low side for ${def.noun}.` : `This week’s planned meals are on the high side for ${def.noun}.`;
    const swap = suggestSwap(p.goal, meals, candidates);
    out.push({ goal: p.goal, text: swap ? `${text} If you like, you could try ${swap.toTitle} instead of ${swap.fromTitle}.` : text, ...(swap ? { swap } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Planner nudge (soft preference): how well one recipe fits a set of goals, 0..1.
// ---------------------------------------------------------------------------------------------------------------

/**
 * 0..1: the average over the goals of how well one serving of this recipe suits a dinner-sized share of the day.
 * More-goals reward a high amount, limit-goals reward a low one. Unknown data scores 0 (neutral: never rewarded, never
 * penalised), so it cannot be gamed by missing data. Used only as a soft solver preference, never a filter.
 */
export function recipeGoalFit(goals: readonly GoalId[], r: Pick<GoalMeal, 'perServing' | 'variety' | 'goals'>): number {
  if (goals.length === 0) return 0;
  let total = 0;
  for (const id of goals) {
    const def = GOAL_DEFS[id];
    const v = perServingValue(id, r);
    if (v === null) continue;
    const target = def.basis === 'week' ? def.reference : def.reference * MEAL_DAY_SHARE.dinner;
    const x = target > 0 ? Math.min(1, v / target) : 0;
    total += def.direction === 'at_least' ? x : 1 - x;
  }
  return Math.round((total / goals.length) * 1000) / 1000;
}
