// Offline-Fähigkeit: erst Netz (damit Updates sofort ankommen), ohne Netz aus dem Cache.
const CACHE = 'nullpunkt-v3';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/strings.de.js',
  'js/store.js',
  'js/sensors.js',
  'js/vision.js',
  'js/analysis.js',
  'js/target.js',
  'js/chart.js',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/zielscheibe-a4.pdf',
  'impressum.html',
  'datenschutz.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
