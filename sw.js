// Service worker: gör sidan installerbar och läsbar utan nät.
// Nätet först för ALLA filer – den sparade kopian används bara när man saknar nät.
// Byt versionsnumret när du ändrat filer (samma nummer som ?v= i index.html).
const VERSION = 'skidor-v7';
const SKAL = ['./', 'index.html', 'styles.css?v=7', 'app.js?v=7', 'manifest.webmanifest?v=7', 'icon.svg?v=7', 'icon-192.png?v=7', 'apple-touch-icon.png?v=7'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SKAL.map((u) => fetch(u, { cache: 'reload' }).then((r) => r.ok && c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VERSION).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((r) => {
      if (r.ok) { const kopia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, kopia)); }
      return r;
    }).catch(() => caches.match(e.request).then((t) => t || caches.match('index.html')))
  );
});
// Push från push-tjänsten → visa notisen
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { text: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'SKIDOR', {
    body: d.text || '',
    tag: d.tag || 'skidor',
    icon: 'icon-192.png?v=7',
    badge: 'badge-96.png?v=7',
    vibrate: [120, 60, 120],
    data: { url: './#mina' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((l) => (l[0] ? l[0].focus() : self.clients.openWindow('./#mina'))));
});
