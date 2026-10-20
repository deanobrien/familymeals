// Ported from apps/web/lib/plan/request-chips.ts (D133): pure edits for the editable constraint chips. Every edit returns a
// new request; the server re-validates it on solve.
import type { DietCategory, DietTarget, PlanRequest } from './types';

export type Diet = DietCategory;
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DIETS: readonly Diet[] = ['meat', 'fish', 'vegetarian', 'vegan'];
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const DEFAULT_QUICK_MINUTES = 30;
export type TargetKind = 'percent' | 'count' | 'min' | 'max';

const omit = <T extends object>(o: T, key: string): T => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as T;
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
const meals = (n: number) => `${n} meal${n === 1 ? '' : 's'}`;

/** "Vegetarian: about 50%", "Fish: 2 meals", "Vegan: at least 1 meals". */
export function describeTarget(diet: Diet, t: DietTarget): string {
  const name = cap(diet);
  if ('fraction' in t) return `${name}: about ${Math.round(t.fraction * 100)}%`;
  if ('count' in t) return `${name}: ${meals(t.count)}`;
  const parts: string[] = [];
  if (t.min !== undefined) parts.push(`at least ${t.min}`);
  if (t.max !== undefined) parts.push(`at most ${t.max}`);
  return `${name}: ${parts.join(', ')} ${t.max === 1 && t.min === undefined ? 'meal' : 'meals'}`;
}

export function setDietTarget(req: PlanRequest, diet: Diet, kind: TargetKind, value: number): PlanRequest {
  const n = Math.max(0, Number.isFinite(value) ? value : 0);
  const target: DietTarget =
    kind === 'percent' ? { fraction: Math.min(1, n / 100) }
    : kind === 'count' ? { count: Math.round(n) }
    : kind === 'min' ? { min: Math.round(n) }
    : { max: Math.round(n) };
  return { ...req, dietProportions: { ...req.dietProportions, [diet]: target } };
}

export function removeDietTarget(req: PlanRequest, diet: Diet): PlanRequest {
  const rest = omit(req.dietProportions ?? {}, diet);
  return Object.keys(rest).length === 0 ? omit(req, 'dietProportions') : { ...req, dietProportions: rest };
}

export const setServings = (req: PlanRequest, n: number): PlanRequest => ({ ...req, servings: Math.min(50, Math.max(1, Math.round(n) || 1)) });
export const setDays = (req: PlanRequest, n: number): PlanRequest => ({ ...req, days: Math.min(31, Math.max(1, Math.round(n) || 1)) });

/** Budget in pounds; null / 0 / negative clears it. */
export function setBudgetPounds(req: PlanRequest, pounds: number | null): PlanRequest {
  if (pounds === null || !Number.isFinite(pounds) || pounds <= 0) return omit(req, 'budgetPence');
  return { ...req, budgetPence: Math.round(pounds * 100) };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export function addTerm(req: PlanRequest, term: string): PlanRequest {
  const t = term.trim();
  if (!t || req.excludeTerms.some((x) => same(x, t))) return req;
  return { ...req, excludeTerms: [...req.excludeTerms, t] };
}
export const removeTerm = (req: PlanRequest, term: string): PlanRequest => ({ ...req, excludeTerms: req.excludeTerms.filter((x) => !same(x, term)) });
export const removeAllergen = (req: PlanRequest, a: string): PlanRequest => ({ ...req, excludeAllergens: req.excludeAllergens.filter((x) => !same(x, a)) });
export const removeTag = (req: PlanRequest, tag: string): PlanRequest => ({ ...req, includeTags: req.includeTags.filter((x) => !same(x, tag)) });

export function addFavourite(req: PlanRequest, name: string): PlanRequest {
  return !name.trim() || req.favouritesOf.some((x) => same(x, name)) ? req : { ...req, favouritesOf: [...req.favouritesOf, name.trim()] };
}
export const removeFavourite = (req: PlanRequest, name: string): PlanRequest => ({ ...req, favouritesOf: req.favouritesOf.filter((x) => !same(x, name)) });

export const quickWeekdays = (req: PlanRequest): Weekday[] => (req.quickMeals?.weekdays ?? []) as Weekday[];

export function toggleQuickDay(req: PlanRequest, day: Weekday): PlanRequest {
  const q = req.quickMeals;
  const days = new Set(quickWeekdays(req));
  if (days.has(day)) days.delete(day);
  else days.add(day);
  const weekdays = WEEKDAYS.filter((d) => days.has(d));
  if (weekdays.length === 0 && !(q?.dates ?? []).length) return omit(req, 'quickMeals');
  return { ...req, quickMeals: { dates: q?.dates ?? [], maxTotalMinutes: q?.maxTotalMinutes ?? DEFAULT_QUICK_MINUTES, strict: q?.strict ?? false, weekdays } };
}

export const setQuickStrict = (req: PlanRequest, strict: boolean): PlanRequest =>
  req.quickMeals ? { ...req, quickMeals: { ...req.quickMeals, strict } } : req;
export const setQuickMinutes = (req: PlanRequest, minutes: number): PlanRequest =>
  req.quickMeals ? { ...req, quickMeals: { ...req.quickMeals, maxTotalMinutes: Math.min(240, Math.max(5, Math.round(minutes) || DEFAULT_QUICK_MINUTES)) } } : req;
