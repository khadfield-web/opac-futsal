/* OPAC Futsal service worker.
   Network-first for the app shell so a deploy is never stuck behind
   a stale cache; cache is only a fallback for flaky school wifi.
   Live data is never cached — it always comes from the network. */
const CACHE = 'opac-futsal-v7';
const SHELL = [
  './',
  './index.html',
  './assets/app.css',
  './assets/core.js',
  './assets/public.js',
  './assets/config.js',
  './assets/logo.jpg',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Never touch the database, the auth endpoints, or the SSE stream. */
  if (url.hostname.includes('firebasedatabase.app') ||
      url.hostname.includes('googleapis.com') ||
      req.headers.get('accept') === 'text/event-stream') return;

  /* Admin page is deliberately not cached — always fetch fresh. */
  if (url.pathname.endsWith('/admin.html')) return;

  /* Go past the browser's own HTTP cache for our files. GitHub Pages serves
     them with a ten minute max-age, which is long enough for a deploy to look
     like it never happened. */
  const fresh = url.origin === self.location.origin
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin', mode: req.mode === 'navigate' ? 'same-origin' : req.mode })
    : req;

  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
