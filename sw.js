const CACHE_NAME = 'todo-v320';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withScope = (path) => `${SCOPE_PATH}${path}`;
const urlsToCache = [
  '/',
  '/index.html',
  '/todo.html',
  '/todo-m.html',
  '/planner.html',
  '/calendar.html',
  '/tally.html',
  '/travel.html',
  '/teamwork.html',
  '/mail.html',
  '/manifest.json',
  '/styles.css',
  '/mobile-typography.css',
  '/visual-refinement.css',
  '/todo-mobile.css',
  '/m-dock.css',
  '/planner.css',
  '/calendar.css',
  '/tally.css',
  '/travel.css',
  '/teamwork.css',
  '/mail.css',
  '/theme.js',
  '/native-widget.js',
  '/dialog-focus.js',
  '/task-list.js',
  '/quick-task.js',
  '/task-actions.js',
  '/travel-tools.js',
  '/device-route.js',
  '/todo-mobile.js',
  '/daily-loop.js',
  '/task-fields.js',
  '/workspace-tools-core.js',
  '/workspace-tools.js',
  '/trip-expenses.js',
  '/task-details.js',
  '/reminder-client.js',
  '/workspace-search.js',
  '/workspace-tasks.js',
  '/bento-rail.js',
  '/undo-bar.js',
  '/vendor/fonts/montserrat-latin-wght-normal.woff2',
  '/vendor/fonts/Montserrat-OFL.txt',
  '/i18n.js',
  '/app.js',
  '/agent-data.js',
  '/agent-ui.js',
  '/planner.js',
  '/calendar.js',
  '/tally-core.js',
  '/tally.js',
  '/travel.js',
  '/travel-bookings.js',
  '/teamwork.js',
  '/mail.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/leaflet/images/layers.png',
  '/vendor/leaflet/images/layers-2x.png',
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

function reminderActions() {
  return [{ action: 'snooze', title: '10 min / 10 分钟后' }, { action: 'tomorrow', title: 'Tomorrow / 明天' }];
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload; try { payload = event.data.json(); } catch (_) { return; }
    if (!payload || !payload.data?.jobId || !payload.data?.token) return;
    await self.registration.showNotification(String(payload.title || 'Daily Space'), {
      body: String(payload.body || '').slice(0, 160), tag: payload.tag, data: payload.data,
      icon: withScope('/android-chrome-192x192.png'), actions: reminderActions(),
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    let target; try { target = new URL(data.href || 'todo.html', self.registration.scope); } catch (_) { return; }
    if (target.origin !== self.location.origin) return;
    if (['snooze', 'tomorrow'].includes(event.action)) {
      if (data.jobId && data.token) {
        try {
          const response = await fetch(withScope('/api/reminders/action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: data.jobId, token: data.token, action: event.action }) });
          if (!response.ok) throw new Error('Reminder action failed.');
          event.notification.close(); return;
        } catch (_) {
          event.notification.close();
          await self.registration.showNotification('Daily Space', { body: 'Could not postpone this reminder. Open the app to retry. / 未能延后提醒，请打开应用重试。', tag: event.notification.tag, data: { href: data.href } }); return;
        }
      }
      if (data.source && data.owner) { target.searchParams.set('localReminder', data.source); target.searchParams.set('reminderOwner', data.owner); target.searchParams.set('reminderAction', event.action); }
    }
    event.notification.close();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(target.href); await existing.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
