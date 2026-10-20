import { createRecipesApi } from '@/lib/recipesApi';

const HH = 'a1000000-0000-4000-8000-0000000000a1';
const ID = 'e1000000-0000-4000-8000-000000000001';

function api(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; method: string; body: unknown; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const r = handler(url, init);
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).Authorization });
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { recipes: createRecipesApi({ baseUrl: 'https://x.test', getToken: async () => 'tok', fetchImpl }), calls };
}

const COOKING = { cookedCount: 1, lastCookedAt: '2026-10-21T10:00:00Z', history: [], myRating: 5, dontSuggest: false, dontSuggestCount: 0 };

describe('cooking calls go to the shared server routes with the bearer token', () => {
  it('mark cooked posts the household, rating and note; a 422 returns the field errors instead of throwing', async () => {
    const { recipes, calls } = api((url) =>
      url.endsWith('/cooked') && calls_len() === 0
        ? { status: 200, body: { entry: { id: 'c1' }, cooking: COOKING } }
        : { status: 422, body: { error: { code: 'INVALID_INPUT', message: 'Some values were not accepted.', fieldErrors: { servings: 'At least 1 serving' } } } },
    );
    function calls_len() { return calls.length; }
    const ok = await recipes.markCooked(HH, ID, { servings: 4, rating: 5, note: 'less chilli', notePrivate: true });
    expect(ok).toMatchObject({ ok: true, cooking: { myRating: 5 } });
    expect(calls[0]).toMatchObject({ url: `https://x.test/api/recipes/${ID}/cooked`, method: 'POST', auth: 'Bearer tok', body: { householdId: HH, servings: 4, rating: 5, note: 'less chilli', notePrivate: true } });
    const bad = await recipes.markCooked(HH, ID, { servings: 0 });
    expect(bad).toEqual({ ok: false, message: 'Some values were not accepted.', fieldErrors: { servings: 'At least 1 serving' } });
  });

  it("don't suggest posts the flag and returns the new cooking state", async () => {
    const { recipes, calls } = api(() => ({ status: 200, body: { cooking: { ...COOKING, dontSuggest: true } } }));
    expect(await recipes.setDontSuggest(HH, ID, true)).toMatchObject({ dontSuggest: true });
    expect(calls[0]).toMatchObject({ url: `https://x.test/api/recipes/${ID}/dont-suggest`, body: { householdId: HH, value: true } });
  });

  it('substitutions return the server-vetted suggestions; a failure is a message, not a crash', async () => {
    let fail = false;
    const { recipes, calls } = api(() =>
      fail
        ? { status: 503, body: { error: { code: 'AI_UNAVAILABLE', message: 'The AI service is temporarily unavailable.', retryable: true } } }
        : { status: 200, body: { ingredient: { lineId: 'l1', name: 'butter' }, suggestions: [{ substitute: 'margarine', quantityGuidance: 'Swap 1:1.', effect: 'x', dietSafe: true }], withheld: 1, withheldUnverifiable: 0, exclusionsActive: true } },
    );
    expect(await recipes.suggestSubstitutions(HH, ID, 'l1')).toMatchObject({ ok: true, withheld: 1, suggestions: [{ substitute: 'margarine' }] });
    expect(calls[0]).toMatchObject({ url: `https://x.test/api/recipes/${ID}/substitutions`, body: { householdId: HH, lineId: 'l1' } });
    fail = true;
    expect(await recipes.suggestSubstitutions(HH, ID, 'l1')).toEqual({ ok: false, message: 'The AI service is temporarily unavailable.' });
  });

  it('save variant sends the swaps and returns the new recipe; an exclusion refusal is a message', async () => {
    let refuse = false;
    const { recipes, calls } = api(() =>
      refuse ? { status: 422, body: { error: { code: 'EXCLUDED', message: 'One of those swaps cannot be used with your household exclusions.' } } } : { status: 200, body: { id: 'new-1', title: 'Cake (no butter)' } },
    );
    expect(await recipes.saveVariant(HH, ID, [{ lineId: 'l1', name: 'margarine', guidance: 'Swap 1:1.' }])).toEqual({ ok: true, id: 'new-1', title: 'Cake (no butter)' });
    expect(calls[0]).toMatchObject({ url: `https://x.test/api/recipes/${ID}/variant`, body: { swaps: [{ lineId: 'l1', name: 'margarine', guidance: 'Swap 1:1.' }] } });
    refuse = true;
    expect(await recipes.saveVariant(HH, ID, [{ lineId: 'l1', name: 'peanut butter' }])).toMatchObject({ ok: false, message: expect.stringContaining('household exclusions') });
  });
});
