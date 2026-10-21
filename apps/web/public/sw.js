/* Family Recipes service worker.
 *  - Web Push (P1-C, D389): the payload is JSON { title, body, link, tag } with generic text; `link` is an in-app path.
 *  - Offline shopping list (P3-C, D446): keeps the shopping page's HTML (the shell AND the last list snapshot it was rendered
 *    with) plus the static assets it needs, so a signed-in user who opened the list before losing signal can reopen it. Edits
 *    made offline are queued by the page itself (IndexedDB) and replayed when the connection returns: nothing is queued here.
 *    Only GET requests for the offline pages and static assets are touched; APIs, server actions and everything else go to the
 *    network exactly as before. The page cache is wiped on sign-in (see OfflineBoot) and on request ('fr-clear').
 */
const VERSION = 'v1';
const STATIC_CACHE = 'fr-static-' + VERSION;
const PAGE_CACHE = 'fr-pages-' + VERSION;
/** Pathnames whose HTML is kept for offline use. Query strings are ignored. */
const OFFLINE_PAGES = ['/shopping'];
/** How long a slow network may delay a page that we hold a copy of. */
const SLOW_NETWORK_MS = 6000;
const STATIC_PREFIXES = ['/_next/static/', '/icons/', '/vendor/'];
/** Content-hashed files never change: cache-first. Everything else under the prefixes is network-first. */
const HASHED = /(-[0-9a-f]{12,}\.(js|css)|\/[0-9a-f]{12,}\.(js|css)|\/_next\/static\/media\/)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('fr-') === 0 && k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

const pageKey = (pathname) => new Request(self.location.origin + pathname);

function offlinePage(path) {
  const body =
    '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>You are offline</h1>' +
    (path === '/shopping'
      ? '<p>Your shopping list is not saved on this device yet. Open it once while you have signal and it will work offline next time.</p>'
      : '<p>This page needs a connection. <a href="/shopping">Open your shopping list</a> (it works offline if you opened it before).</p>') +
    '</body></html>';
  return new Response(body, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const isHtml = (res) => (res.headers.get('content-type') || '').indexOf('text/html') === 0;

/** Network first; a page we hold a copy of is served from the cache when the network fails, errors or is very slow. */
async function offlineablePage(event, req, url) {
  const cache = await caches.open(PAGE_CACHE);
  const key = pageKey(url.pathname);
  const network = fetch(req).then((res) => {
    // Cache only a real page for a signed-in user: not a redirect (to /sign-in), not an error.
    if (res.ok && !res.redirected && isHtml(res)) cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => undefined)); // let the cache write finish even if a slow network lost the race
  const cached = await cache.match(key);
  if (!cached) return network.catch(() => offlinePage(url.pathname));
  const fallback = new Promise((resolve) => setTimeout(() => resolve(cached), SLOW_NETWORK_MS));
  const guarded = network.then((res) => (res.status >= 500 ? cached : res), () => cached);
  return Promise.race([guarded, fallback]);
}

async function staticAsset(req, url) {
  const cache = await caches.open(STATIC_CACHE);
  if (HASHED.test(url.pathname)) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    if (OFFLINE_PAGES.indexOf(url.pathname) !== -1) event.respondWith(offlineablePage(event, req, url));
    else event.respondWith(fetch(req).catch(() => offlinePage(url.pathname)));
    return;
  }
  if (STATIC_PREFIXES.some((p) => url.pathname.indexOf(p) === 0)) event.respondWith(staticAsset(req, url));
});

async function warm(data) {
  const urls = Array.isArray(data.urls) ? data.urls.slice(0, 200) : [];
  const pages = Array.isArray(data.pages) ? data.pages.slice(0, 4) : [];
  const statics = await caches.open(STATIC_CACHE);
  for (const u of urls) {
    // Only same-origin static asset paths: this message must never turn the worker into a general fetch/cache proxy.
    if (typeof u !== 'string' || u.charAt(0) !== '/' || u.charAt(1) === '/' || !STATIC_PREFIXES.some((p) => u.indexOf(p) === 0)) continue;
    const req = new Request(self.location.origin + u);
    if (await statics.match(req)) continue;
    try {
      const res = await fetch(req);
      if (res.ok) await statics.put(req, res);
    } catch (e) {
      /* offline: nothing to warm */
    }
  }
  const pageCache = await caches.open(PAGE_CACHE);
  for (const p of pages) {
    if (typeof p !== 'string' || OFFLINE_PAGES.indexOf(p) === -1) continue;
    try {
      // redirect: 'manual' so a signed-out redirect to /sign-in is an opaque redirect (not ok) and is never stored.
      const res = await fetch(self.location.origin + p, { credentials: 'same-origin', redirect: 'manual', headers: { accept: 'text/html' } });
      if (res.ok && isHtml(res)) await pageCache.put(pageKey(p), res);
    } catch (e) {
      /* offline */
    }
  }
}

async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.indexOf('fr-') === 0).map((k) => caches.delete(k)));
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'fr-clear') event.waitUntil(clearAll());
  else if (data.type === 'fr-warm') event.waitUntil(warm(data));
});

function safeLink(link) {
  return typeof link === 'string' && /^\/[A-Za-z0-9/_.?=&%-]*$/.test(link) ? link : '/notifications';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Family Recipes';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    data: { link: safeLink(data.link) },
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
    renotify: typeof data.tag === 'string' && !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(safeLink(event.notification.data && event.notification.data.link), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
