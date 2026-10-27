// Service worker: gör sidan installerbar och läsbar utan nät.
// Byt versionsnumret när du ändrat HTML/CSS/JS så att mobilerna hämtar nytt.
const VERSION = 'skidor-v1';
const SKAL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SKAL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VERSION).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Data och sidan: nätet först (så tablån alltid är färsk), annars cache
  if (url.pathname.includes('/data/') || e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      const kopia = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, kopia));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  // Övrigt: cache först
  e.respondWith(caches.match(e.request).then((t) => t || fetch(e.request)));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((l) => (l[0] ? l[0].focus() : self.clients.openWindow('./#mina'))));
});
