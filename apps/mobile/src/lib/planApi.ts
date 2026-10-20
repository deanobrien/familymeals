// Client for the planner JSON API (apps/web /api/plan/**, D341) with defensive parsers: the contract belongs to the web
// app and may grow, so unknown parts are dropped and malformed ones fall back to safe defaults (never trusted).
import type { ServerApi } from './serverApi';
import { ServerApiError } from './serverApi';
import {
  MEAL_TYPES, type DietCategory, type IdeaCard, type IdeaNeed, type IdeasResult, type MealType, type ParsedRequest, type PlanDoc, type PlanEntry,
  type PlanPage, type PlanRequest, type Proposal, type ProposalSlot, type RecipeLite, type ShoppingHandoff,
} from './plan/types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const objs = (v: unknown): Obj[] => arr(v).filter(isObj);
const mealType = (v: unknown): MealType | null => (MEAL_TYPES.includes(v as MealType) ? (v as MealType) : null);
const DIETS: readonly string[] = ['meat', 'fish', 'vegetarian', 'vegan'];
const diet = (v: unknown): DietCategory | undefined => (typeof v === 'string' && DIETS.includes(v) ? (v as DietCategory) : undefined);

function parseEntry(v: unknown): PlanEntry | null {
  if (!isObj(v)) return null;
  const note = typeof v.note === 'string' && v.note ? { note: v.note } : {};
  if (v.kind === 'recipe') {
    const servings = num(v.servings);
    return typeof v.recipeId === 'string' && servings !== undefined ? { kind: 'recipe', recipeId: v.recipeId, servings, ...note } : null;
  }
  return v.kind === 'eating_out' || v.kind === 'leftovers' ? { kind: v.kind, ...note } : null;
}

export function parseDoc(v: unknown): PlanDoc | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.weekStart !== 'string') return null;
  const entries: Record<string, PlanEntry> = {};
  if (isObj(v.entries)) for (const [k, e] of Object.entries(v.entries)) { const p = parseEntry(e); if (p) entries[k] = p; }
  const mealTypes = arr(v.mealTypes).map(mealType).filter((m): m is MealType => !!m);
  const budget = num(v.budgetPence);
  return {
    id: v.id, householdId: str(v.householdId), weekStart: v.weekStart, mealTypes: mealTypes.length ? mealTypes : ['dinner'], entries,
    status: v.status === 'approved' ? 'approved' : 'draft',
    ...(budget !== undefined ? { budgetPence: budget } : {}),
    ...(typeof v.prompt === 'string' ? { prompt: v.prompt } : {}),
    ...(typeof v.proposalId === 'string' ? { proposalId: v.proposalId } : {}),
    updatedAt: str(v.updatedAt),
  };
}

const PROTEINS = ['fish', 'meat', 'plant'] as const;
/** Variety profile (D376): every field validated; anything malformed means "no data" (null), never invented numbers. */
function parseVariety(v: unknown): RecipeLite['variety'] {
  if (!isObj(v)) return null;
  const fv = num(v.fv);
  const pulses = num(v.pulses);
  if (fv === undefined || pulses === undefined || fv < 0 || pulses < 0) return null;
  const kinds = strs(v.proteins);
  return {
    fv, pulses, plants: strs(v.plants), proteinSources: strs(v.proteinSources),
    proteins: PROTEINS.filter((p) => kinds.includes(p)), unweighed: Math.max(0, Math.floor(num(v.unweighed) ?? 0)),
  };
}

function parseRecipe(v: Obj): RecipeLite | null {
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  const d = diet(v.dietCategory);
  const minutes = num(v.totalMinutes);
  return {
    id: v.id, title: v.title, ...(d ? { dietCategory: d } : {}), tags: strs(v.tags),
    mealTypes: arr(v.mealTypes).map(mealType).filter((m): m is MealType => !!m),
    baseServings: num(v.baseServings) ?? 4, ...(minutes !== undefined ? { totalMinutes: minutes } : {}),
    costPerServingPence: num(v.costPerServingPence) ?? null, // unknown stays null, never 0
    ...(v.costPartial === true ? { costPartial: true } : {}),
    nutritionPerServing: isObj(v.nutritionPerServing) ? (v.nutritionPerServing as unknown as RecipeLite['nutritionPerServing']) : null,
    variety: parseVariety(v.variety),
    excludedBy: strs(v.excludedBy),
  };
}

export function parsePage(v: unknown): PlanPage {
  const o = isObj(v) ? v : {};
  const doc = parseDoc(o.doc);
  if (!doc) throw new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');
  return {
    doc, isSaved: o.isSaved === true,
    recipes: objs(o.recipes).map(parseRecipe).filter((r): r is RecipeLite => !!r),
    saved: objs(o.saved).filter((s) => typeof s.id === 'string' && typeof s.weekStart === 'string')
      .map((s) => ({ id: s.id as string, weekStart: s.weekStart as string, status: s.status === 'approved' ? ('approved' as const) : ('draft' as const) })),
    householdExclusions: strs(o.householdExclusions), defaultServings: num(o.defaultServings) ?? 4,
    examplePrompt: str(o.examplePrompt), memberNames: strs(o.memberNames), withheldExclusions: Math.max(0, Math.floor(num(o.withheldExclusions) ?? 0)),
    ...(Array.isArray(o.memberDislikes)
      ? {
          memberDislikes: objs(o.memberDislikes)
            .filter((d) => typeof d.memberName === 'string' && strs(d.terms).length > 0)
            .map((d) => ({ memberName: d.memberName as string, terms: strs(d.terms) })),
        }
      : {}),
    ...(Array.isArray(o.cooked)
      ? { cooked: objs(o.cooked).filter((c) => typeof c.date === 'string' && typeof c.recipeId === 'string').map((c) => ({ date: c.date as string, recipeId: c.recipeId as string })) }
      : {}),
  };
}

/** Keep every key the server sent (so edits round trip) but guarantee the arrays the chips editor reads. */
export function parseRequest(v: unknown): PlanRequest {
  const o = isObj(v) ? v : {};
  return {
    ...o,
    mealTypes: arr(o.mealTypes).map(mealType).filter((m): m is MealType => !!m),
    servings: num(o.servings) ?? 4,
    excludeDietCategories: arr(o.excludeDietCategories).map(diet).filter((d): d is DietCategory => !!d),
    includeTags: strs(o.includeTags), excludeAllergens: strs(o.excludeAllergens), excludeTerms: strs(o.excludeTerms), favouritesOf: strs(o.favouritesOf),
  } as PlanRequest;
}

export function parseParsed(v: unknown): ParsedRequest {
  const o = isObj(v) ? v : {};
  return {
    prompt: str(o.prompt), weekStart: str(o.weekStart), request: parseRequest(o.request), householdExclusions: strs(o.householdExclusions),
    notes: objs(o.unmet).map((u) => str(u.detail)).filter(Boolean),
  };
}

function parseNeed(v: Obj): IdeaNeed {
  const c = isObj(v.criteria) ? v.criteria : {};
  const mt = mealType(c.mealType);
  const d = diet(c.dietCategory);
  const mins = num(c.maxTotalMinutes);
  const cost = num(c.maxCostPerServingPence);
  return {
    reason: str(v.reason, 'Recipes needed'), count: num(v.count) ?? 1,
    criteria: { ...(d ? { dietCategory: d } : {}), ...(mt ? { mealType: mt } : {}), ...(mins !== undefined ? { maxTotalMinutes: mins } : {}), ...(cost !== undefined ? { maxCostPerServingPence: cost } : {}) },
  };
}

export function parseProposal(v: unknown): Proposal {
  const o = isObj(v) ? v : {};
  const slots: ProposalSlot[] = objs(o.slots).flatMap((s) => {
    const mt = mealType(s.mealType);
    if (!mt || typeof s.date !== 'string') return [];
    return [{ date: s.date, mealType: mt, recipeId: typeof s.recipeId === 'string' ? s.recipeId : null, servings: num(s.servings) ?? 4, ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}) }];
  });
  const constraints = isObj(o.constraints) ? o.constraints : {};
  const budget = num(constraints.budgetPence);
  return {
    id: str(o.id), prompt: str(o.prompt), weekStart: str(o.weekStart), slots,
    mealTypes: arr(constraints.mealTypes).map(mealType).filter((m): m is MealType => !!m),
    ...(budget !== undefined ? { budgetPence: budget } : {}),
    reimposedExclusions: strs(o.reimposedExclusions), explanations: strs(o.explanations),
    unmet: objs(o.unmet).map((u) => ({ kind: str(u.kind), detail: str(u.detail) })).filter((u) => u.detail),
    report: objs(o.report).map((r) => ({ constraint: str(r.constraint), met: r.met === true, detail: str(r.detail) })).filter((r) => r.constraint),
    gaps: objs(o.gaps).flatMap((g) => { const mt = mealType(g.mealType); return mt && typeof g.date === 'string' ? [{ date: g.date, mealType: mt, reason: str(g.reason) }] : []; }),
    ideas: objs(o.ideas).map(parseNeed),
    totalCostPence: num(o.totalCostPence) ?? null, uncostedMeals: strs(o.uncostedMeals),
    ...(isObj(o.request) ? { request: parseRequest(o.request) } : {}),
  };
}

export function parseHandoff(v: unknown): ShoppingHandoff {
  const o = isObj(v) ? v : {};
  return {
    count: num(o.count) ?? 0, href: str(o.href, '/shopping'),
    preview: objs(o.preview).map((p) => ({ name: str(p.name), quantity: str(p.quantity) })).filter((p) => p.name),
  };
}

export function parseIdeas(v: unknown): IdeasResult {
  const o = isObj(v) ? v : {};
  const cards = objs(o.cards).flatMap((c): IdeaCard[] => {
    if (typeof c.id !== 'string' || typeof c.title !== 'string') return [];
    const attribution = isObj(c.attribution) ? c.attribution : {};
    return [{
      id: c.id, title: c.title, ...(typeof c.area === 'string' ? { area: c.area } : {}), ...(typeof c.category === 'string' ? { category: c.category } : {}),
      diet: diet(c.diet) ?? 'meat', dietNote: str(c.dietNote),
      ingredients: objs(c.ingredients).map((i) => ({ name: str(i.name), measure: str(i.measure) })).filter((i) => i.name),
      steps: strs(c.steps), publisher: str(attribution.publisher),
    }];
  });
  return { cards, withheld: num(o.withheld) ?? 0, sourceLabel: str(o.sourceLabel) };
}

/** What a failed call should show: the server's message plus any hard-constraint `violations`, gaps and unmet items. */
export interface PlanFailure {
  message: string;
  violations: string[];
  unmet: string[];
  gapCount: number;
  gapNeeds: IdeaNeed[];
  retryable: boolean;
}
export function describeError(e: unknown): PlanFailure {
  if (e instanceof ServerApiError) {
    const d = e.details ?? {};
    const gaps = objs(d.gaps);
    const needs: IdeaNeed[] = MEAL_TYPES.flatMap((m) => {
      const n = gaps.filter((g) => g.mealType === m).length;
      return n > 0 ? [{ reason: `${n} ${m} slot${n === 1 ? '' : 's'} could not be filled from your library.`, count: n, criteria: { mealType: m } }] : [];
    });
    return { message: e.message, violations: strs(d.violations), unmet: objs(d.unmet).map((u) => str(u.detail)).filter(Boolean), gapCount: gaps.length, gapNeeds: needs, retryable: e.retryable };
  }
  return { message: e instanceof Error ? e.message : 'Something went wrong.', violations: [], unmet: [], gapCount: 0, gapNeeds: [], retryable: true };
}

export interface IdeaExtra { terms: string[]; allergens: string[]; excludeDiets: DietCategory[] }

export interface PlanClient {
  loadWeek(week?: string): Promise<PlanPage>;
  /** The saved plan for a week or null (reuse previous week). */
  loadSaved(week: string): Promise<PlanDoc | null>;
  save(doc: PlanDoc): Promise<PlanDoc>;
  approve(doc: PlanDoc): Promise<PlanDoc>;
  parse(prompt: string, weekStart: string): Promise<ParsedRequest>;
  solve(prompt: string, weekStart: string, request: PlanRequest): Promise<Proposal>;
  generateShopping(planId: string): Promise<ShoppingHandoff>;
  findIdeas(need: IdeaNeed, extra: IdeaExtra): Promise<IdeasResult>;
  /** Draft an idea and save it to the library (after the user has seen its ingredients and method). */
  saveIdea(id: string): Promise<{ id: string; title: string }>;
}

const unexpected = () => new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');

export function createPlanClient(api: ServerApi, householdId: string): PlanClient {
  const withDoc = async (path: string, doc: PlanDoc): Promise<PlanDoc> => {
    const body = await api.post<unknown>(path, { householdId, doc });
    const out = parseDoc(isObj(body) ? body.doc : null);
    if (!out) throw unexpected();
    return out;
  };
  return {
    loadWeek: async (week) => parsePage(await api.get('/api/plan', { householdId, week })),
    loadSaved: async (week) => {
      const body = await api.get<unknown>('/api/plan/week', { householdId, week });
      return isObj(body) ? parseDoc(body.doc) : null;
    },
    save: (doc) => withDoc('/api/plan/save', doc),
    approve: (doc) => withDoc('/api/plan/approve', doc),
    parse: async (prompt, weekStart) => {
      const body = await api.post<unknown>('/api/plan/parse', { householdId, prompt, weekStart });
      if (!isObj(body) || !isObj(body.parsed)) throw unexpected();
      return parseParsed(body.parsed);
    },
    solve: async (prompt, weekStart, request) => {
      const body = await api.post<unknown>('/api/plan/solve', { householdId, prompt, weekStart, request });
      if (!isObj(body) || !isObj(body.proposal)) throw unexpected();
      return parseProposal(body.proposal);
    },
    generateShopping: async (planId) => parseHandoff(await api.post('/api/plan/generate-shopping', { householdId, planId })),
    findIdeas: async (need, extra) => parseIdeas(await api.post('/api/plan/ideas', { householdId, criteria: need.criteria, extra })),
    saveIdea: async (id) => {
      const draft = await api.post<unknown>('/api/plan/ideas/draft', { householdId, id });
      if (!isObj(draft) || typeof draft.uploadId !== 'string' || !isObj(draft.draft)) throw unexpected();
      const title = fieldTitle(draft.draft);
      const blocking = objs(draft.draft.issues).filter((i) => i.blocking === true);
      if (blocking.length > 0) {
        throw new ServerApiError(`"${title}" needs checking on the web before it can be saved (${str(blocking[0]!.message, 'a blocking issue')}).`, 422, false, 'NEEDS_WEB_REVIEW');
      }
      const saved = await api.post<unknown>('/api/extract/save', { uploadId: draft.uploadId, draft: draft.draft });
      if (!isObj(saved) || typeof saved.id !== 'string') throw unexpected();
      return { id: saved.id, title };
    },
  };
}

function fieldTitle(draft: Obj): string {
  const t = isObj(draft.title) ? draft.title.value : undefined;
  return typeof t === 'string' && t ? t : 'This recipe';
}

/** Same wording as the web ConsentNotice (D129, D242): a count only, never allergen or member names. */
export function consentNoticeText(withheld: number): string | null {
  const n = Math.max(0, Math.floor(withheld));
  if (!(n > 0)) return null;
  const subject = n === 1 ? "1 allergy exclusion isn't" : `${n} allergy exclusions aren't`;
  return `${subject} being applied because consent hasn't been given`;
}
