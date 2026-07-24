const CACHE_NAME = 'todo-v181';
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
  '/daily-loop.js',
  '/bento-rail.js',
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
        Promise.all(
          urlsToCache.map((url) =>
            fetch(url, { cache: 'reload' })
              .then((response) => {
                if (response && response.ok) return cache.put(url, response);
                return undefined;
              })
              .catch(() => undefined)
          )
        )
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

function isShellAsset(url) {
  const path = url.pathname;
  return (
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('/') ||
    /\/sw\.js$/.test(path)
  );
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

  // HTML/JS/CSS: network-first so deploys show up without a hard refresh.
  if (isShellAsset(url) || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            if (request.mode === 'navigate') {
              return caches.match(withScope('/todo.html')).then((fallback) => fallback || Response.error());
            }
            return Response.error();
          })
        )
    );
    return;
  }

  // Images and other static assets: cache-first for instant mobile opens.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkPromise = revalidate(request);
      if (cached) {
        networkPromise.catch(() => undefined);
        return cached;
      }
      return networkPromise.then((response) => {
        if (response) return response;
        return Response.error();
      });
    })
  );
});
