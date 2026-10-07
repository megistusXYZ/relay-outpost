const CACHE_VERSION = 'relay-outpost-v8';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
// The app's page (index.html is the same for every route). Kept across cache
// versions on purpose: a worker update must never cost the next launch its
// instant open.
const SHELL_CACHE = 'relay-outpost-shell';
const SHELL_KEY = '/__ro_shell';
const SHELL_AT = 'x-ro-cached-at';
// The build's own files (/assets/*), one cache per build, and only the last
// two builds are kept: the one the kept page belongs to, and the one before it
// (a page still running it may ask for more of its files). Before v8 they all
// went into one cache that was never emptied — a deploy renames nearly every
// file (165 of 242, measured), so a phone collected every build it had opened.
const ASSET_PREFIX = 'relay-outpost-assets-';
const GENS_KEY = '/__ro_gens';

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
      .then((kept) => kept.settled)
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
          .filter((key) => key !== STATIC_CACHE && key !== FONT_CACHE && key !== SHELL_CACHE && !key.startsWith(ASSET_PREFIX))
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
    event.respondWith(buildFile(request));
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
 * What a first open with no connection sees: a small branded page instead of
 * the word "Offline". Self-contained (no requests, it couldn't make them) and
 * no inline handler attributes (production CSP has script-src-attr 'none'), so
 * the button is wired from a script. Reloads by itself when the connection is
 * back. Pinned by sw.test.ts: under 3 KB, no on*= attributes.
 */
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>You’re offline · Relay Outpost</title><style>
:root{--bg:#0a090c;--fg:#f5f5f5;--mute:#b8b8b8;--brand:#b38bf9;--ink:#16101d;--dot:rgba(255,255,255,.16)}
@media (prefers-color-scheme:light){:root{--bg:#f9f8fc;--fg:#1d1726;--mute:#5a5669;--brand:#5e2db4;--ink:#fff;--dot:rgba(94,45,180,.2)}}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px calc(32px + env(safe-area-inset-bottom));box-sizing:border-box;background:radial-gradient(70% 50% at 50% 0,#7c3aed2e,transparent 72%),var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,sans-serif;text-align:center}
main{max-width:440px}
.s{position:relative;width:112px;height:112px;margin:0 auto 24px;display:grid;place-items:center}
.s i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:var(--dot);transform:rotate(var(--a)) translateY(-50px)}
.s i:nth-child(2){--a:45deg}.s i:nth-child(3){--a:90deg}.s i:nth-child(4){--a:135deg}.s i:nth-child(5){--a:180deg}.s i:nth-child(6){--a:225deg}.s i:nth-child(7){--a:270deg}.s i:nth-child(8){--a:315deg}.s i:first-child{--a:0deg}
svg{width:44px;height:44px;color:var(--brand)}
h1{font-size:clamp(22px,6vw,28px);line-height:1.2;font-weight:600;margin:0 0 10px}
p{color:var(--mute);font-size:15px;margin:0 auto 28px;max-width:36ch}
button{min-height:44px;padding:0 24px;border:0;border-radius:99px;background:var(--brand);color:var(--ink);font:600 15px system-ui,sans-serif;cursor:pointer}
button:focus-visible{outline:2px solid var(--fg);outline-offset:3px}
</style></head><body><main><div class="s" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 7.8L2 4H7l6 6H8.5a3.5 3.5 0 0 0 0 7H10l3 3H8.5a6.5 6.5 0 0 1-3-12.2z"/><path d="M18.5 16.2L22 20H17l-6-6h4.5a3.5 3.5 0 0 0 0-7H14l-3-3h4.5a6.5 6.5 0 0 1 3 12.2z"/></svg></div><h1>You’re offline</h1><p>Relay Outpost needs a connection the first time it opens. Once you’re back online it will load and work offline after that.</p><button id="retry" type="button">Try again</button></main><script>document.getElementById('retry').addEventListener('click',function(){location.reload()});addEventListener('online',function(){location.reload()})</script></body></html>`;

function offlinePage() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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
 *
 * One condition: the kept page is only answered when the script that starts
 * it is kept too. A page whose script is neither here nor on the server any
 * more (kept in the background, never opened, and two deploys later) opened
 * to a blank screen with nothing running that could recover. Then the network
 * answers, as on a first open.
 */
async function openShell(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(SHELL_KEY);
  // Read the old page's text now: the response itself goes to the browser.
  const beforeText = cached ? await cached.clone().text() : null;
  const before = Promise.resolve(beforeText);
  const fresh = fetchShell(event.preloadResponse);

  if (cached && await canStart(beforeText)) {
    return { response: cached, background: fresh.then((next) => keepShell(next, before)).then((kept) => kept.settled) };
  }

  // First open (or a kept page that can't start): the network, kept for the
  // next launch. With no network, the kept page is still the best there is.
  const kept = fresh.then(async (next) => {
    const k = await keepShell(next.clone(), before);
    return { next, settled: k.settled };
  });
  return {
    response: kept.then((k) => k.next).catch(() => cached || offlinePage()),
    background: kept.then((k) => k.settled).catch(() => {}),
  };
}

async function fetchShell(preloadResponse) {
  let res;
  try { res = preloadResponse ? await preloadResponse : undefined; } catch { res = undefined; }
  if (!res) res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
  if (!res || !res.ok) throw new Error('shell ' + (res && res.status));
  return res;
}

/** The files a page needs before anything runs: its scripts, preloads, styles. */
function bootFiles(html) {
  const out = [];
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The build a page belongs to: the name of the script that starts it. */
function buildOf(html) {
  const m = /src="\/assets\/(index-[A-Za-z0-9_-]+)\.js"/.exec(html);
  return m ? m[1] : 'unknown';
}

/** Is the script that starts this page kept? (No such script: nothing to check.) */
async function canStart(html) {
  const m = /src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/.exec(html);
  if (!m) return true;
  return !!(await keptBuildFile(m[1]));
}

/** Keep a fresh page as the shell. Tells open pages when it differs from the
 *  one they were given (`previousText`: a promise of its text, or of null).
 *  Resolves once the page is kept; `settled` is the rest of the work — the
 *  page's own files, fetched now so its first launch opens from cache. */
async function keepShell(next, previousText) {
  const body = await next.text();
  const before = await previousText;
  const headers = new Headers(next.headers);
  headers.set(SHELL_AT, String(Date.now()));
  const cache = await caches.open(SHELL_CACHE);
  const put = () => cache.put(SHELL_KEY, new Response(body, { status: 200, headers }));
  try {
    await put();
  } catch {
    // Storage is full: a page that can't be replaced is a build nobody can
    // leave. Make room (the build files are all re-fetchable) and try again.
    await dropBuildFiles([]);
    await put();
  }
  const build = buildOf(body);
  await noteBuild(build);
  if (before !== null && before !== body) {
    const all = await self.clients.matchAll({ type: 'window' });
    all.forEach((c) => c.postMessage({ type: 'ro-shell-updated' }));
  }
  return { body, settled: keepBootFiles(body, build).catch(() => {}) };
}

/** The builds whose files are kept: [the kept page's, the one before]. */
async function keptBuilds() {
  try {
    const cache = await caches.open(SHELL_CACHE);
    const res = await cache.match(GENS_KEY);
    const list = res ? JSON.parse(await res.text()) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function noteBuild(build) {
  const builds = await keptBuilds();
  if (builds[0] === build) return;
  const next = [build, builds[0]].filter(Boolean);
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(GENS_KEY, new Response(JSON.stringify(next)));
  await dropBuildFiles(next);
}

/** Delete every build's files except the builds named. */
async function dropBuildFiles(keep) {
  const names = (await caches.keys()).filter((k) => k.startsWith(ASSET_PREFIX) && !keep.includes(k.slice(ASSET_PREFIX.length)));
  await Promise.all(names.map((k) => caches.delete(k)));
}

async function keepBootFiles(html, build) {
  const cache = await caches.open(ASSET_PREFIX + build);
  await Promise.all(bootFiles(html).map(async (path) => {
    try {
      if (await keptBuildFile(path)) return;
      const res = await fetch(path);
      if (isBuildFile(res)) await cache.put(path, res);
    } catch { /* the launch fetches it instead */ }
  }));
}

/** A real build file: answered OK, and not a web page. A server that has no
 *  such file has answered with the app's page (status 200) — kept under the
 *  file's name, that answer broke the page that asked for as long as the cache
 *  lived, however often it reloaded. */
function isBuildFile(res) {
  return !!res && res.ok && !/text\/html/i.test(res.headers.get('content-type') || '');
}

/** A kept copy of a build file, from any kept build. A wrong answer kept by an
 *  earlier version of this worker is removed, not served. */
async function keptBuildFile(request) {
  const names = (await caches.keys()).filter((k) => k.startsWith(ASSET_PREFIX));
  for (const name of names) {
    const cache = await caches.open(name);
    // The same file whoever asks: the name is a hash of the content.
    const hit = await cache.match(request, { ignoreVary: true });
    if (!hit) continue;
    if (isBuildFile(hit)) return hit;
    await cache.delete(request, { ignoreVary: true });
  }
  return undefined;
}

/** Vite's build output: the name carries a hash of the content, so a kept copy
 *  is always right and never needs the network. */
async function buildFile(request) {
  const kept = await keptBuildFile(request);
  if (kept) return kept;
  let response;
  try {
    response = await fetch(request);
  } catch {
    return new Response('', { status: 503 });
  }
  if (response.ok && !isBuildFile(response)) {
    // "Here is the app's page" is not this file. Say what it means.
    return new Response('', { status: 404, statusText: 'Not Found' });
  }
  if (response.ok) {
    // Not awaited: the answer must not wait for its own copy to be stored.
    const copy = response.clone();
    keptBuilds()
      .then((builds) => caches.open(ASSET_PREFIX + (builds[0] || 'unknown')))
      .then((cache) => cache.put(request, copy))
      .catch(() => { /* storage full: the network answer is still good */ });
  }
  return response;
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
        // Answer as soon as the page is kept; its files follow behind.
        .then((kept) => { if (port) port.postMessage({ ok: true }); return kept.settled; })
        .catch(() => { if (port) port.postMessage({ ok: false }); })
    );
  }
});

// ── Notifications while the app is closed (owner, 2026-10-06) ─────────────────
// Our server only ever says "a call, in room <id>" or "a message": the
// group's name comes from this phone's own list (lib/push-notify.ts keeps it
// in IndexedDB ro-push/rooms), and a message never says who it's from. Every
// push shows something: phones withdraw push from apps that stay silent.
const PUSH_DB = 'ro-push';
const PUSH_ICON = '/icons/icon-192.png';

function pushRoom(room) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(PUSH_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('rooms');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const get = req.result.transaction('rooms', 'readonly').objectStore('rooms').get(room);
          get.onsuccess = () => { resolve(get.result || null); req.result.close(); };
          get.onerror = () => { resolve(null); req.result.close(); };
        } catch (e) { resolve(null); }
      };
    } catch (e) { resolve(null); }
  });
}

/** Only ever a path on this site. */
function safeOpen(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/messages';
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  event.waitUntil((async () => {
    if (data.t === 'call' && typeof data.room === 'string') {
      const info = await pushRoom(data.room);
      return self.registration.showNotification(info ? `Call in ${info.label}` : 'Incoming call', {
        body: 'Tap to join',
        tag: `call-${data.room}`,
        renotify: true,
        icon: PUSH_ICON,
        data: { open: safeOpen(info && info.open) },
      });
    }
    return self.registration.showNotification(data.more ? 'New messages' : 'New message', {
      tag: 'messages',
      icon: PUSH_ICON,
      data: { open: '/messages' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = safeOpen(event.notification.data && event.notification.data.open);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => 'focus' in w);
    if (win) {
      await win.focus();
      try { if ('navigate' in win) await win.navigate(open); } catch (e) { /* not ours to steer */ }
      return;
    }
    return self.clients.openWindow(open);
  })());
});
