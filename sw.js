const CACHE_NAME = 'todo-v1';
const urlsToCache = [
  '/to-do-list/',
  '/to-do-list/index.html',
  '/to-do-list/styles.css',
  '/to-do-list/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;
        return fetch(event.request);
      })
  );
});
