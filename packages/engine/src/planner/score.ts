import { countsTowards, type Problem } from './problem';

/** Candidate index per slot (null = empty / skipped). Indexed by PreparedSlot.index. */
export type Assignment = (number | null)[];

export interface PlanStats {
  filled: number;
  empty: number;
  dietActual: number[]; // aligned with problem.targets
  dietDistance: number[];
  totalCostPence: number;
  costedMeals: number;
  uncostedMeals: number;
  favourites: number;
  /** Member-dislike hits across planned meals (a meal counts once per member who dislikes something in it). */
  dislikes: number;
  /** Sum over filled slots of (rating - 3) for rated recipes. */
  ratingPoints: number;
  quickMisses: number;
  tagHits: number;
  repeats: number;
  recent: number;
}

export interface Score {
  total: number;
  stats: PlanStats;
}

export function computeStats(p: Problem, a: Assignment): PlanStats {
  const k = p.constraints;
  const uses = new Map<number, number>();
  const catCount = { meat: 0, fish: 0, vegetarian: 0, vegan: 0 };
  let filled = 0, empty = 0, cost = 0, costed = 0, uncosted = 0;
  let ratingPoints = 0;
  let fav = 0, quickMisses = 0, tags = 0, recent = 0, dislikes = 0;
  for (const s of p.plannable) {
    const ci = a[s];
    if (ci === null || ci === undefined) {
      empty++;
      continue;
    }
    filled++;
    const c = p.candidates[ci]!;
    uses.set(ci, (uses.get(ci) ?? 0) + 1);
    catCount[c.dietCategory]++;
    if (c.estCostPerServingPence === null) uncosted++;
    else {
      costed++;
      cost += c.estCostPerServingPence * k.servings;
    }
    if (p.isFavourite[ci]) fav++;
    dislikes += p.dislikeCount[ci]!;
    if (c.rating != null) ratingPoints += c.rating - 3;
    tags += p.tagHits[ci]!;
    if (p.isRecent[ci]) recent++;
    const max = p.slots[s]!.quickMaxMinutes;
    if (max !== undefined && (c.totalMinutes === null || c.totalMinutes > max)) quickMisses++;
  }
  let repeats = 0;
  for (const u of uses.values()) repeats += u - 1;
  const dietActual = p.targets.map((t) => {
    let n = 0;
    for (const cat of ['meat', 'fish', 'vegetarian', 'vegan'] as const) {
      if (countsTowards(cat, t.category, k.vegetarianIncludesVegan)) n += catCount[cat];
    }
    return n;
  });
  const dietDistance = p.targets.map((t, i) => {
    const x = dietActual[i]!;
    return Math.max(0, t.lo - x) + Math.max(0, x - t.hi);
  });
  return {
    filled, empty, dietActual, dietDistance,
    totalCostPence: cost, costedMeals: costed, uncostedMeals: uncosted,
    favourites: fav, dislikes, ratingPoints, quickMisses, tagHits: tags, repeats, recent,
  };
}

/** Weighted soft objective; lower is better. Deterministic (fixed summation order). */
export function score(p: Problem, a: Assignment): Score {
  const st = computeStats(p, a);
  const w = p.weights;
  const k = p.constraints;
  let total = 0;
  for (const d of st.dietDistance) total += d * w.dietPerMeal;
  if (k.budgetPence !== undefined) {
    const over = Math.max(0, st.totalCostPence - k.budgetPence);
    total += (over / 100) * w.budgetPerPound;
    total += st.uncostedMeals * w.uncostedWithBudget;
  }
  // Tie-break towards cheaper plans; uncosted meals are imputed at the library median.
  const imputed = st.totalCostPence + st.uncostedMeals * p.imputedCostPerServing * k.servings;
  total += (imputed / 100) * w.costTieBreakPerPound;
  total -= st.favourites * w.favourite;
  total += st.dislikes * w.dislike;
  total -= st.ratingPoints * w.rating;
  total += st.quickMisses * w.quickMiss;
  total -= st.tagHits * w.includeTag;
  if (k.repeats !== 'allow') total += st.repeats * w.repeat;
  total += st.recent * w.recent;
  total += st.empty * w.emptySlot;
  return { total, stats: st };
}
