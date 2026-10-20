import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

// The auth layer is tested in lib/server/auth/request-auth.test.ts; here it is the routes' contract that matters.
let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

const { GET: getWeek } = await import('./route');
const { GET: getSaved } = await import('./week/route');
const { POST: save } = await import('./save/route');
const { POST: approve } = await import('./approve/route');
const { POST: parse } = await import('./parse/route');
const { POST: solve } = await import('./solve/route');
const { POST: propose } = await import('./propose/route');
const { POST: generate } = await import('./generate-shopping/route');
const { POST: ideas } = await import('./ideas/route');
const { POST: ideaDraft } = await import('./ideas/draft/route');
const { getPlanServicesFor } = await import('../../../lib/server/plan/services');
const { EXAMPLE_PROMPT } = await import('../../../lib/server/plan/handlers');

const WEEK = '2026-10-19';
let n = 0;
let H = '';
const who = (readOnly = false): AuthOutcome => ({ ok: true, auth: { userId: 'user-1', householdId: H, readOnly, dataContext: null } });
const get = (url: string) => new Request(`http://t${url}`, { headers: { authorization: 'Bearer good' } });
const post = (body: unknown) =>
  new Request('http://t/api/plan/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer good' } });

interface Page { doc: { id: string; householdId: string; weekStart: string; status: string; entries: Record<string, unknown>; mealTypes: string[] }; recipes: Array<{ id: string; title: string; excludedBy: string[] }>; withheldExclusions: number; isSaved: boolean }
const page = async (week = WEEK): Promise<Page> => (await getWeek(get(`/api/plan?householdId=${H}&week=${week}`))).json();

const withRecipe = (p: Page, recipeId: string, servings = 4) => ({ ...p.doc, entries: { [`${WEEK}|dinner`]: { kind: 'recipe', recipeId, servings } } });

beforeEach(() => {
  H = `bb00000${n++}-0000-4000-8000-0000000000bb`;
  outcome = who();
  seen.length = 0;
  vi.stubEnv('RECIPE_SOURCE', 'mock');
});

describe('auth and read-only handling', () => {
  it('returns 401 / 403 from the auth layer on every route before doing any work', async () => {
    for (const status of [401, 403] as const) {
      outcome = { ok: false, status, message: 'no' };
      expect((await getWeek(get(`/api/plan?householdId=${H}`))).status).toBe(status);
      expect((await getSaved(get(`/api/plan/week?householdId=${H}&week=${WEEK}`))).status).toBe(status);
      for (const route of [save, approve, parse, solve, propose, generate, ideas, ideaDraft]) {
        const res = await route(post({ householdId: H }));
        expect(res.status).toBe(status);
        expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
      }
    }
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('refuses writes for a read-only household (save, approve, generate-shopping, idea draft) with 403 READ_ONLY', async () => {
    const p = await page();
    outcome = who(true);
    const doc = withRecipe(p, p.recipes[0]!.id);
    for (const [route, body] of [[save, { doc }], [approve, { doc }], [generate, { planId: doc.id }], [ideaDraft, { id: '1' }]] as const) {
      const res = await route(post({ householdId: H, ...body }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('READ_ONLY');
    }
    // reads still work
    expect((await getWeek(get(`/api/plan?householdId=${H}`))).status).toBe(200);
  });

  it('400s a non-JSON body and a malformed plan', async () => {
    expect((await save(new Request('http://t/x', { method: 'POST', body: 'nope' }))).status).toBe(400);
    expect((await save(post({ householdId: H, doc: { id: 1 } }))).status).toBe(400);
    expect((await save(post({ householdId: H, doc: { id: 'x', householdId: H, weekStart: WEEK, mealTypes: ['dinner'], entries: { a: { kind: 'recipe' } } } }))).status).toBe(400);
  });
});

describe('GET /api/plan and /api/plan/week', () => {
  it('returns the empty draft for the Monday of the week, the recipe catalogue and the consent count', async () => {
    const p = await getWeek(get(`/api/plan?householdId=${H}&week=2026-10-22`));
    expect(p.status).toBe(200);
    const body = (await p.json()) as Page & { householdExclusions: string[]; examplePrompt: string; memberNames: string[] };
    expect(body.doc.weekStart).toBe(WEEK);
    expect(body.isSaved).toBe(false);
    expect(body.recipes.length).toBeGreaterThan(3);
    expect(body.withheldExclusions).toBe(0);
    expect(body.examplePrompt).toBe(EXAMPLE_PROMPT);
    expect(body.memberNames.length).toBeGreaterThan(0);
  });

  it('week returns null when nothing is saved', async () => {
    const res = await getSaved(get(`/api/plan/week?householdId=${H}&week=${WEEK}`));
    expect((await res.json()).doc).toBeNull();
  });
});

describe('save -> load round trip, approve, shopping', () => {
  it('saves a draft, reloads it, approves it, then generates the shopping list only from the approved plan', async () => {
    const p = await page();
    const ok = p.recipes.find((r) => r.excludedBy.length === 0)!;
    const doc = withRecipe(p, ok.id, 3);

    const saved = await save(post({ householdId: H, doc }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).doc.status).toBe('draft');
    const loaded = (await (await getSaved(get(`/api/plan/week?householdId=${H}&week=${WEEK}`))).json()).doc;
    expect(loaded.entries[`${WEEK}|dinner`]).toMatchObject({ kind: 'recipe', recipeId: ok.id, servings: 3 });
    expect((await page()).isSaved).toBe(true);

    // an unapproved plan cannot generate a list
    const early = await generate(post({ householdId: H, planId: doc.id }));
    expect(early.status).toBe(422);
    expect((await early.json()).error.message).toMatch(/Approve the plan/);

    const approved = await approve(post({ householdId: H, doc }));
    expect(approved.status).toBe(200);
    expect((await approved.json()).doc.status).toBe('approved');

    const gen = await generate(post({ householdId: H, planId: doc.id }));
    expect(gen.status).toBe(200);
    const out = (await gen.json()) as { count: number; href: string; preview: unknown[] };
    expect(out.count).toBeGreaterThan(0);
    expect(out.href).toContain('/shopping');
  });

  it('refuses a plan for another household, an unknown recipe, and bad servings (422 with violations)', async () => {
    const p = await page();
    const id = p.recipes[0]!.id;
    const other = await save(post({ householdId: H, doc: { ...withRecipe(p, id), householdId: 'someone-else' } }));
    expect(other.status).toBe(422);
    expect((await other.json()).violations[0]).toMatch(/different household/);
    expect((await save(post({ householdId: H, doc: withRecipe(p, 'nope') }))).status).toBe(422);
    expect((await save(post({ householdId: H, doc: withRecipe(p, id, 500) }))).status).toBe(422);
  });

  it('approve refuses a recipe that hits a hard exclusion (and so does save); the catalogue marks it excludedBy', async () => {
    const svc = getPlanServicesFor(H);
    const first = (await svc.recipes.list(H))[0]!;
    svc.household.hardExclusions = [{ ingredientName: first.ingredientNames[0]!, kind: 'allergy' }];
    const p = await page();
    expect(p.recipes.find((r) => r.id === first.id)!.excludedBy.length).toBeGreaterThan(0);
    const doc = withRecipe(p, first.id);
    for (const route of [approve, save]) {
      const res = await route(post({ householdId: H, doc }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.violations.join(' ')).toMatch(/excluded ingredient/);
    }
    expect((await page()).isSaved).toBe(false);
  });

  it('approve refuses an empty plan', async () => {
    const p = await page();
    const res = await approve(post({ householdId: H, doc: p.doc }));
    expect(res.status).toBe(422);
    expect((await res.json()).violations.join(' ')).toMatch(/at least one recipe/);
  });
});

describe('prompt flow with the mock AI provider', () => {
  it('parse returns editable constraints; solve returns a proposal with a constraint report; nothing is saved', async () => {
    const parsed = await parse(post({ householdId: H, prompt: EXAMPLE_PROMPT, weekStart: WEEK }));
    expect(parsed.status).toBe(200);
    const { parsed: pr } = (await parsed.json()) as { parsed: { request: Record<string, unknown>; householdExclusions: string[]; unmet: unknown[] } };
    expect(pr.request.servings).toBeGreaterThan(0);
    expect(Array.isArray(pr.householdExclusions)).toBe(true);

    const solved = await solve(post({ householdId: H, prompt: EXAMPLE_PROMPT, weekStart: WEEK, request: pr.request }));
    expect(solved.status).toBe(200);
    const { proposal } = (await solved.json()) as { proposal: { slots: unknown[]; report: unknown[]; reimposedExclusions: string[]; id: string } };
    expect(proposal.slots).toHaveLength(7);
    expect(proposal.report.length).toBeGreaterThan(0);
    expect(proposal.reimposedExclusions).toContain('peanuts');
    expect((await page()).isSaved).toBe(false);

    const one = await propose(post({ householdId: H, prompt: EXAMPLE_PROMPT, weekStart: WEEK }));
    expect(one.status).toBe(200);
  });

  it('rejects an empty prompt, a bad week and an invalid request with 400 and a code', async () => {
    const empty = await parse(post({ householdId: H, prompt: '  ', weekStart: WEEK }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe('EMPTY_PROMPT');
    expect((await solve(post({ householdId: H, prompt: 'x', weekStart: 'bad', request: {} }))).status).toBe(400);
    const bad = await solve(post({ householdId: H, prompt: 'plan dinners', weekStart: WEEK, request: { servings: 'many' } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_REQUEST');
  });
});

describe('ideas for gaps', () => {
  it('finds idea cards from the (mock) source and refuses invalid criteria', async () => {
    const res = await ideas(post({ householdId: H, criteria: { mealType: 'dinner' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; cards: Array<{ id: string; title: string }> };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.cards)).toBe(true);
    expect((await ideas(post({ householdId: H, criteria: { dietCategory: 'nonsense' } }))).status).toBe(400);
  });

  it('draft takes only a numeric source id', async () => {
    expect((await ideaDraft(post({ householdId: H, id: '../x' }))).status).toBe(400);
  });
});
