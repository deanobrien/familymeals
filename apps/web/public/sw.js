/* Family Recipes service worker: Web Push only (P1-C, D389). No caching, no fetch handler (the app is online-only on the web).
 * The push payload is JSON { title, body, link, tag } with generic text; `link` is an in-app path. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
