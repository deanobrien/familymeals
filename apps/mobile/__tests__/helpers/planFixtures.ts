import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import { mondayOf } from '@/lib/plan/dates';

export const HH = 'hh-1';
export const WEEK = '2026-10-19';

export const recipeJson = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, title, dietCategory: 'meat', tags: [], mealTypes: ['dinner'], baseServings: 4, costPerServingPence: 100, excludedBy: [], ...over,
});

export const RECIPES = [
  recipeJson('r1', 'Fish pie', { dietCategory: 'fish', costPerServingPence: 285, totalMinutes: 50 }),
  recipeJson('r2', 'Tomato pasta', { dietCategory: 'vegetarian', costPerServingPence: 95 }),
  recipeJson('r3', 'Peanut satay', { excludedBy: ['peanuts'] }),
  recipeJson('r4', 'Mystery stew', { costPerServingPence: null }),
];

export function pageJson(week: string | undefined, over: Record<string, unknown> = {}, doc: Record<string, unknown> = {}) {
  const weekStart = mondayOf(week ?? WEEK);
  return {
    doc: { id: `plan-${weekStart}`, householdId: HH, weekStart, mealTypes: ['dinner'], entries: {}, status: 'draft', updatedAt: '2026-10-19T08:00:00.000Z', ...doc },
    isSaved: false, recipes: RECIPES, saved: [], householdExclusions: ['peanuts'], defaultServings: 4,
    examplePrompt: 'Plan seven dinners for four people.', memberNames: ['Lauren', 'Sam'], withheldExclusions: 0, ...over,
  };
}

export const PARSED = {
  parsed: {
    prompt: 'Plan seven dinners for four people.', weekStart: WEEK,
    request: {
      days: 7, mealTypes: ['dinner'], servings: 4, budgetPence: 10000, dietProportions: { vegetarian: { fraction: 0.5 } },
      excludeDietCategories: [], includeTags: [], excludeAllergens: [], excludeTerms: ['mushrooms'], favouritesOf: ['Lauren'],
    },
    householdExclusions: ['peanuts'], unmet: [{ kind: 'member_unknown', detail: 'We could not find a member called Bob.' }],
  },
};

const DAYS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
export const PROPOSAL = {
  proposal: {
    id: 'prop1', prompt: 'Plan seven dinners for four people.', weekStart: WEEK,
    constraints: { mealTypes: ['dinner'], budgetPence: 10000 },
    slots: DAYS.map((date, i) => ({ date, mealType: 'dinner', recipeId: i === 6 ? null : i % 2 === 0 ? 'r1' : 'r2', servings: 4, ...(i === 6 ? { note: 'Needs a new recipe' } : {}) })),
    reimposedExclusions: ['peanuts'], explanations: ['Whole meals are shared out by the largest remainder.'],
    unmet: [{ kind: 'solver', detail: 'Only 1 fish meal could be planned.' }],
    report: [{ constraint: 'Budget', met: true, detail: 'Under 100 pounds' }, { constraint: 'Fish meals', met: false, detail: 'Only 1 of 2' }],
    gaps: [{ date: '2026-10-25', mealType: 'dinner', reason: 'No viable recipe for Sunday' }],
    ideas: [{ reason: '1 fish meal short', count: 1, criteria: { dietCategory: 'fish', mealType: 'dinner' } }],
    totalCostPence: 4200, uncostedMeals: ['2026-10-25|dinner'],
  },
};

export const IDEAS = {
  ok: true, withheld: 1, sourceLabel: 'Sample recipes',
  cards: [{
    id: '5200', title: 'Salmon traybake', area: 'British', category: 'Seafood', diet: 'fish', dietNote: 'Contains fish.',
    ingredients: [{ name: 'salmon', measure: '2 fillets' }], steps: ['Roast it.'], attribution: { publisher: 'TheMealDB', url: 'https://x', id: '5200' },
  }],
};

export const err = (status: number, message: string, details: Record<string, unknown> = {}, code?: string) =>
  new ServerApiError(message, status, status >= 500, code, { error: { message, code }, ...details });

type Handler = (payload: Record<string, unknown>) => unknown;
export interface FakeCalls { method: 'GET' | 'POST'; path: string; payload: Record<string, unknown> }

/** A fake ServerApi: `routes` maps "METHOD /path" to a handler (throw a ServerApiError to fail). */
export function fakePlanApi(routes: Record<string, Handler> = {}, configured = true) {
  const calls: FakeCalls[] = [];
  const dispatch = (method: 'GET' | 'POST', path: string, payload: Record<string, unknown>) => {
    calls.push({ method, path, payload });
    const h = routes[`${method} ${path}`];
    if (h) return h(payload);
    if (method === 'GET' && path === '/api/plan') return pageJson(payload.week as string | undefined);
    if (method === 'GET' && path === '/api/plan/week') return { doc: null };
    if (path === '/api/plan/save' || path === '/api/plan/approve') {
      const doc = payload.doc as Record<string, unknown>;
      return { doc: { ...doc, status: path.endsWith('approve') ? 'approved' : 'draft' } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const api: ServerApi = {
    configured,
    get: async (path, query) => dispatch('GET', path, (query ?? {}) as Record<string, unknown>) as never,
    post: async (path, body) => dispatch('POST', path, body as Record<string, unknown>) as never,
    postForm: async () => { throw new Error('unused'); },
    webUrl: (p) => `http://web.test${p}`,
    authHeaders: async () => ({}),
  };
  return { api, calls, posts: (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path) };
}
