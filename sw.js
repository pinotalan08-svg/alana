// Offline support: the game shell is cached on first visit, so it runs without network afterwards.
const CACHE = 'abysses-v3';
// fonts and three.js come from CDNs: cached on first use so the game keeps working offline
const EXT_CACHE = 'abysses-ext-v1';
const EXT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/util.js',
  './js/data.js',
  './js/gfx.js',
  './js/models.js',
  './js/room.js',
  './js/game.js',
  './js/scene.js',
  './js/ui.js',
  './js/audio.js',
  './js/input.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== EXT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // stale-while-revalidate: answer from cache, refresh it in the background
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
  } else if (EXT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(EXT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
