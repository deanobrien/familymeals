// P3-A (D420-D429) Android libs: share-link parsing, the sharing and kids clients, defensive parsers, the device PIN gate.
import { createKidsClient, parseKidsData } from '@/lib/kidsApi';
import { createKidsGate } from '@/lib/kidsDevice';
import { safeAppPath } from '@/lib/pendingNext';
import { buildShareUrl, createSharingClient, parsePreview, parseShares, parseShareUrl } from '@/lib/sharingApi';
import type { ServerApi } from '@/lib/serverApi';

const T = 'ab'.repeat(32);

function fakeApi(routes: Record<string, (p: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; path: string; payload: Record<string, unknown> }> = [];
  const dispatch = (method: string, path: string, payload: Record<string, unknown>) => {
    calls.push({ method, path, payload });
    const h = routes[`${method} ${path}`];
    if (!h) throw new Error(`unexpected ${method} ${path}`);
    return h(payload);
  };
  const api: ServerApi = {
    configured: true,
    get: async (path, q) => dispatch('GET', path, (q ?? {}) as Record<string, unknown>) as never,
    post: async (path, b) => dispatch('POST', path, b as Record<string, unknown>) as never,
    postForm: async () => { throw new Error('unused'); },
    webUrl: (p) => `https://web.test${p}`,
    authHeaders: async () => ({}),
  };
  return { api, calls };
}

describe('share links', () => {
  it('parses the app scheme, the https App Link and the Expo Go form, and rejects the rest', () => {
    expect(parseShareUrl(`familyrecipes://s/${T}`)).toBe(T);
    expect(parseShareUrl(`https://web.test/s/${T}`)).toBe(T);
    expect(parseShareUrl(`https://web.test/s/${T}?utm=x#y`)).toBe(T);
    expect(parseShareUrl(`exp://192.168.1.2:8081/--/s/${T}`)).toBe(T);
    expect(parseShareUrl(`https://web.test/s/${T.toUpperCase()}`)).toBe(T);
    for (const bad of [null, '', `https://web.test/s/${T.slice(1)}`, `https://web.test/settings/${T}`, `https://web.test/invite/${T}`, 'familyrecipes://s/nope', `https://web.test/s/${T}/extra`]) {
      expect(parseShareUrl(bad)).toBeNull();
    }
    expect(buildShareUrl('https://web.test/', T)).toBe(`https://web.test/s/${T}`);
  });

  it('a share link survives sign-in (pending next), but only a well-formed one', () => {
    expect(safeAppPath(`/s/${T}`)).toBe(`/s/${T}`);
    expect(safeAppPath(`/invite/${T}`)).toBe(`/invite/${T}`);
    expect(safeAppPath('/s/../../admin')).toBeNull();
    expect(safeAppPath(`/s/${T}/x`)).toBeNull();
  });

  it('parses previews defensively: unknown shapes are "invalid", private-looking extras are dropped', () => {
    expect(parsePreview(null)).toEqual({ kind: 'invalid' });
    expect(parsePreview({ kind: 'what' })).toEqual({ kind: 'invalid' });
    expect(parsePreview({ kind: 'minimal', scope: 'collection', title: 'Weeknights', sharedBy: 'Alice', recipeCount: 3 })).toEqual({ kind: 'minimal', scope: 'collection', title: 'Weeknights', sharedBy: 'Alice', recipeCount: 3 });
    const full = parsePreview({
      kind: 'full', scope: 'recipe', title: null, attribution: "Shared by Alice's household", expiresAt: null, signedIn: true, own: false,
      recipes: [{ id: 'r1', title: 'Chilli', description: 'Warm', servings: 4, ingredients: [{ text: '400 g mince', optional: false }, { nope: 1 }], steps: ['Brown it.', 5], imagePath: '/api/shares/x/image/r1', favourite: true, rating: 5, householdId: 'h' }, { id: 5 }],
    });
    if (full.kind !== 'full') throw new Error('expected full');
    expect(full.recipes).toHaveLength(1);
    expect(full.recipes[0]).toMatchObject({ title: 'Chilli', ingredients: [{ text: '400 g mince', optional: false }], steps: ['Brown it.'], imagePath: '/api/shares/x/image/r1' });
    expect(JSON.stringify(full)).not.toMatch(/favourite|rating|householdId/);
    // an image path outside the share route is never followed
    const odd = parsePreview({ kind: 'full', scope: 'recipe', recipes: [{ id: 'r1', title: 'A', imagePath: 'https://evil.test/x.png' }] });
    expect(odd.kind === 'full' && odd.recipes[0]!.imagePath).toBeNull();
  });

  it('the client sends the household, returns the token once, and keeps tokens out of lists', async () => {
    const { api, calls } = fakeApi({
      'GET /api/shares': () => ({ shares: [{ id: 's1', scope: 'recipe', title: null, recipes: [{ id: 'r1', title: 'Chilli' }], createdAt: '2026-10-21T10:00:00Z', expiresAt: null, status: 'active', publicPreview: false, openedBy: 2, saved: 1 }, { nope: true }] }),
      'POST /api/shares': (p) => (p.action === 'create' ? { share: { id: 's1', token: T, path: `/s/${T}`, expiresAt: null } } : {}),
      'POST /api/shares/preview': () => ({ preview: { kind: 'invalid' }, signedIn: false }),
      'POST /api/shares/save': () => ({ recipeId: 'new1', title: 'Chilli', imageCopied: true }),
    });
    const c = createSharingClient(api, 'hh-1');
    expect(await c.list()).toMatchObject([{ id: 's1', openedBy: 2, saved: 1, status: 'active' }]);
    expect(parseShares({ shares: 'x' })).toEqual([]);
    expect(await c.create({ scope: 'recipe', recipeIds: ['r1'], expiresInDays: 30, publicPreview: false })).toEqual({ id: 's1', token: T, expiresAt: null });
    await c.revoke('s1');
    expect(await c.preview(T)).toEqual({ preview: { kind: 'invalid' }, signedIn: false });
    expect(await c.save(T, 'r1')).toEqual({ recipeId: 'new1', title: 'Chilli', imageCopied: true });
    expect(calls.every((x) => x.method === 'GET' ? x.payload.householdId === 'hh-1' : x.payload.householdId === 'hh-1')).toBe(true);
    // signed out / no household yet: the preview call carries none
    const anon = fakeApi({ 'POST /api/shares/preview': () => ({ preview: { kind: 'minimal', scope: 'recipe', title: 'X', sharedBy: null, recipeCount: 1 }, signedIn: false }) });
    await createSharingClient(anon.api, null).preview(T);
    expect(anon.calls[0]!.payload).toEqual({ token: T });
  });

  it('refuses a create answer without a well-formed link', async () => {
    const { api } = fakeApi({ 'POST /api/shares': () => ({ share: { id: 's1', token: 'short' } }) });
    await expect(createSharingClient(api, 'hh').create({ scope: 'recipe', recipeIds: ['r1'], expiresInDays: null, publicPreview: false })).rejects.toThrow();
  });
});

describe('kids client', () => {
  const sample = {
    kids: { me: 'u1', kids: [{ id: 'k1', displayName: 'Mia', avatar: '🦊', colour: 'blue' }, { nope: 1 }],
      rounds: [{ id: 'rd1', title: 'Tonight', forDate: '2026-10-21', days: 1, open: true, closesAt: null,
        candidates: [{ recipeId: 'r1', title: 'Pizza', imagePath: null, up: 1, heart: 1, score: 3, winner: false }],
        votes: [{ recipeId: 'r1', voter: { kind: 'kid', id: 'k1' }, value: 'heart' }, { recipeId: 'r1', voter: { kind: 'kid', id: 'k1' }, value: 'meh' }] }] },
    seeds: { planned: [{ recipeId: 'r1', title: 'Pizza' }], recipes: [{ recipeId: 'r1', title: 'Pizza' }, { recipeId: 'r2', title: 'Tacos' }] },
  };

  it('parses defensively and sends the household with every call', async () => {
    const d = parseKidsData(sample);
    expect(d.kids).toEqual([{ id: 'k1', displayName: 'Mia', avatar: '🦊', colour: 'blue' }]);
    expect(d.rounds[0]!.votes).toHaveLength(1); // the invalid vote value is dropped
    expect(d.recipes).toHaveLength(2);
    expect(parseKidsData(null)).toEqual({ kids: [], rounds: [], me: '', planned: [], recipes: [] });

    const { api, calls } = fakeApi({
      'GET /api/kids': () => sample,
      'POST /api/kids': (p) => (p.action === 'openRound' ? { roundId: 'rd2' } : p.action === 'addKid' ? { kid: { id: 'k2', displayName: 'Zed', avatar: '🐼', colour: 'red' } } : {}),
    });
    const c = createKidsClient(api, 'hh-1');
    expect((await c.load('2026-10-19')).kids).toHaveLength(1);
    expect(await c.addKid({ displayName: 'Zed', avatar: '🐼', colour: 'red' })).toMatchObject({ id: 'k2' });
    expect(await c.openRound({ recipeIds: ['a', 'b', 'c'] })).toBe('rd2');
    await c.vote({ roundId: 'rd2', recipeId: 'a', kidId: 'k2', value: 'up' });
    await c.closeRound('rd2');
    await c.removeKid('k2');
    expect(calls.map((x) => x.payload.action ?? 'load')).toEqual(['load', 'addKid', 'openRound', 'vote', 'closeRound', 'removeKid']);
    expect(calls.every((x) => x.payload.householdId === 'hh-1')).toBe(true);
  });
});

describe('device PIN gate on Android storage', () => {
  it('keeps the PIN record in device storage as a hash only, and survives a new gate instance', async () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    const gate = createKidsGate('hh-1', 'u1', store);
    expect(await gate.hasPin()).toBe(false);
    expect(await gate.setPin('2468')).toBe(true);
    const stored = JSON.stringify([...data.entries()]);
    expect(stored).not.toContain('2468');
    expect(stored).toMatch(/[0-9a-f]{64}/);
    const again = createKidsGate('hh-1', 'u1', store);
    expect(await again.hasPin()).toBe(true);
    expect((await again.verify('2468')).ok).toBe(true);
    expect((await again.verify('1111')).ok).toBe(false);
    expect(await createKidsGate('hh-2', 'u1', store).hasPin()).toBe(false);
  });

  it('the real device store (secure storage) round-trips a PIN', async () => {
    const gate = createKidsGate('hh-device', 'u-device');
    expect(await gate.hasPin()).toBe(false);
    expect(await gate.setPin('1357')).toBe(true);
    expect(await createKidsGate('hh-device', 'u-device').hasPin()).toBe(true);
    expect((await createKidsGate('hh-device', 'u-device').verify('1357')).ok).toBe(true);
    await gate.clear();
    expect(await gate.hasPin()).toBe(false);
  });
});
