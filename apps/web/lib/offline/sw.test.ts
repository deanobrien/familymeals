// The service worker (public/sw.js) run in a sandbox with an in-memory Cache API and a scripted network (P3-C, D446).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.test';

type Handler = (e: unknown) => void;

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: Request | string, opts?: { ignoreSearch?: boolean }) => {
        const exact = m.get(key(r));
        if (exact || !opts?.ignoreSearch) return exact?.clone();
        const bare = (u: string) => u.split('?')[0];
        for (const [k, v] of m) if (bare(k) === bare(key(r))) return v.clone();
        return undefined;
      },
      put: async (r: Request | string, res: Response) => { m.set(key(r), res.clone()); },
    };
  };
  return { stores, open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) };
}

function boot(net: (url: string, init?: RequestInit) => Promise<Response>) {
  const handlers: Record<string, Handler> = {};
  const caches = fakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: Handler) => { handlers[t] = h; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => undefined },
    registration: { showNotification: async () => undefined },
  };
  runInNewContext(SOURCE, { self, caches, fetch: (r: Request | string, init?: RequestInit) => net(typeof r === 'string' ? r : r.url, init), Request, Response, URL, setTimeout, Promise, Array });
  const fetchEvent = async (url: string, opts: { method?: string; mode?: string } = {}) => {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    const req = Object.assign(new Request(url, { method: opts.method ?? 'GET' }), {});
    Object.defineProperty(req, 'mode', { value: opts.mode ?? 'cors' });
    handlers.fetch!({ request: req, respondWith: (p: Promise<Response>) => { responded = p; }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = responded ? await responded : undefined;
    await Promise.all(waits);
    return res;
  };
  const message = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    handlers.message!({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { caches, fetchEvent, message, handlers };
}

const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
const down = async () => { throw new TypeError('Failed to fetch'); };

describe('service worker: offline shopping page', () => {
  it('serves the last good copy of /shopping when the network is down, ignoring the query string', async () => {
    let online = true;
    const sw = boot(async () => (online ? html('<h1>list v1</h1>') : down()));
    expect(await (await sw.fetchEvent(`${ORIGIN}/shopping?plan=abc`, { mode: 'navigate' }))!.text()).toContain('list v1');
    online = false;
    const offline = await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    expect(offline!.status).toBe(200);
    expect(await offline!.text()).toContain('list v1');
  });

  it('shows a plain offline page when there is no copy yet', async () => {
    const sw = boot(down);
    const res = await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('Open it once while you have signal');
  });

  it('never stores a redirect (signed out) or an error page, so a signed-out visit cannot replace the list', async () => {
    let next: () => Promise<Response> = async () => html('<h1>my list</h1>');
    const sw = boot(() => next());
    await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    next = async () => { const r = html('<h1>sign in</h1>'); Object.defineProperty(r, 'redirected', { value: true }); return r; };
    await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    next = async () => html('boom', { status: 500 });
    const res = await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    expect(await res!.text()).toContain('my list'); // a 5xx falls back to the copy
    next = down;
    expect(await (await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' }))!.text()).toContain('my list');
  });

  it('leaves everything else alone: other methods, other origins, APIs, other pages when online', async () => {
    const sw = boot(async () => html('x'));
    expect(await sw.fetchEvent(`${ORIGIN}/shopping`, { method: 'POST', mode: 'navigate' })).toBeUndefined();
    expect(await sw.fetchEvent('https://elsewhere.test/shopping', { mode: 'navigate' })).toBeUndefined();
    expect(await sw.fetchEvent(`${ORIGIN}/api/shopping/scan`)).toBeUndefined();
    expect(await sw.fetchEvent(`${ORIGIN}/recipes`)).toBeUndefined(); // sub-resource, not under a static prefix
    // Other navigations pass through when online and only get a tiny page when the network fails.
    expect(await (await sw.fetchEvent(`${ORIGIN}/recipes`, { mode: 'navigate' }))!.text()).toBe('x');
    expect([...sw.caches.stores.keys()]).not.toContain('fr-pages-v1');
  });

  it('caches hashed static assets cache-first and unhashed ones network-first', async () => {
    let calls = 0;
    let body = 'v1';
    const sw = boot(async () => { calls += 1; return new Response(body, { status: 200 }); });
    const hashed = `${ORIGIN}/_next/static/chunks/app/shopping/page-0123456789abcdef.js`;
    await sw.fetchEvent(hashed);
    await sw.fetchEvent(hashed);
    expect(calls).toBe(1);
    const plain = `${ORIGIN}/_next/static/chunks/app/shopping/page.js`;
    await sw.fetchEvent(plain);
    body = 'v2';
    expect(await (await sw.fetchEvent(plain))!.text()).toBe('v2'); // online: fresh
    calls = 0;
    const offlineSw = boot(down);
    await expect(offlineSw.fetchEvent(plain)).rejects.toThrow(); // nothing cached in a new worker
  });

  it('offline, an unhashed asset is found even when only its ?v= stamp differs (Next dev); a hashed file is not guessed', async () => {
    let online = true;
    const sw = boot(async () => (online ? new Response('chunk', { status: 200 }) : down()));
    await sw.fetchEvent(`${ORIGIN}/_next/static/chunks/app/shopping/page.js?v=111`);
    online = false;
    const res = await sw.fetchEvent(`${ORIGIN}/_next/static/chunks/app/shopping/page.js?v=222`);
    expect(await res!.text()).toBe('chunk');
    await expect(sw.fetchEvent(`${ORIGIN}/_next/static/chunks/other.js?v=1`)).rejects.toThrow();
  });

  it('warm: only static asset paths and whitelisted pages are fetched and stored', async () => {
    const asked: string[] = [];
    const sw = boot(async (url) => { asked.push(url); return url.endsWith('/shopping') ? html('<h1>list</h1>') : new Response('asset', { status: 200 }); });
    await sw.message({ type: 'fr-warm', urls: ['/_next/static/chunks/a-0123456789abcdef.js', '//evil.test/x.js', '/api/secret', 'https://evil.test/_next/static/x.js', '/icons/icon-192.png'], pages: ['/shopping', '/settings', '/api/export'] });
    expect(asked.sort()).toEqual([`${ORIGIN}/_next/static/chunks/a-0123456789abcdef.js`, `${ORIGIN}/icons/icon-192.png`, `${ORIGIN}/shopping`].sort());
    expect(sw.caches.stores.get('fr-pages-v1')?.size).toBe(1);
  });

  it('clear removes every fr- cache (sign-in)', async () => {
    const sw = boot(async () => html('<h1>list</h1>'));
    await sw.fetchEvent(`${ORIGIN}/shopping`, { mode: 'navigate' });
    expect(sw.caches.stores.size).toBeGreaterThan(0);
    await sw.message({ type: 'fr-clear' });
    expect(sw.caches.stores.size).toBe(0);
    await sw.message({ type: 'something-else' }); // ignored
    await sw.message(null); // ignored
  });

  it('keeps the web push handlers', () => {
    const sw = boot(down);
    expect(typeof sw.handlers.push).toBe('function');
    expect(typeof sw.handlers.notificationclick).toBe('function');
  });
});
