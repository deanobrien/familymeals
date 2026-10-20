import { describe, expect, it } from 'vitest';
import { archivePathFor, isSafeObjectPath, parseObjectRef } from '../objects/port';
import { EXPORT_LINK_TTL_MS, EXPORT_RATE_WINDOW_MS, MAX_DOWNLOADS, memoryExportAudit, resetMemoryExportAudit } from './audit';

const H = '11111111-1111-4111-8111-111111111111';

describe('memory export audit (demo/e2e)', () => {
  it('rate limits per user, household and scope; failures free the limit; links expire', async () => {
    resetMemoryExportAudit();
    let t = Date.parse('2026-10-20T10:00:00Z');
    const a = memoryExportAudit('alice', { isOwner: () => true, now: () => t });
    const first = await a.begin(H, 'household');
    expect(first.ok).toBe(true);
    const again = await a.begin(H, 'household');
    expect(again).toMatchObject({ ok: false, reason: 'rate_limited', retryAfter: new Date(t + EXPORT_RATE_WINDOW_MS).toISOString() });
    expect((await a.begin(H, 'member')).ok).toBe(true); // other scope has its own allowance
    if (!first.ok) throw new Error('unreachable');
    const id = first.ticket.id;
    expect(await a.open(id)).toMatchObject({ householdId: H, scope: 'household' });

    const bob = memoryExportAudit('bob', { isOwner: () => true, now: () => t });
    expect(await bob.open(id)).toBeNull(); // someone else's export

    await a.record(id, { ok: false });
    expect(await a.open(id)).toBeNull();
    expect((await a.begin(H, 'household')).ok).toBe(true);

    const latest = await a.begin(H, 'member');
    expect(latest.ok).toBe(false);
    t += EXPORT_LINK_TTL_MS + 1;
    const m = memoryExportAudit('carol', { isOwner: () => false, now: () => t });
    expect(await m.begin(H, 'household')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('caps downloads per export', async () => {
    resetMemoryExportAudit();
    const a = memoryExportAudit('alice', { isOwner: () => true });
    const r = await a.begin(H, 'member');
    if (!r.ok) throw new Error('unexpected');
    for (let i = 0; i < MAX_DOWNLOADS; i++) {
      expect(await a.open(r.ticket.id)).not.toBeNull();
      await a.record(r.ticket.id, { ok: true });
    }
    expect(await a.open(r.ticket.id)).toBeNull();
  });
});

describe('object refs', () => {
  it('parses storage paths inside the household, local uploads, and rejects the rest', () => {
    expect(parseObjectRef(`${H}/recipes/r1/1.jpg`, H, 'recipe-images')).toEqual({ kind: 'storage', bucket: 'recipe-images', path: `${H}/recipes/r1/1.jpg` });
    expect(parseObjectRef('/api/uploads/33333333-3333-4333-8333-333333333333/page-2.jpg', H, 'recipe-images')).toEqual({
      kind: 'local',
      uploadId: '33333333-3333-4333-8333-333333333333',
      file: 'page-2.jpg',
    });
    for (const bad of [`${H}/../x.jpg`, `other/${H}/x.jpg`, 'https://example.com/a.jpg', '/api/uploads/not-a-uuid/cover.jpg', `${H}/a//b`, '', null]) {
      expect(parseObjectRef(bad, H, 'recipe-images')).toBeNull();
    }
    expect(isSafeObjectPath(`${H}/recipes/x y.jpg`, H)).toBe(false);
  });

  it('maps refs to archive paths without the household prefix', () => {
    expect(archivePathFor({ kind: 'storage', bucket: 'receipt-images', path: `${H}/receipts/r/1.jpg` }, H)).toBe('images/receipt-images/receipts/r/1.jpg');
    expect(archivePathFor({ kind: 'local', uploadId: 'u', file: 'cover.jpg' }, H)).toBe('images/uploads/u/cover.jpg');
  });
});
