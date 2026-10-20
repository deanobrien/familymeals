import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { FetchError, decodeHtml, guardedGet, nodeTransport, type Transport, type TransportRequest } from './fetch-page';
import { UrlRejectedError, type LookupFn } from './ssrf';

const PUBLIC = '93.184.216.34';
const lookupMap = (m: Record<string, string[]>): LookupFn => async (host) => (m[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }) as const);

interface FakeResp { status?: number; headers?: Record<string, string>; body?: Buffer | string; }
/** Scripted transport: records every request it is asked to make. */
function fake(responses: Record<string, FakeResp>) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    const r = responses[req.url.toString()];
    if (!r) throw new FetchError('NETWORK', 'no route');
    return {
      status: r.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...(r.headers ?? {}) },
      body: Readable.from([Buffer.from(r.body ?? '<html></html>')]),
    };
  };
  return { transport, calls };
}

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

describe('guardedGet', () => {
  it('fetches a public page, anonymously', async () => {
    const f = fake({ 'https://recipes.test/a': { body: '<html>hello</html>' } });
    const r = await guardedGet('https://recipes.test/a#frag', { lookup: lookupMap({ 'recipes.test': [PUBLIC] }), transport: f.transport });
    expect(text(r.bytes)).toBe('<html>hello</html>');
    expect(r.finalUrl).toBe('https://recipes.test/a');
    expect(f.calls[0]!.address.address).toBe(PUBLIC);
    const h = Object.keys(f.calls[0]!.headers);
    expect(h).not.toContain('cookie');
    expect(h).not.toContain('authorization');
    expect(h).not.toContain('referer');
  });

  it('never calls the network for a blocked address or host', async () => {
    const f = fake({});
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://localhost/', 'file:///etc/passwd', 'https://[::1]/']) {
      await expect(guardedGet(u, { lookup: lookupMap({}), transport: f.transport })).rejects.toBeInstanceOf(UrlRejectedError);
    }
    expect(f.calls).toHaveLength(0);
  });

  it('never calls the network when the name resolves to a private address', async () => {
    const f = fake({});
    await expect(guardedGet('https://evil.test/', { lookup: lookupMap({ 'evil.test': ['192.168.0.9'] }), transport: f.transport })).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(guardedGet('https://mixed.test/', { lookup: lookupMap({ 'mixed.test': [PUBLIC, '10.0.0.1'] }), transport: f.transport })).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    expect(f.calls).toHaveLength(0);
  });

  it('follows a public redirect', async () => {
    const f = fake({
      'https://short.test/x': { status: 301, headers: { location: 'https://www.recipes.test/final' } },
      'https://www.recipes.test/final': { body: 'ok' },
    });
    const r = await guardedGet('https://short.test/x', { lookup: lookupMap({ 'short.test': [PUBLIC], 'www.recipes.test': ['93.184.216.35'] }), transport: f.transport });
    expect(r.finalUrl).toBe('https://www.recipes.test/final');
    expect(r.redirects).toBe(1);
    expect(f.calls.map((c) => c.address.address)).toEqual([PUBLIC, '93.184.216.35']);
  });

  it.each([
    ['an IP literal', 'http://127.0.0.1/admin'],
    ['the metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost', 'http://localhost:8080/'],
    ['a relative-looking internal name', 'http://intranet/'],
    ['a file URL', 'file:///etc/passwd'],
    ['a name that resolves privately', 'https://rebind.test/'],
    ['a disallowed port', 'http://short.test:6379/'],
  ])('refuses a redirect to %s', async (_n, target) => {
    const f = fake({ 'https://short.test/x': { status: 302, headers: { location: target } } });
    await expect(guardedGet('https://short.test/x', {
      lookup: lookupMap({ 'short.test': [PUBLIC], 'rebind.test': ['10.1.1.1'] }), transport: f.transport,
    })).rejects.toBeInstanceOf(UrlRejectedError);
    expect(f.calls).toHaveLength(1); // only the first hop was ever requested
  });

  it('stops after too many redirects (loop)', async () => {
    const f = fake({ 'https://loop.test/a': { status: 302, headers: { location: 'https://loop.test/a' } } });
    await expect(guardedGet('https://loop.test/a', { lookup: lookupMap({ 'loop.test': [PUBLIC] }), transport: f.transport, maxRedirects: 3 }))
      .rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    expect(f.calls).toHaveLength(4);
  });

  it('DNS rebinding: resolves once per hop and connects to the address that was checked', async () => {
    let calls = 0;
    // A rebinding resolver: public on the first answer, private afterwards.
    const lookup: LookupFn = async () => { calls++; return [{ address: calls === 1 ? PUBLIC : '127.0.0.1', family: 4 }]; };
    const f = fake({ 'https://rebind.test/': { body: 'ok' } });
    const r = await guardedGet('https://rebind.test/', { lookup, transport: f.transport });
    expect(text(r.bytes)).toBe('ok');
    expect(calls).toBe(1);
    expect(f.calls[0]!.address.address).toBe(PUBLIC);
  });

  it('rejects responses over the size limit (declared and streamed)', async () => {
    const lk = lookupMap({ 'big.test': [PUBLIC] });
    const declared = fake({ 'https://big.test/': { headers: { 'content-length': '999999' } } });
    await expect(guardedGet('https://big.test/', { lookup: lk, transport: declared.transport, maxBytes: 1000 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const streamed = fake({ 'https://big.test/': { body: 'x'.repeat(5000) } });
    await expect(guardedGet('https://big.test/', { lookup: lk, transport: streamed.transport, maxBytes: 1000 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('bounds a decompression bomb by the DECOMPRESSED size', async () => {
    const bomb = gzipSync(Buffer.alloc(200_000, 97));
    expect(bomb.length).toBeLessThan(2000);
    const f = fake({ 'https://bomb.test/': { headers: { 'content-encoding': 'gzip' }, body: bomb } });
    await expect(guardedGet('https://bomb.test/', { lookup: lookupMap({ 'bomb.test': [PUBLIC] }), transport: f.transport, maxBytes: 10_000 }))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('decompresses gzip within the limit', async () => {
    const f = fake({ 'https://gz.test/': { headers: { 'content-encoding': 'gzip' }, body: gzipSync(Buffer.from('<html>zipped</html>')) } });
    const r = await guardedGet('https://gz.test/', { lookup: lookupMap({ 'gz.test': [PUBLIC] }), transport: f.transport });
    expect(text(r.bytes)).toBe('<html>zipped</html>');
  });

  it('rejects non-HTML content types and bad statuses', async () => {
    const lk = lookupMap({ 'x.test': [PUBLIC] });
    for (const type of ['application/pdf', 'application/json', 'image/png', 'application/octet-stream']) {
      const f = fake({ 'https://x.test/': { headers: { 'content-type': type } } });
      await expect(guardedGet('https://x.test/', { lookup: lk, transport: f.transport })).rejects.toMatchObject({ code: 'NOT_HTML' });
    }
    const nf = fake({ 'https://x.test/': { status: 404 } });
    await expect(guardedGet('https://x.test/', { lookup: lk, transport: nf.transport })).rejects.toMatchObject({ code: 'HTTP_STATUS', status: 404 });
  });

  it('image mode accepts images only', async () => {
    const lk = lookupMap({ 'img.test': [PUBLIC] });
    const ok = fake({ 'https://img.test/a.jpg': { headers: { 'content-type': 'image/jpeg' }, body: 'jpegbytes' } });
    expect(text((await guardedGet('https://img.test/a.jpg', { lookup: lk, transport: ok.transport, expect: 'image' })).bytes)).toBe('jpegbytes');
    const html = fake({ 'https://img.test/a.jpg': {} });
    await expect(guardedGet('https://img.test/a.jpg', { lookup: lk, transport: html.transport, expect: 'image' })).rejects.toMatchObject({ code: 'NOT_IMAGE' });
  });

  it('times out when the overall deadline has passed', async () => {
    let t = 0;
    const slow: Transport = async () => { t += 20_000; throw new FetchError('NETWORK', 'slow'); };
    await expect(guardedGet('https://slow.test/', { lookup: lookupMap({ 'slow.test': [PUBLIC, '93.184.216.40'] }), transport: slow, timeoutMs: 10_000, now: () => t }))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('nodeTransport (pinned connection)', () => {
  const servers: http.Server[] = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });

  it('connects to the supplied address without resolving the host name, sending the right Host and no cookies', async () => {
    const seen: { host?: string | undefined; cookie?: string | undefined } = {};
    const server = http.createServer((req, res) => {
      seen.host = req.headers.host;
      seen.cookie = req.headers.cookie;
      res.setHeader('content-type', 'text/html');
      res.end('<html>pinned</html>');
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    // "never-resolves.invalid" has no DNS record: success proves the connect used the pinned address.
    const res = await nodeTransport({
      url: new URL(`http://never-resolves.invalid:${port}/page?x=1`),
      address: { address: '127.0.0.1', family: 4 },
      headers: { accept: 'text/html' },
      timeoutMs: 3000,
    });
    const chunks: Buffer[] = [];
    for await (const c of res.body) chunks.push(c as Buffer);
    expect(res.status).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe('<html>pinned</html>');
    expect(seen.host).toBe(`never-resolves.invalid:${port}`);
    expect(seen.cookie).toBeUndefined();
  });

  it('times out an unresponsive server', async () => {
    const server = http.createServer(() => { /* never answers */ });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await expect(nodeTransport({ url: new URL(`http://slow.invalid:${port}/`), address: { address: '127.0.0.1', family: 4 }, headers: {}, timeoutMs: 300 }))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('decodeHtml', () => {
  it('honours header charset, then meta, then utf-8', () => {
    expect(decodeHtml(Buffer.from('café', 'latin1'), 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeHtml(Buffer.from('<meta charset="windows-1252">café', 'latin1'), 'text/html')).toContain('café');
    expect(decodeHtml(Buffer.from('café'), 'text/html; charset=nonsense')).toBe('café');
  });
});
