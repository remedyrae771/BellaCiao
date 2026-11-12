/* Service worker: приложение открывается мгновенно и работает без интернета.

   Файлы приложения, шрифты и библиотека Firebase отдаются сразу из кэша,
   а свежая версия тихо скачивается в фоне (stale-while-revalidate) и
   применяется при следующем открытии.
   Запросы к самой базе (firestore/googleapis) не перехватываются: у Firebase
   свой офлайн-режим, а кэширование его потоковых ответов ломало бы обновления. */
const CACHE = 'bellaciao-v17';
const ASSETS = [
  './', './index.html', './css/styles.css', './js/data.js', './js/ttk-data.js',
  './js/firebase-config.js', './js/firebase-db.js', './js/sync.js', './js/app.js',
  './manifest.json', './icons/icon.svg',
];
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !CACHEABLE_HOSTS.includes(url.hostname)) return; // база и всё прочее — напрямую

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: own });
    const fresh = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    if (cached) { e.waitUntil(fresh); return cached; }
    return fresh;
  }));
});
