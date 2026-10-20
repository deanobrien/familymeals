import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';
import type { ReviewModel, ReceiptListEntry } from '../../../lib/receipts/types';

// Auth layer is covered in lib/server/auth/request-auth.test.ts; here it is the routes' contract that matters.
let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

// Receipt photos are only kept with Supabase Storage; a fake store lets the photo path be exercised in mock mode.
let storeBackend: 'local' | 'supabase' = 'supabase';
const blobs = new Map<string, Uint8Array>();
vi.mock('../../../lib/server/images', () => ({
  imageStoreFor: (auth: { dataContext: unknown }) => {
    void auth;
    return {
      get backend() {
        return storeBackend;
      },
      put: async (kind: string, id: string, file: string, data: Uint8Array) => {
        const path = `${currentHousehold}/${kind}/${id}/${file}`;
        blobs.set(path, data);
        return path;
      },
      get: async (kind: string, id: string, file: string) => blobs.get(`${currentHousehold}/${kind}/${id}/${file}`),
      signedUrl: async () => undefined,
      finishUpload: async () => {},
      sweep: async () => {},
    };
  },
}));

const { GET: list, POST: upload } = await import('./route');
const { GET: getOne } = await import('./[id]/route');
const { POST: confirm } = await import('./[id]/confirm/route');
const { GET: photo } = await import('./[id]/photo/route');

const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);
const H = 'aa000000-0000-4000-8000-0000000000aa';
const OTHER = 'bb000000-0000-4000-8000-0000000000bb';
let currentHousehold = H;
const who = (householdId = H, readOnly = false): AuthOutcome => {
  currentHousehold = householdId;
  return { ok: true, auth: { userId: 'user-1', householdId, readOnly, dataContext: null } };
};

const authz = { authorization: 'Bearer good' };
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const uploadReq = (hh: string | undefined = H, file: File | null = new File([PNG], 'r.png', { type: 'image/png' })) => {
  const form = new FormData();
  if (file) form.append('receipt', file);
  if (hh) form.append('householdId', hh);
  return new Request('http://t/api/receipts', { method: 'POST', body: form, headers: authz });
};
const getReq = (path: string, hh = H) => new Request(`http://t/api/receipts${path}?householdId=${hh}`, { headers: authz });
const confirmReq = (decisions: unknown, hh: string | undefined = H) =>
  new Request('http://t/api/receipts/x/confirm', { method: 'POST', body: JSON.stringify({ householdId: hh, decisions }), headers: { ...authz, 'content-type': 'application/json' } });

async function uploadOne(): Promise<string> {
  const res = await upload(uploadReq());
  expect(res.status).toBe(200);
  return ((await res.json()) as { receiptId: string }).receiptId;
}
async function review(id: string) {
  const res = await getOne(getReq(`/${id}`), ctxFor(id));
  expect(res.status).toBe(200);
  return (await res.json()) as { review: ReviewModel; reconciliation?: { decisions: unknown[] }; hasPhoto: boolean; photoPath?: string };
}

beforeEach(() => {
  seen.length = 0;
  storeBackend = 'supabase';
  blobs.clear();
  outcome = who();
});

describe('auth and read-only handling', () => {
  it('401 when unauthenticated, 403 for a non-member, on every route', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await list(getReq(''))).status).toBe(401);
    expect((await upload(uploadReq())).status).toBe(401);
    expect((await getOne(getReq('/x'), ctxFor('x'))).status).toBe(401);
    expect((await confirm(confirmReq([]), ctxFor('x'))).status).toBe(401);
    expect((await photo(getReq('/x/photo'), ctxFor('x'))).status).toBe(401);
    outcome = { ok: false, status: 403, message: 'not a member' };
    const res = await list(getReq(''));
    expect(res.status).toBe(403);
    expect(seen.at(-1)).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('refuses writes (upload, confirm) for a read-only household but still lets it read', async () => {
    outcome = who(H, true);
    const up = await upload(uploadReq());
    expect(up.status).toBe(403);
    expect((await up.json()).error.code).toBe('READ_ONLY');
    expect((await confirm(confirmReq([]), ctxFor('x'))).status).toBe(403);
    expect((await list(getReq(''))).status).toBe(200);
  });
});

describe('upload -> list -> review -> confirm round trip (mock AI)', () => {
  it('uploads a photo, lists it, and builds a review where nothing is confirmed', async () => {
    const id = await uploadOne();
    const entries = ((await (await list(getReq(''))).json()) as { receipts: ReceiptListEntry[] }).receipts;
    const mine = entries.find((e) => e.id === id);
    expect(mine?.status).toBe('needs_review');
    expect(mine!.lineCount).toBeGreaterThan(0);

    const r1 = await review(id);
    expect(r1.review.status).toBe('needs_review');
    expect(r1.review.lines.length).toBeGreaterThan(0);
    expect(r1.hasPhoto).toBe(true);
    expect(r1.photoPath).toBe(`/api/receipts/${id}/photo`);
    // Matching is only a suggestion: only confident lines carry a pre-selection, and nothing is reconciled by loading.
    for (const l of r1.review.lines) if (l.classification !== 'confident') expect(l.preselectedItemId).toBeUndefined();
    const r2 = await review(id);
    expect(r2.review.items).toEqual(r1.review.items);
    expect(r2.review.status).toBe('needs_review');
  });

  it('confirms only the explicit decisions, extras go to the pantry, and a second confirm is refused (409)', async () => {
    const id = await uploadOne();
    const { review: rv } = await review(id);
    const [a, b] = rv.lines;
    const first = a!.preselectedItemId
      ? { lineId: a!.lineId, outcome: 'purchase' as const, shoppingListItemId: a!.preselectedItemId, quantityValue: a!.defaultQuantity.value }
      : { lineId: a!.lineId, outcome: 'extra' as const, addToPantry: false };
    const decisions = [first, { lineId: b!.lineId, outcome: 'extra' as const, addToPantry: true }];
    const res = await confirm(confirmReq(decisions), ctxFor(id));
    expect(res.status).toBe(200);
    const sum = (await res.json()) as { ok: true; purchases: number; extras: number; pantryAdds: number; leftOutstanding: number };
    expect(sum.pantryAdds).toBe(1);
    expect(sum.purchases + sum.extras).toBe(2);
    expect(sum.purchases).toBe(first.outcome === 'purchase' ? 1 : 0);

    const done = await review(id);
    expect(done.review.status).toBe('reconciled');
    expect(done.reconciliation?.decisions).toHaveLength(2); // the undecided lines are NOT recorded

    const again = await confirm(confirmReq(decisions), ctxFor(id));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('ALREADY_RECONCILED');
  });

  it('rejects malformed decisions (400) and unknown lines or items (422)', async () => {
    const id = await uploadOne();
    expect((await confirm(confirmReq('nope'), ctxFor(id))).status).toBe(400);
    expect((await confirm(confirmReq([{ lineId: 1, outcome: 'purchase' }]), ctxFor(id))).status).toBe(400);
    expect((await confirm(confirmReq([{ lineId: 'x', outcome: 'maybe' }]), ctxFor(id))).status).toBe(400);
    expect((await confirm(confirmReq([{ lineId: 'not-a-line', outcome: 'extra' }]), ctxFor(id))).status).toBe(422);
    const { review: rv } = await review(id);
    const bad = await confirm(confirmReq([{ lineId: rv.lines[0]!.lineId, outcome: 'purchase', shoppingListItemId: 'gone' }]), ctxFor(id));
    expect(bad.status).toBe(422);
    expect((await review(id)).review.status).toBe('needs_review');
  });

  it('rejects a bad upload: no file (400) and an unreadable image (422)', async () => {
    expect((await upload(uploadReq(H, null))).status).toBe(400);
    const res = await upload(uploadReq(H, new File([new Uint8Array([1, 2, 3, 4])], 'r.png', { type: 'image/png' })));
    expect([400, 422]).toContain(res.status);
  });
});

describe('not found and household isolation', () => {
  it('unknown and malformed ids are 404 on every id route', async () => {
    const unknown = '00000000-0000-4000-8000-000000000999';
    expect((await getOne(getReq(`/${unknown}`), ctxFor(unknown))).status).toBe(404);
    expect((await getOne(getReq('/..%2Fx'), ctxFor('../x'))).status).toBe(404);
    expect((await confirm(confirmReq([]), ctxFor(unknown))).status).toBe(404);
    expect((await photo(getReq(`/${unknown}/photo`), ctxFor(unknown))).status).toBe(404);
  });

  it("another household's receipt is not readable, confirmable or viewable", async () => {
    const id = await uploadOne();
    outcome = who(OTHER);
    expect((await getOne(getReq(`/${id}`, OTHER), ctxFor(id))).status).toBe(404);
    expect((await confirm(confirmReq([], OTHER), ctxFor(id))).status).toBe(404);
    expect((await photo(getReq(`/${id}/photo`, OTHER), ctxFor(id))).status).toBe(404);
    const entries = ((await (await list(getReq('', OTHER))).json()) as { receipts: ReceiptListEntry[] }).receipts;
    expect(entries.find((e) => e.id === id)).toBeUndefined();
  });
});

describe('receipt photo', () => {
  it('serves the kept photo bytes with the stored content type to the owner', async () => {
    const id = await uploadOne();
    const res = await photo(getReq(`/${id}/photo`), ctxFor(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('is 404 (and hasPhoto false) when no photo was kept', async () => {
    storeBackend = 'local';
    const id = await uploadOne();
    expect((await review(id)).hasPhoto).toBe(false);
    expect((await photo(getReq(`/${id}/photo`), ctxFor(id))).status).toBe(404);
  });
});
