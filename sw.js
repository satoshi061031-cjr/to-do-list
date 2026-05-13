const CACHE_NAME = 'todo-v32';
const urlsToCache = [
  '/to-do-list/',
  '/to-do-list/index.html',
  '/to-do-list/todo.html',
  '/to-do-list/planner.html',
  '/to-do-list/calendar.html',
  '/to-do-list/styles.css',
  '/to-do-list/planner.css',
  '/to-do-list/calendar.css',
  '/to-do-list/theme.js',
  '/to-do-list/app.js',
  '/to-do-list/planner.js',
  '/to-do-list/calendar.js',
  '/to-do-list/light-background.png',
  '/to-do-list/dark-background.png'
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
