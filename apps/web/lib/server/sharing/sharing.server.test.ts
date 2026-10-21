// P3-A (D420-D424) through the real service on the in-memory backend: what a share exposes, who can read it, link lifecycle,
// copy semantics (nothing private travels, the photo is copied into the recipient's own storage) and the rate limits.
import { beforeEach, describe, expect, it } from 'vitest';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { SHARE_TOKEN_RE } from '../../sharing/types';
import { LocalImageStore } from '../images/local-store';
import { resetShareLimits } from './rate-limit';
import { copyInputFor, createShare, listShares, previewShare, revokeShare, saveShareCopy, shareImageUrl, type ShareCaller, type ShareViewerCtx } from './service';
import { memoryShareForTest, resetMemoryShares, type SharedRecipeDoc } from './store';

const HA = 'aaaaaaaa-0000-4000-8000-00000000000a';
const HB = 'bbbbbbbb-0000-4000-8000-00000000000b';
const alice: ShareCaller = { householdId: HA, userId: 'user-alice', displayName: 'Alice', client: null, readOnly: false };
const bob: ShareCaller = { householdId: HB, userId: 'user-bob', displayName: 'Bob', client: null, readOnly: false };
const viewerOf = (c: ShareCaller): ShareViewerCtx => ({ userId: c.userId, householdId: c.householdId, client: null });
const anon: ShareViewerCtx = { userId: null, householdId: null, client: null };

async function firstRecipeId(h: string): Promise<string> {
  const page = await getRecipeRepositoryFor(h).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 50 });
  return page.items[0]!.id;
}

async function make(over: Record<string, unknown> = {}) {
  const recipeId = await firstRecipeId(HA);
  const r = await createShare(alice, { scope: 'recipe', recipeIds: [recipeId], expiresInDays: 7, publicPreview: false, ...over });
  if (!r.ok) throw new Error(`create failed: ${r.message}`);
  return { recipeId, token: r.share.token, shareId: r.share.id };
}

beforeEach(() => {
  resetMemoryShares();
  resetShareLimits();
});

describe('creating a link', () => {
  it('returns an unguessable token once and lists the link without it', async () => {
    const { token } = await make();
    expect(token).toMatch(SHARE_TOKEN_RE);
    const l = await listShares(alice);
    if (!l.ok) throw new Error('list failed');
    expect(l.shares).toHaveLength(1);
    expect(JSON.stringify(l.shares)).not.toContain(token);
    expect(l.shares[0]).toMatchObject({ scope: 'recipe', status: 'active', openedBy: 0, saved: 0, createdByMe: true });
  });

  it('refuses a recipe of another household, a bad selection and a read-only household', async () => {
    const own = await firstRecipeId(HA);
    const bobsRecipe = await getRecipeRepositoryFor(HB).create({ ...copyInputFor(demoDoc(), null), title: 'Bob only' });
    expect((await createShare(alice, { scope: 'recipe', recipeIds: [bobsRecipe.id], expiresInDays: 7 })).ok).toBe(false);
    expect((await createShare(alice, { scope: 'recipe', recipeIds: [], expiresInDays: 7 })).ok).toBe(false);
    expect((await createShare(alice, { scope: 'recipe', recipeIds: [own, bobsRecipe.id], expiresInDays: 7 })).ok).toBe(false);
    expect((await createShare(alice, { scope: 'recipe', recipeIds: [own], expiresInDays: 4000 })).ok).toBe(false);
    expect(await createShare({ ...alice, readOnly: true }, { scope: 'recipe', recipeIds: [own] })).toMatchObject({ ok: false, error: 'read_only' });
  });

  it('shares a named collection by resolving it on the server', async () => {
    const r = await createShare(alice, { scope: 'collection', collection: 'favourites', expiresInDays: null });
    if (!r.ok) throw new Error(r.message);
    const l = await listShares(alice);
    if (!l.ok) throw new Error('list');
    expect(l.shares[0]).toMatchObject({ scope: 'collection', title: 'Our favourites', expiresAt: null });
    expect(l.shares[0]!.recipes.length).toBeGreaterThan(0);
  });
});

describe('what a viewer sees', () => {
  it('a signed-in person from another household reads the chosen recipe, attributed, with no private data', async () => {
    const { recipeId, token } = await make();
    // Alice has private data on this recipe: a favourite and a rating
    const own = await getRecipeRepositoryFor(HA).get(recipeId);
    expect(own).not.toBeNull();
    const r = await previewShare(viewerOf(bob), token);
    if (!r.ok || r.preview.kind !== 'full') throw new Error('expected a full preview');
    expect(r.preview.attribution).toBe("Shared by Alice's household");
    expect(r.preview.recipes).toHaveLength(1);
    const recipe = r.preview.recipes[0]!;
    expect(recipe.title).toBe(own!.title);
    expect(recipe.ingredients.length).toBeGreaterThan(0);
    const text = JSON.stringify(r.preview);
    for (const forbidden of ['favourite', 'rating', 'cooked', 'originalText', 'cost', 'nutrition', HA, 'user-alice']) expect(text).not.toContain(forbidden);
    expect(recipe.imagePath === null || recipe.imagePath.startsWith(`/api/shares/${token}/image/`)).toBe(true);
  });

  it('signed out: minimal by default, the recipes (text only) only when the sharer allowed it', async () => {
    const closed = await make();
    const min = await previewShare(anon, closed.token);
    if (!min.ok) throw new Error('preview');
    expect(min.preview.kind).toBe('minimal');
    expect(JSON.stringify(min.preview)).not.toMatch(/ingredients|steps/);

    const open = await make({ publicPreview: true });
    const pub = await previewShare(anon, open.token);
    if (!pub.ok || pub.preview.kind !== 'full') throw new Error('expected full');
    expect(pub.preview.signedIn).toBe(false);
    expect(pub.preview.recipes.every((x) => x.imagePath === null)).toBe(true); // Storage is private: no photos without a sign-in
  });

  it('unknown, malformed, revoked and expired links all give the same answer', async () => {
    const { token, shareId } = await make();
    const invalid = { ok: true, preview: { kind: 'invalid' } };
    expect(await previewShare(viewerOf(bob), '0'.repeat(64))).toEqual(invalid);
    expect(await previewShare(viewerOf(bob), 'not-a-token')).toEqual(invalid);
    expect(await previewShare(viewerOf(bob), undefined)).toEqual(invalid);

    const expired = await make();
    memoryShareForTest(expired.token)!.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await previewShare(viewerOf(bob), expired.token)).toEqual(invalid);

    expect((await previewShare(viewerOf(bob), token)).ok).toBe(true);
    expect((await revokeShare(alice, shareId)).ok).toBe(true);
    expect(await previewShare(viewerOf(bob), token)).toEqual(invalid);
    expect(await previewShare(anon, token)).toEqual(invalid);
  });

  it('the sharer\'s own household is told it already owns the recipe, and only counts (never names) are listed', async () => {
    const { token } = await make();
    const own = await previewShare(viewerOf(alice), token);
    if (!own.ok || own.preview.kind !== 'full') throw new Error('expected full');
    expect(own.preview.own).toBe(true);
    await previewShare(viewerOf(bob), token);
    await previewShare({ userId: 'user-carol', householdId: 'cccccccc-0000-4000-8000-00000000000c', client: null }, token);
    const l = await listShares(alice);
    if (!l.ok) throw new Error('list');
    expect(l.shares[0]!.openedBy).toBe(2);
    expect(JSON.stringify(l.shares)).not.toMatch(/bob|carol/i);
  });

  it('only a household member can revoke its own share', async () => {
    const { shareId } = await make();
    expect(await revokeShare(bob, shareId)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await revokeShare(alice, 'nope')).toMatchObject({ ok: false, error: 'not_found' });
    expect((await revokeShare(alice, shareId)).ok).toBe(true);
    const l = await listShares(alice);
    if (!l.ok) throw new Error('list');
    expect(l.shares[0]!.status).toBe('revoked');
  });
});

describe('saving a copy', () => {
  it('creates the recipient\'s own recipe, credits the sharer and carries nothing private', async () => {
    const { recipeId, token } = await make();
    const original = (await getRecipeRepositoryFor(HA).get(recipeId))!;
    const saved = await saveShareCopy(bob, token, recipeId);
    if (!saved.ok) throw new Error(saved.message);
    const copy = (await getRecipeRepositoryFor(HB).get(saved.recipeId))!;
    expect(copy.id).not.toBe(recipeId);
    expect(copy.title).toBe(original.title);
    expect(copy.ingredients.map((i) => i.name)).toEqual(original.ingredients.map((i) => i.name));
    expect(copy.steps.map((s) => s.text)).toEqual(original.steps.map((s) => s.text));
    expect(copy.sourceAttribution).toContain("Shared by Alice's household");
    expect(copy.favourite).toBe(false);
    expect(copy.rating).toBeNull();
    expect(copy.originalText).toBe('');
    expect(copy.cooked).toBeUndefined();
    // the original is untouched and Alice sees a count only
    expect((await getRecipeRepositoryFor(HA).get(recipeId))!.title).toBe(original.title);
    const l = await listShares(alice);
    if (l.ok) expect(l.shares[0]).toMatchObject({ openedBy: 1, saved: 1 });
  });

  it('is refused for the sharer\'s own household, an unknown recipe, a bad token and a revoked link', async () => {
    const { recipeId, token, shareId } = await make();
    expect(await saveShareCopy(alice, token, recipeId)).toMatchObject({ ok: false, error: 'own_share' });
    expect(await saveShareCopy(bob, token, '11111111-1111-4111-8111-111111111111')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await saveShareCopy(bob, 'zzz', recipeId)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await saveShareCopy({ ...bob, readOnly: true }, token, recipeId)).toMatchObject({ ok: false, error: 'read_only' });
    await revokeShare(alice, shareId);
    expect(await saveShareCopy(bob, token, recipeId)).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('copies a local photo into the recipient\'s own storage (a new object, same bytes) and an external photo by reference', async () => {
    const { recipeId, token } = await make();
    const coverId = '22222222-2222-4222-8222-222222222222';
    const real = new LocalImageStore();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const url = await real.put('cover', coverId, 'cover.jpg', bytes);
    await getRecipeRepositoryFor(HA).update(recipeId, { ...copyInputFor(demoDoc(), null), ...(await asInput(HA, recipeId)), imageUrl: url });

    const saved = await saveShareCopy(bob, token, recipeId);
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.imageCopied).toBe(true);
    const copy = (await getRecipeRepositoryFor(HB).get(saved.recipeId))!;
    expect(copy.imageUrl).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\/cover\.jpg$/);
    expect(copy.imageUrl).not.toBe(url);
    const newId = /uploads\/([0-9a-f-]{36})\//.exec(copy.imageUrl!)![1]!;
    expect(Array.from((await real.get('cover', newId, 'cover.jpg'))!)).toEqual([1, 2, 3, 4, 5]);

    // the image route: only a signed-in viewer of a live share
    expect(await shareImageUrl(viewerOf(bob), token, recipeId)).toBe(url);
    expect(await shareImageUrl(anon, token, recipeId)).toBeNull();
    expect(await shareImageUrl(viewerOf(bob), '0'.repeat(64), recipeId)).toBeNull();
    expect(await shareImageUrl(viewerOf(bob), token, '33333333-3333-4333-8333-333333333333')).toBeNull();
  });
});

describe('rate limits', () => {
  it('stops a viewer who keeps trying wrong links, with one generic message', async () => {
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const r = await previewShare(anon, String(i).padStart(64, '0'), { headers: { get: (n) => (n === 'x-forwarded-for' ? '203.0.113.9' : null) } });
      if (!r.ok && r.error === 'rate_limited') limited++;
    }
    expect(limited).toBeGreaterThan(0);
    // another address is not affected
    const other = await previewShare(anon, '0'.repeat(64), { headers: { get: (n) => (n === 'x-forwarded-for' ? '198.51.100.4' : null) } });
    expect(other.ok).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------------ helpers

function demoDoc(): SharedRecipeDoc {
  return {
    id: 'x', title: 'Demo', description: '', sourceUrl: '', sourceAttribution: '', prepMinutes: null, cookMinutes: null, servings: 2, cuisine: '', mealType: 'dinner', diet: 'vegetarian',
    tags: [], hasCover: false, steps: ['Stir.'],
    ingredients: [{ name: 'Rice', ingredientId: null, quantity: { kind: 'exact', value: 100, unit: 'g', originalText: '100 g' }, preparation: undefined, optional: false }],
  };
}

async function asInput(h: string, id: string) {
  const r = (await getRecipeRepositoryFor(h).get(id))!;
  return {
    title: r.title, description: r.description, sourceAttribution: r.sourceAttribution, sourceUrl: r.sourceUrl, originalText: r.originalText, prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes, servings: r.servings, cuisine: r.cuisine, mealType: r.mealType, diet: r.diet, tags: r.tags,
    ingredients: r.ingredients.map((i) => ({ name: i.name, ingredientId: i.ingredientId, quantity: i.quantity, preparation: i.preparation, optional: i.optional })), steps: r.steps.map((s) => s.text),
  };
}
