import { ExportError, createExportClient } from '@/lib/exportApi';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'cache' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
import { downloadAndShare, exportFileName, type ExportDeps } from '@/lib/exportDownload';

const H = '00000000-0000-4000-8000-000000000100';
const ID = '0b6d3f0e-1111-4222-8333-444455556666';

function client(res: { status: number; body?: unknown } | Error, token: string | null = 'tok') {
  const fetchImpl = jest.fn(async () => {
    if (res instanceof Error) throw res;
    return { status: res.status, json: async () => res.body ?? {} } as unknown as Response;
  });
  return { fetchImpl, c: createExportClient({ baseUrl: 'https://web.test/', getToken: async () => token, fetchImpl: fetchImpl as unknown as typeof fetch }) };
}

const err = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ExportError;
  }
  throw new Error('did not throw');
};

describe('export client (POST /api/export with a Bearer token)', () => {
  it('starts an export and returns an absolute download URL on our server', async () => {
    const { c, fetchImpl } = client({ status: 201, body: { id: ID, downloadUrl: `/api/export/${ID}`, expiresAt: '2026-10-20T13:00:00Z' } });
    await expect(c.start('member', H)).resolves.toEqual({ id: ID, downloadUrl: `https://web.test/api/export/${ID}`, expiresAt: '2026-10-20T13:00:00Z' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://web.test/api/export');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ scope: 'member', householdId: H });
  });
  it('never follows a download URL that points anywhere but /api/export/<id> on our server', async () => {
    for (const downloadUrl of ['https://evil.test/steal', '//evil.test/api/export/abc12345', '/api/other/abc12345', `/api/export/${ID}/../x`]) {
      const { c } = client({ status: 201, body: { id: ID, downloadUrl, expiresAt: 'x' } });
      expect((await err(c.start('member', H))).code).toBe('unknown');
    }
  });
  it('maps rate limiting (with the retry time), forbidden, unauthenticated, server and network failures', async () => {
    const limited = await err(client({ status: 429, body: { error: 'rate_limited', retryAfter: '2026-10-21T10:00:00Z' } }).c.start('member', H));
    expect([limited.code, limited.retryAfter]).toEqual(['rate_limited', '2026-10-21T10:00:00Z']);
    expect((await err(client({ status: 403 }).c.start('household', H))).code).toBe('forbidden');
    expect((await err(client({ status: 401 }).c.start('member', H))).code).toBe('unauthenticated');
    expect((await err(client({ status: 500 }).c.start('member', H))).code).toBe('unknown');
    expect((await err(client(new Error('Network request failed')).c.start('member', H))).code).toBe('network');
  });
  it('needs a token and a base URL', async () => {
    const { c, fetchImpl } = client({ status: 201 }, null);
    expect((await err(c.start('member', H))).code).toBe('unauthenticated');
    expect(fetchImpl).not.toHaveBeenCalled();
    const none = createExportClient({ baseUrl: '', getToken: async () => 'tok' });
    expect(none.configured).toBe(false);
    expect((await err(none.start('member', H))).code).toBe('unconfigured');
  });
});

describe('download and share', () => {
  function deps(over: Partial<ExportDeps> = {}) {
    const del = jest.fn();
    const d: ExportDeps & { del: jest.Mock } = {
      isShareAvailable: jest.fn(async () => true),
      download: jest.fn(async () => ({ uri: 'file:///cache/x.zip', delete: del })),
      share: jest.fn(async () => undefined),
      del,
      ...over,
    };
    return d;
  }
  it('downloads with the Bearer header to a dated zip name, shares it, then deletes the cached copy', async () => {
    const d = deps();
    await downloadAndShare('https://web.test/api/export/e1', 'tok', d, new Date('2026-10-20T10:00:00Z'));
    expect(d.download).toHaveBeenCalledWith('https://web.test/api/export/e1', 'family-recipes-export-20261020.zip', { Authorization: 'Bearer tok' });
    expect(d.share).toHaveBeenCalledWith('file:///cache/x.zip');
    expect(d.del).toHaveBeenCalledTimes(1);
    expect(exportFileName(new Date('2026-01-05T00:00:00Z'))).toBe('family-recipes-export-20260105.zip');
  });
  it('deletes the cached copy even when sharing fails', async () => {
    const d = deps({ share: jest.fn(async () => { throw new Error('closed'); }) });
    await expect(downloadAndShare('u', 't', d)).rejects.toThrow('closed');
    expect(d.del).toHaveBeenCalledTimes(1);
  });
  it('reports a failed download and an unavailable share sheet in plain words', async () => {
    const failing = deps({ download: jest.fn(async () => { throw new Error('boom'); }) });
    expect((await err(downloadAndShare('u', 't', failing))).code).toBe('network');
    expect(failing.share).not.toHaveBeenCalled();
    const noShare = deps({ isShareAvailable: jest.fn(async () => false) });
    expect((await err(downloadAndShare('u', 't', noShare))).message).toMatch(/Sharing is not available/);
    expect(noShare.download).not.toHaveBeenCalled();
  });
});
