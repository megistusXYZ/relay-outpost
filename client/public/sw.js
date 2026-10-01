const CACHE_VERSION = 'relay-outpost-v7';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
// The app's page (index.html is the same for every route). Kept across cache
// versions on purpose: a worker update must never cost the next launch its
// instant open.
const SHELL_CACHE = 'relay-outpost-shell';
const SHELL_KEY = '/__ro_shell';
const SHELL_AT = 'x-ro-cached-at';

const STATIC_ASSETS = [
  '/manifest.json',
  '/favicon.png',
  '/favicon-192.png',
  '/apple-touch-icon.png',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  // Activate a freshly installed worker immediately instead of leaving it in
  // the `waiting` state. Combined with clients.claim() on activate, new
  // workers roll out with no manual "Update" click. The mid-session
  // chunk-mismatch problem this used to cause is handled on the page side
  // (main.tsx): reloads are deferred until the tab is backgrounded, and a
  // vite:preloadError handler recovers if the running page ever requests a
  // chunk a new deploy removed.
  self.skipWaiting();
  event.waitUntil(Promise.all([
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS)),
    // Keep the page now, so the very next launch opens from cache. Never fails
    // the install: without it, the first launch simply asks the network.
    fetchShell(undefined)
      .then((next) => keepShell(next, Promise.resolve(null)))
      .catch(() => {}),
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.resolve()
      .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable())
      .catch(() => {})
      .then(() => caches.keys())
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== FONT_CACHE && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (FONT_ORIGINS.some((origin) => request.url.startsWith(origin))) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Vite's build output: the file name carries a hash of its content, so a
  // cached copy is always right and never needs the network.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.pathname.match(/\.(js|css)$/)
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    request.destination === 'image' ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|woff2?|ttf|eot)$/)
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate' && isAppPage(url)) {
    // Both registered synchronously, as the event requires.
    const opened = openShell(event);
    event.respondWith(opened.then((o) => o.response));
    event.waitUntil(opened.then((o) => o.background).catch(() => {}));
    return;
  }
});

/** Every route of the app is served the same index.html; files and server
 *  endpoints (/.well-known, sitemap.xml, maintenance.html…) are not. */
function isAppPage(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/.well-known/')) return false;
  return !/\.[a-z0-9]+$/i.test(url.pathname);
}

/**
 * Open the app from its cached page: answer at once, fetch the fresh page
 * behind it (the browser's navigation preload when it has one), keep it, and
 * tell open pages when it changed so they can move onto it quietly.
 * Returns the response and the background work to keep the worker alive for.
 *
 * The kept page is answered whatever its age. A page older than a day used to
 * ask the network first and wait up to 3 s for it, so the first open of the
 * day — the common one on a phone — sat on the launch image for the whole
 * cold-radio round trip. The reason for that wait (a build whose lazy chunks
 * are gone from the server) is handled on the page side now: a missing chunk
 * reloads onto the fresh page (lib/sw-shell.ts), and a newer page is moved
 * onto quietly at the next natural boundary (lib/update-policy.ts).
 */
async function openShell(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(SHELL_KEY);
  // Read the old page's text now: the response itself goes to the browser.
  const before = cached ? cached.clone().text() : Promise.resolve(null);
  const fresh = fetchShell(event.preloadResponse);

  if (cached) {
    return { response: cached, background: fresh.then((next) => keepShell(next, before)) };
  }

  // First open: the network, kept for the next launch.
  const kept = fresh.then(async (next) => {
    await keepShell(next.clone(), before);
    return next;
  });
  return { response: kept.catch(() => new Response('Offline', { status: 503, statusText: 'Service Unavailable' })), background: kept.catch(() => {}) };
}

async function fetchShell(preloadResponse) {
  let res;
  try { res = preloadResponse ? await preloadResponse : undefined; } catch { res = undefined; }
  if (!res) res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
  if (!res || !res.ok) throw new Error('shell ' + (res && res.status));
  return res;
}

/** Keep a fresh page as the shell. Tells open pages when it differs from the
 *  one they were given (`previousText`: a promise of its text, or of null). */
async function keepShell(next, previousText) {
  const body = await next.text();
  const before = await previousText;
  const headers = new Headers(next.headers);
  headers.set(SHELL_AT, String(Date.now()));
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(SHELL_KEY, new Response(body, { status: 200, headers }));
  if (before !== null && before !== body) {
    const all = await self.clients.matchAll({ type: 'window' });
    all.forEach((c) => c.postMessage({ type: 'ro-shell-updated' }));
  }
  return body;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // "Restart onto the new version": fetch the page fresh and keep it BEFORE
  // the page reloads, so the reload can't be answered with the old one.
  if (event.data && event.data.type === 'ro-refresh-shell') {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      fetchShell(undefined)
        .then((next) => keepShell(next, Promise.resolve(null)))
        .then(() => { if (port) port.postMessage({ ok: true }); })
        .catch(() => { if (port) port.postMessage({ ok: false }); })
    );
  }
});
