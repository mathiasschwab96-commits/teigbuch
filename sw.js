// Teigbuch – Service Worker: Offline-Betrieb + Klick auf Benachrichtigung
//
// Alle App-Dateien einer Version werden gemeinsam gespeichert und gemeinsam ausgeliefert
// (kein Mix aus alten und neuen Dateien). Neue Version = CACHE-Name erhöhen; der Browser lädt
// dann alle Dateien neu, aktiviert sie und die App lädt sich einmal neu.
const CACHE = 'teigbuch-v2.6.3';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './calc.js', './db.js', './qr.js', './sync.js', './migrate.js', './extras.js', './ki-import.js', './config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];
// Diese Datei immer frisch vom Server holen (falls nur die Zugangsdaten geändert wurden)
const NETWORK_FIRST = ['config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  try {
    const res = await Promise.race([fetch(req, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))]);
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  } catch {
    return (await caches.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase & Co. nie anfassen
  const scope = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate') {
    // Nur die App selbst aus dem Speicher – andere Seiten (z. B. tests/compat.html) normal laden
    if (url.pathname === scope || url.pathname === scope + 'index.html') {
      e.respondWith(caches.open(CACHE).then((c) => c.match('./index.html')).then((hit) => hit || fetch(req)));
    }
    return;
  }
  if (!url.pathname.startsWith(scope) || url.pathname.startsWith(scope + 'tests/')) return;
  if (NETWORK_FIRST.some((f) => url.pathname.endsWith('/' + f))) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = e.notification.data?.hash || '#/bake';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.postMessage({ type: 'nav', hash }); return c.focus(); }
      }
      return self.clients.openWindow('./' + hash);
    }),
  );
});
