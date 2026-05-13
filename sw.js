const CACHE_NAME = 'todo-v54';
const urlsToCache = [
  '/to-do-list/',
  '/to-do-list/index.html',
  '/to-do-list/todo.html',
  '/to-do-list/planner.html',
  '/to-do-list/calendar.html',
  '/to-do-list/tally.html',
  '/to-do-list/styles.css',
  '/to-do-list/planner.css',
  '/to-do-list/calendar.css',
  '/to-do-list/tally.css',
  '/to-do-list/theme.js',
  '/to-do-list/app.js',
  '/to-do-list/planner.js',
  '/to-do-list/calendar.js',
  '/to-do-list/tally.js',
  '/to-do-list/light-background.png',
  '/to-do-list/dark-background.png',
  '/to-do-list/welcome-sticker.png'
];

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
        .catch(() => caches.match(event.request).then((response) => response || caches.match('/to-do-list/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
