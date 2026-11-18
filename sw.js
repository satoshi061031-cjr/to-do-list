const CACHE_NAME = 'todo-v334';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withScope = (path) => `${SCOPE_PATH}${path}`;
const urlsToCache = [
  '/',
  '/index.html',
  '/tools.html',
  '/notes.html',
  '/review.html',
  '/toolbox-page.css',
  '/toolbox-page.js',
  '/toolbox-tasks.js',

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
  '/workbench-preferences.js',
  '/workbench.js',
  '/workbench-tools.js',
  '/workbench-tools.css',
  '/workbench.css',
  '/workbench-desktop.js',
  '/workbench-desktop.css',
  '/phone-layout.css',
  '/phone-workbench.js',
  '/calendar-mobile.js',
  '/native-widget.js',
  '/dialog-focus.js',
  '/interaction-surfaces.js',
  '/interaction-surfaces.css',
  '/layout-motion.js',
  '/interaction-feedback.js',
  '/interaction-feedback.css',
  '/workspace-command.js',
  '/workspace-command.css',
  '/task-list.js',
  '/quick-task.js',
  '/task-actions.js',
  '/travel-tools.js',
  '/device-route.js',
  '/todo-mobile.js',
  '/daily-loop.js',
  '/task-fields.js',
  '/workspace-tools-core.js',
  '/task-views-core.js',
  '/task-planning.js',
  '/task-planning.css',
  '/focus-core.js',
  '/focus-workbench.js',
  '/focus-workbench.css',
  '/notes-core.js',
  '/notes-workbench.js',
  '/notes-workbench.css',
  '/record-history-core.js',
  '/record-history.js',
  '/record-history.css',
  '/agent-sources.js',
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
  '/apple-touch-icon.png',
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

const NETWORK_TIMEOUT_MS = 3000;

function cachePut(request, response) {
  if (!response || !response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

function cachedShell(request) {
  return caches.match(request)
    .then((cached) => cached || caches.match(request, { ignoreSearch: true }))
    .then((cached) => cached || (request.mode === 'navigate' ? caches.match(withScope('/todo.html')) : undefined));
}

function networkFirstWithTimeout(event, request) {
  const network = fetch(request);
  // Keep the cache fresh even when the cached copy answered first.
  event.waitUntil(network.then((response) => cachePut(request, response)).catch(() => undefined));
  const fallback = () => cachedShell(request).then((cached) => cached || network);
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, NETWORK_TIMEOUT_MS); })
    .then(() => cachedShell(request))
    .then((cached) => cached || network);
  return Promise.race([network.then((response) => { clearTimeout(timer); return response; }), timeout])
    .catch(() => { clearTimeout(timer); return fallback(); })
    .then((response) => response || Response.error(), () => Response.error());
}

function versionedAsset(request, url) {
  return caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
        // Drop older versions of the same file so the cache does not grow per deploy.
        cache.keys().then((keys) => keys.forEach((key) => {
          const old = new URL(key.url);
          if (old.pathname === url.pathname && old.search && old.search !== url.search) cache.delete(key);
        }));
      }
      return response;
    }).catch(() => cache.match(request, { ignoreSearch: true }).then((plain) => plain || Response.error()));
  }));
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

  // Versioned scripts and styles (file.js?v=<hash>) never change: cache-first.
  if (url.searchParams.has('v') && /\.(js|css)$/.test(url.pathname)) {
    event.respondWith(versionedAsset(request, url));
    return;
  }

  // Pages and unversioned shell files: network-first, but a slow or sleeping
  // server falls back to the cached copy after a few seconds instead of a blank page.
  if (isShellAsset(url) || request.mode === 'navigate') {
    event.respondWith(networkFirstWithTimeout(event, request));
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
    await self.registration.showNotification(String(payload.title || 'dayfly'), {
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
          await self.registration.showNotification('dayfly', { body: 'Could not postpone this reminder. Open the app to retry. / 未能延后提醒，请打开应用重试。', tag: event.notification.tag, data: { href: data.href } }); return;
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
