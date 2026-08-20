/* Lusso service worker — push notifications only.
 *
 * Deliberately has NO fetch handler: it must never cache or intercept app
 * requests, so it can't serve a stale build. All it does is show notifications
 * pushed from Supabase and route the click back into the open app.
 */

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch { d = { title: 'Lusso', body: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(d.title || 'Lusso', {
    body:  d.body || '',
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    tag:   d.tag || 'lusso',
    renotify: true,
    data:  { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    // Prefer an app window that's already open — focus it and let the router
    // handle the route change, rather than opening a second copy of the CRM.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'lusso:navigate', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
