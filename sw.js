const CACHE_NAME = 'todo-v142';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withScope = (path) => `${SCOPE_PATH}${path}`;
const urlsToCache = [
  '/',
  '/index.html',
  '/todo.html',
  '/planner.html',
  '/calendar.html',
  '/tally.html',
  '/teamwork.html',
  '/mail.html',
  '/manifest.json',
  '/styles.css',
  '/planner.css',
  '/calendar.css',
  '/tally.css',
  '/teamwork.css',
  '/mail.css',
  '/theme.js',
  '/i18n.js',
  '/app.js',
  '/agent-data.js',
  '/agent-ui.js',
  '/planner.js',
  '/calendar.js',
  '/tally.js',
  '/teamwork.js',
  '/mail.js',
  '/light-background.png',
  '/dark-background.png',
  '/welcome-sticker.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
].map(withScope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(urlsToCache.map((url) => cache.add(url).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith(withScope('/api/'));
}

function revalidate(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => undefined);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Live API — never serve stale JSON from cache.
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell + static assets: cache-first for instant mobile opens, then refresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkPromise = revalidate(request);
      if (cached) {
        networkPromise.catch(() => undefined);
        return cached;
      }
      return networkPromise.then((response) => {
        if (response) return response;
        if (request.mode === 'navigate') {
          return caches.match(withScope('/index.html')).then((fallback) => fallback || Response.error());
        }
        return Response.error();
      });
    })
  );
});
