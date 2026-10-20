import { ApiError, queryString } from '@/lib/apiClient';
import { EMPTY_QUERY, createRecipesApi, isStoragePath, type RecipeInputWire } from '@/lib/recipesApi';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const H = '11111111-1111-4111-8111-111111111111';

function client(fetchImpl: jest.Mock) {
  return createRecipesApi({ baseUrl: 'http://web.test/', getToken: async () => 'tok', fetchImpl });
}
const call = (f: jest.Mock, n = 0) => {
  const [url, init] = f.mock.calls[n] as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
};

describe('queryString', () => {
  it('skips empty values, repeats arrays and encodes', () => {
    expect(queryString({ a: 'x y', b: undefined, c: '', d: ['t1', 't2'], e: 3 })).toBe('?a=x%20y&d=t1&d=t2&e=3');
    expect(queryString()).toBe('');
  });
});

describe('recipes api (bearer JSON routes)', () => {
  it('lists with the web query names, the household and the bearer token', async () => {
    const f = jest.fn().mockResolvedValue(json({ items: [], total: 0, page: 2, pageSize: 20, pageCount: 1, cuisines: [], tags: [], hasAny: false }));
    await client(f).list(H, { ...EMPTY_QUERY, q: 'soup', cuisine: 'Thai', mealType: 'dinner', maxPrepMinutes: 30, diet: 'vegan', priceBand: 'low', tags: ['a', 'b'], collection: 'quick', sort: 'cost', page: 2 });
    const { url, init } = call(f);
    expect(url).toBe(`http://web.test/api/recipes?householdId=${H}&q=soup&cuisine=Thai&meal=dinner&prep=30&diet=vegan&price=low&tag=a&tag=b&collection=quick&sort=cost&page=2`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('omits defaults (sort=name, page 1, empty search)', async () => {
    const f = jest.fn().mockResolvedValue(json({ items: [] }));
    await client(f).list(H, EMPTY_QUERY);
    expect(call(f).url).toBe(`http://web.test/api/recipes?householdId=${H}`);
  });

  it('get returns null for a 404 and rethrows other errors', async () => {
    const f = jest.fn().mockResolvedValueOnce(json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404)).mockResolvedValueOnce(json({ error: { message: 'boom' } }, 500));
    const api = client(f);
    await expect(api.get(H, 'r1')).resolves.toBeNull();
    await expect(api.get(H, 'r1')).rejects.toMatchObject({ status: 500, retryable: true });
  });

  it('saves with POST (create) or PUT (edit) and maps validation (422) and not-found (404) to a result', async () => {
    const input = { title: 'T' } as unknown as RecipeInputWire;
    const f = jest
      .fn()
      .mockResolvedValueOnce(json({ ok: true, id: 'new', links: [] }))
      .mockResolvedValueOnce(json({ ok: false, fieldErrors: { title: 'Title is required' } }, 422))
      .mockResolvedValueOnce(json({ ok: false, fieldErrors: {}, duplicates: [{ id: 'd', title: 'Dup' }] }, 422))
      .mockResolvedValueOnce(json({ error: { message: 'Recipe not found' } }, 404));
    const api = client(f);
    await expect(api.save(H, null, input, false)).resolves.toEqual({ ok: true, id: 'new', links: [] });
    expect(call(f, 0).url).toBe('http://web.test/api/recipes');
    expect(call(f, 0).init.method).toBe('POST');
    expect(JSON.parse(call(f, 0).init.body as string)).toEqual({ householdId: H, recipe: input });

    await expect(api.save(H, 'r1', input, false)).resolves.toMatchObject({ ok: false, fieldErrors: { title: 'Title is required' } });
    expect(call(f, 1).url).toBe('http://web.test/api/recipes/r1');
    expect(call(f, 1).init.method).toBe('PUT');

    await expect(api.save(H, 'r1', input, true)).resolves.toMatchObject({ ok: false, duplicates: [{ id: 'd', title: 'Dup' }] });
    expect(JSON.parse(call(f, 2).init.body as string).force).toBe(true);

    await expect(api.save(H, 'gone', input, true)).resolves.toEqual({ ok: false, fieldErrors: {}, message: 'Recipe not found' });
  });

  it('delete, favourite, rematch, duplicates, catalogue and discover hit the contracted routes', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: true, favourite: true }))
      .mockResolvedValueOnce(json({ ok: true, summary: { recipes: 1, updated: 1, linked: 2, ambiguous: 0, unmatched: 0 } }))
      .mockResolvedValueOnce(json({ hits: [{ id: 'x', title: 'X' }] }))
      .mockResolvedValueOnce(json({ candidates: [{ id: 'i', name: 'Onion' }] }))
      .mockResolvedValueOnce(json({ suggestions: [{ status: 'unmatched', candidates: [] }] }))
      .mockResolvedValueOnce(json({ categories: ['A'], areas: [], sourceLabel: 'S', withheld: 0 }))
      .mockResolvedValueOnce(json({ ok: true, cards: [], withheld: 0, withheldUnverifiable: 0, exclusionsActive: false, sourceLabel: 'S' }))
      .mockResolvedValueOnce(json({ ok: false, message: 'excluded' }, 422));
    const api = client(f);
    await api.remove(H, 'r1');
    expect(call(f, 0)).toMatchObject({ url: `http://web.test/api/recipes/r1?householdId=${H}`, init: { method: 'DELETE' } });
    await expect(api.toggleFavourite(H, 'r1')).resolves.toBe(true);
    expect(call(f, 1).url).toBe('http://web.test/api/recipes/r1/favourite');
    await expect(api.rematch(H, 'r1')).resolves.toMatchObject({ ok: true });
    expect(call(f, 2).url).toBe('http://web.test/api/recipes/r1/rematch');
    await expect(api.checkDuplicates(H, 'T', ['a'], 'r1')).resolves.toEqual([{ id: 'x', title: 'X' }]);
    expect(JSON.parse(call(f, 3).init.body as string)).toEqual({ householdId: H, title: 'T', names: ['a'], excludeId: 'r1' });
    await expect(api.searchCatalogue(H, 'oni')).resolves.toEqual([{ id: 'i', name: 'Onion' }]);
    expect(call(f, 4).url).toBe(`http://web.test/api/catalogue/search?householdId=${H}&q=oni`);
    await expect(api.matchNames(H, ['onion'])).resolves.toHaveLength(1);
    expect(call(f, 5).url).toBe('http://web.test/api/catalogue/match');
    await expect(api.discoverFilters(H)).resolves.toMatchObject({ categories: ['A'] });
    await expect(api.discoverSearch(H, { q: 'soup' })).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(call(f, 7).init.body as string)).toEqual({ householdId: H, q: 'soup' });
    await expect(api.discoverDraft(H, '123')).resolves.toEqual({ ok: false, message: 'excluded' });
  });

  it('surfaces the server message, retryability and status as an ApiError', async () => {
    const f = jest.fn().mockResolvedValue(json({ error: { code: 'READ_ONLY', message: 'This household is read-only.', retryable: false } }, 403));
    const err = await client(f).remove(H, 'r1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'This household is read-only.', status: 403, retryable: false, code: 'READ_ONLY' });
  });

  it('turns a network failure into a retryable error and reports a missing base URL', async () => {
    await expect(client(jest.fn().mockRejectedValue(new Error('offline'))).list(H, EMPTY_QUERY)).rejects.toMatchObject({ retryable: true, status: 0 });
    const noBase = createRecipesApi({ baseUrl: '', getToken: async () => 'tok' });
    await expect(noBase.list(H, EMPTY_QUERY)).rejects.toThrow(/EXPO_PUBLIC_API_BASE_URL/);
    await expect(noBase.imageSource('x/y')).resolves.toBeNull();
    expect(noBase.webUrl('/plan')).toBeNull();
  });

  it('builds image sources: storage paths via /api/images with the bearer token, external URLs untouched', async () => {
    const api = client(jest.fn());
    const path = `${H}/cover/22222222-2222-4222-8222-222222222222/cover.jpg`;
    expect(isStoragePath(path)).toBe(true);
    expect(isStoragePath('https://x/y.jpg')).toBe(false);
    await expect(api.imageSource(path)).resolves.toEqual({ uri: `http://web.test/api/images/${path}`, headers: { Authorization: 'Bearer tok' } });
    await expect(api.imageSource('https://cdn.test/a.jpg')).resolves.toEqual({ uri: 'https://cdn.test/a.jpg', headers: {} });
    await expect(api.imageSource(null)).resolves.toBeNull();
    expect(api.webUrl('/plan?add=1')).toBe('http://web.test/plan?add=1');
  });
});
