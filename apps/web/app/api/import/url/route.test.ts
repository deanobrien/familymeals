import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';
import { acceptsBearer } from '../../../../lib/server/auth/routes';
import { resetUrlImportLimits } from '../../../../lib/server/import/url/rate-limit';
import { FIXTURE_HOST } from '../../../../lib/server/import/url/fixtures';

let outcome: AuthOutcome;
vi.mock('../../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));
process.env.URL_IMPORT_SOURCE = 'mock'; // offline fixture pages: the SSRF guard, redirects and limits still run

const { POST } = await import('./route');
const { POST: SAVE } = await import('../../extract/save/route');
const H = 'a1000000-0000-4000-8000-0000000000a9';

beforeEach(() => {
  resetUrlImportLimits();
  outcome = { ok: true, auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

const post = (body: unknown) => POST(new Request('http://t/api/import/url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const err = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('POST /api/import/url', () => {
  it('is a bearer route (the Android app calls it with a token)', () => {
    expect(acceptsBearer('/api/import/url', 'Bearer abc')).toBe(true);
    expect(acceptsBearer('/api/import/url', null)).toBe(false);
  });

  it('needs a signed-in caller and refuses read-only households', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await post({ url: `https://${FIXTURE_HOST}/dahl` })).status).toBe(401);
    outcome = { ok: true, auth: { userId: 'u1', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    expect((await post({ url: `https://${FIXTURE_HOST}/dahl` })).status).toBe(403);
  });

  it('reads structured data into the same draft shape a photo import returns, then saves it with the source link', async () => {
    const res = await post({ url: `https://${FIXTURE_HOST}/dahl` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadId: string; draft: { title: { value: string }; source?: string; sourceReference?: string; ingredients: unknown[] }; via: string; sourceUrl: string; existing: unknown[] };
    expect(body.via).toBe('structured');
    expect(body.draft.title.value).toBe('Fixture Lentil Dahl');
    expect(body.draft.ingredients).toHaveLength(6);
    expect(body.draft.sourceReference).toBe(`https://${FIXTURE_HOST}/dahl`);
    expect(body.sourceUrl).toBe(`https://${FIXTURE_HOST}/dahl`);
    expect(Array.isArray(body.existing)).toBe(true);
    const saved = await SAVE(new Request('http://t/api/extract/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId: body.uploadId, draft: body.draft }) }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ id: expect.any(String) });
  });

  it('falls back to the AI text reading only when the page has no recipe data', async () => {
    const res = await post({ url: `https://${FIXTURE_HOST}/plain` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { via: string }).via).toBe('ai');
  });

  it('refuses private addresses, non-web schemes and bad bodies with clear errors', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/', 'file:///etc/passwd', 'http://localhost/']) {
      const res = await post({ url });
      expect(res.status, url).toBe(400);
      expect(['BAD_URL', 'BLOCKED_ADDRESS', 'BLOCKED_HOST']).toContain((await err(res)).code);
    }
    expect((await post({})).status).toBe(400);
    expect((await post({ url: 42 })).status).toBe(400);
  });

  it('refuses a redirect to an internal address and maps site errors to readable messages', async () => {
    const r = await post({ url: `https://${FIXTURE_HOST}/to-internal` });
    expect(r.status).toBe(400);
    expect((await err(r)).code).toBe('BLOCKED_ADDRESS');
    const refused = await post({ url: `https://${FIXTURE_HOST}/refused` });
    expect(refused.status).toBe(422);
    expect((await err(refused)).code).toBe('SITE_REFUSED');
    const missing = await post({ url: `https://${FIXTURE_HOST}/missing` });
    expect((await err(missing)).code).toBe('PAGE_NOT_FOUND');
  });

  it('only the offline fixture host is reachable in mock mode (no real network)', async () => {
    const res = await post({ url: 'https://example.com/recipe' });
    expect(res.status).toBe(502);
    expect((await err(res)).code).toBe('SITE_UNREACHABLE');
  });
});
