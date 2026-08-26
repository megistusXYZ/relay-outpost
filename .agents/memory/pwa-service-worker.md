---
name: PWA service worker & seamless updates
description: How the custom service worker updates clients; why "old app stuck on custom domain" happens and the seamless-update design.
---

# PWA service worker (client/public/sw.js + registration in client/src/main.tsx)

This app is a PWA with a hand-written service worker (no Workbox/VitePWA). `CACHE_VERSION` in `sw.js` namespaces the caches; bump it when changing caching behavior so old caches get purged on activate.

## "Site loads the OLD app on relayop.xyz but NEW app on *.replit.app"
This is almost never a DNS/deploy problem. Verify first: `curl` each domain and compare the hashed asset names in the served `index.html` (e.g. `assets/index-XXXX.js`) against a fresh local `npm run build`. If they match across domains, the **server is serving the new build everywhere** and the discrepancy is **client-side**: a stale service worker on the origin the user already visited. A never-visited origin (the `.replit.app`) has no SW, so it loads fresh.

**Why:** A service worker is registered per-origin. The previously-installed worker keeps controlling the page and serving cached content until it updates AND takes control.

## Seamless-update design (the intended behavior)
- `sw.js` `install` calls `self.skipWaiting()`; `activate` calls `self.clients.claim()` (after purging non-current caches). New deploys activate and take control with no user action.
- HTML/JS/CSS use **networkFirst** so a controlling worker still serves fresh content when online.
- `main.tsx` listens for `controllerchange` and reloads **once** — but DEFERS the reload until the tab is backgrounded (`visibilityState==='hidden'`), with a ~60s fallback timer so an always-visible tab still converges. This avoids reloading in front of an actively-using user.
- A `window 'vite:preloadError'` handler forces an **immediate** reload (overriding any pending deferred reload) to recover when the running old page imports a lazy chunk the new deploy removed. Guarded by a `sessionStorage` timestamp (~10s window) to prevent reload loops on a persistently-broken deploy.
- Two flags: `reloadStarted` (gates the actual `location.reload()`, set only when reloading) is kept **distinct** from `reloadScheduled` (prevents stacking deferred listeners/timeouts). Keep them separate — collapsing them reintroduces a race where a scheduled deferral blocks the chunk-error immediate-reload path.

**Earlier (pre-v5) design** intentionally did NOT skipWaiting/claim and showed a manual in-app "Update" banner — that is exactly what stranded returning users on the old app. Don't revert to banner-only without the auto-activate path.

**How to apply:** Any change to SW caching → bump `CACHE_VERSION`. Test active tab, background tab, long-lived visible tab, and installed PWA after deploy.
