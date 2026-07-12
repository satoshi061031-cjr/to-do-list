const CACHE_NAME = 'todo-v98';
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
  '/styles.css',
  '/planner.css',
  '/calendar.css',
  '/tally.css',
  '/teamwork.css',
  '/mail.css',
  '/theme.js',
  '/app.js',
  '/planner.js',
  '/calendar.js',
  '/tally.js',
  '/teamwork.js',
  '/mail.js',
  '/light-background.png',
  '/dark-background.png',
  '/welcome-sticker.png'
].map(withScope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
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

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((response) => {
            if (response) return response;
            const path = new URL(event.request.url).pathname.replace(/\/+$/, '') || '/';
            if (path === '/' || path.endsWith('/index.html')) {
              return caches.match(withScope('/index.html'));
            }
            return Response.error();
          })
        )
    );
    return;
  }

  if (new URL(event.request.url).pathname.startsWith(withScope('/api/'))) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
