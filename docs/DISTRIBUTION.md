# Distribution guide

How to ship Relay Outpost across channels, from least to most gatekept. Relay Outpost is a
PWA-first web app: the web build is the canonical distribution, and every "app store" target
below is a thin wrapper around that same web app.

> Sequence recommendation: **Web/PWA → Zapstore → Google Play → iOS (later).**

---

## 1. Web / PWA (ship first)

The app is already a production-ready PWA — `client/public/manifest.json`, a hand-written
service worker (`client/public/sw.js`), and all icon sizes (192/512 + maskable) are in place.

1. Build: `npm run build` (outputs the SPA to `dist/public`, server to `dist/index.cjs`).
2. Deploy on any Node 20+ host (or Docker — see the README "Run your own outpost"). Put a
   reverse proxy (Caddy/nginx) in front for TLS and set `ALLOWED_ORIGINS` to your domain.
3. Visitors can **Install / Add to Home Screen** on Chrome, Edge, Android, ChromeOS, macOS,
   Windows, and (with limits) iOS Safari.

This gives you instant updates and zero gatekeepers. Everything below wraps this deployment.

**Before any store submission:**
- Make sure beta gating is off (default): `VITE_BETA_GATE` unset/`0` at build time.
- Have a hosted **privacy policy** URL (the app serves one at `/privacy`).
- Pick a stable app id: **`xyz.megistus.relayoutpost`** (used by both Android stores).

---

## 2. Zapstore (next — lowest friction, aligned audience)

[Zapstore](https://zapstore.dev) is a Nostr-native app store. You sign releases with your own
Nostr key — no corporate review — and reach the Bitcoin/Nostr crowd who make great early users.

Zapstore distributes **Android APKs / desktop binaries**, not PWAs, so you first wrap the PWA
into an APK (see the Bubblewrap steps in §3 — the same APK works here), then publish with the
Zapstore CLI:

1. Produce a signed APK (Bubblewrap / PWABuilder — §3).
2. Install the Zapstore CLI and follow their publish flow to sign the release event with your
   Nostr key and attach the APK.
3. Users discover and install it from the Zapstore client.

This is the ideal place to validate the wrapping pipeline before dealing with Google's review.

---

## 3. Google Play (TWA via Bubblewrap / PWABuilder)

A **Trusted Web Activity** wraps the live PWA in a thin Android shell — no separate codebase.

**Prerequisites**
- A Google Play developer account ($25 one-time). New personal accounts must run a **closed
  test** (a set of testers for ~14 days) before production.
- The app live at your HTTPS domain with a valid `manifest.json`.

**Steps**
1. Generate the TWA project:
   - [PWABuilder](https://www.pwabuilder.com) (point it at your URL → "Package for Android"), or
   - [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap): `bubblewrap init --manifest https://YOUR_DOMAIN/manifest.json`
   - Use app id **`xyz.megistus.relayoutpost`**.
2. **Create a signing keystore** and **store it offline** (and the passwords). Losing it means
   you can never update the app on Play. Get its SHA-256 fingerprint:
   `keytool -list -v -keystore your.keystore -alias your-alias`
3. **Digital Asset Links** — publish `https://YOUR_DOMAIN/.well-known/assetlinks.json` so the
   TWA opens full-screen without a browser URL bar. Template:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "xyz.megistus.relayoutpost",
       "sha256_cert_fingerprints": ["REPLACE_WITH_YOUR_KEYSTORE_SHA256"]
     }
   }]
   ```
   (Also add Play's App Signing fingerprint here once Play re-signs your app.)
4. Build the signed **AAB** and upload it to Play Console.
5. Fill in the **store listing**, **privacy policy URL** (`/privacy`), and the **Data safety**
   form (declare what the app collects — for the client itself this is minimal; be accurate).
6. Submit for review.

---

## 4. iOS (later — most friction)

Apple **does not accept TWA/PWA wrappers** — you need a real native shell (e.g. Capacitor or a
WKWebView host app), plus the Apple Developer Program ($99/yr) and full App Review.

**The zap caveat:** Apple's in-app-purchase rules (the 30% cut on digital goods) have repeatedly
collided with Nostr zaps — apps like Damus were forced to disable zapping to stay listed. Plan to
ship the iOS build with **zaps reframed or disabled**, and only pursue iOS after web + Android
have validated demand. It may not be worth it pre-traction.

A lighter desktop "download" (Discord-style) is also possible later via **Tauri**, which wraps the
same web app far more lightly than Electron — though PWA install already covers most of this.

---

## Versioning

- `package.json` `version` is the source of truth (semver, currently `1.0.0`).
- For Android wrappers: map it to `versionName` (e.g. `"1.0.0"`) and bump a **monotonic
  integer `versionCode`** every upload (e.g. `100000` → `100001`). `versionCode` lives in the
  wrapper config, not this repo.
- Cut releases via Git tags / GitHub Releases so each store build maps to a known commit.
