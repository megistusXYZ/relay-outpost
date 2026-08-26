# App-store readiness — Google Play & Zapstore

Status snapshot for shipping Relay Outpost to **Google Play** (AAB) and **Zapstore**
(Nostr-based APK store). Both distribute an Android package; the web app must be wrapped.

## Verdict
| Track | Status |
|---|---|
| **Installable PWA** | ✅ **Ready today** — users can "Add to Home Screen" right now. |
| **Google Play (AAB)** | ❌ Needs a native wrapper + signing + a Play listing. |
| **Zapstore (APK)** | ❌ Needs a signed APK + a NIP-94 release. |

### What's already done (the hard part)
- `client/public/manifest.json` — `display: standalone`, theme/background color,
  maskable + regular icons at 192/512, screenshots, categories.
- Service worker `client/public/sw.js` (registered in `client/src/main.tsx`, prod-only) —
  offline SPA fallback, font/asset caching, user-driven update banner.
- Icons present: `icon-192/512`, `icon-maskable-192/512`, `apple-touch-icon`, `logo.svg`.
- `client/index.html` standalone meta (viewport, theme-color, apple/mobile-web-app-capable).
- SPA fallback + correct `sw.js`/`manifest.json` headers in `server/static.ts`.

### What's missing
- No native wrapper (no Capacitor / Bubblewrap / TWA), no `android/` project.
- No `.well-known/assetlinks.json` (Digital Asset Links, needed for a TWA).
- No reverse-domain **app id**; `package.json` `name` is `rest-express`, `version` `1.0.0`.
- No Android signing keystore; no privacy-policy URL; no store-listing assets.

---

## Do these first (wrapper-agnostic)
1. **App id**: choose a reverse-domain id, e.g. `com.nosfabrica.relayoutpost`. Use the
   same id for both stores so they're recognized as the same app.
2. **Privacy policy**: Play requires a public privacy-policy URL. Host a `/privacy` page
   (can live in this repo and on relayop.xyz). Cover: keys never leave the device / signer,
   relays the app connects to, what's stored locally (localStorage), and that
   zaps/payments are peer-to-peer via the user's own wallet (NWC/WebLN).
3. **Signing keystore** (on your machine, **never commit**):
   ```
   keytool -genkey -v -keystore relay-outpost-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias relay-outpost
   ```
   Back it up — losing it means you can't update the app.
4. **Versioning**: bump `package.json` `version` per release; map it to Android
   `versionCode` (monotonic int) + `versionName` in the wrapper config.

---

## Google Play — pick ONE wrapper

### Option A — TWA via Bubblewrap (recommended: lightest, reuses the live PWA)
Wraps the deployed PWA in a thin Android shell; the app IS your site in a full-screen
Chrome Custom Tab. Smallest APK, auto-updates when you deploy the site.
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://relayop.xyz/manifest.json   # set app id, colors
bubblewrap build                                               # signed AAB + APK
```
Then prove domain ownership with **Digital Asset Links**:
- Get the keystore's SHA-256 fingerprint (`bubblewrap` prints it; or `keytool -list -v ...`).
- Serve it at `https://relayop.xyz/.well-known/assetlinks.json` (add a route in
  `server/static.ts`):
  ```json
  [{ "relation": ["delegate_permission/common.handle_all_urls"],
     "target": { "namespace": "android_app",
       "package_name": "com.nosfabrica.relayoutpost",
       "sha256_cert_fingerprints": ["<YOUR:KEYSTORE:SHA256>"] } }]
  ```
- Requires the site on **HTTPS** (relayop.xyz already is). Without valid asset-links the
  TWA shows a browser URL bar.

### Option B — Capacitor (bundles assets locally; more native control)
Ships the built web assets inside the APK (works without the live site), and gives access
to native plugins later (push, share sheet, biometrics).
```
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android
npx cap init "Relay Outpost" com.nosfabrica.relayoutpost --web-dir dist/public
npm run build && npx cap add android && npx cap copy
# Android Studio or: cd android && ./gradlew bundleRelease   (signed AAB)
```

### Play submission
- Google Play Console dev account ($25 one-time).
- Upload the signed AAB + listing (screenshots from the PWA, feature graphic, description).
- **Crypto/financial disclosure (important):** the app has **Lightning zaps** (NIP-57) and
  **Nostr Wallet Connect** (`client/src/contexts/NWCContext.tsx`, `ZapDialog`, `lib/zap.ts`).
  These are **non-custodial, peer-to-peer Bitcoin Lightning** payments through the user's
  own wallet — **not** Google Play Billing, and the app sells no goods/services. Declare it
  truthfully on the Finance/Data-safety forms; many Nostr clients (Amethyst, Primal, Damus
  is iOS) ship the same model. Don't advertise it as "buy crypto here."
- Data safety form: keys stay on device/signer; relay connections; local storage only.

---

## Zapstore (no review queue)
Zapstore distributes signed APKs via Nostr (NIP-82/NIP-94 release events).
1. Produce a **signed APK** (Bubblewrap `build` emits one, or Capacitor
   `./gradlew assembleRelease`).
2. Install the Zapstore CLI and publish — it creates a release event **signed with your
   Nostr key** pointing at the APK (hosted on Blossom/your host):
   ```
   # see https://zapstore.dev — typically:  zapstore publish  (with app metadata + APK)
   ```
3. Reuses the same name/description/icons from the manifest. No crypto-disclosure gate.

---

## Pre-launch checklist
- [ ] App id chosen (`com.nosfabrica.relayoutpost`) and set in wrapper config.
- [ ] `/privacy` page live + URL ready for Play.
- [ ] Release keystore generated + backed up (never in git).
- [ ] Wrapper chosen (Bubblewrap **or** Capacitor) and a signed AAB/APK produced.
- [ ] (TWA only) `/.well-known/assetlinks.json` served with the keystore SHA-256.
- [ ] Version bumped; `versionCode` incremented.
- [ ] Play: dev account, listing assets, Lightning/NWC disclosure + data-safety form.
- [ ] Zapstore: signed APK published via the CLI with your Nostr key.
- [ ] Test the wrapped app on a real low-end Android device (cold start, login via signer,
      a zap, offline reload).

> The wrapper choice and all signing/account/submission steps run on your machine/CI —
> not code in this repo. This doc is the checklist; say the word and I'll scaffold whichever
> wrapper you pick (assetlinks route + privacy page for TWA, or the Capacitor config).

---

## Play Console declarations — prepared answers (2026-08-18 store QA)

Fill these forms verbatim when the listing is created. They must always match the
shipped app — if a feature changes (especially anything wallet-related), update the
answer in the same PR. Full risk analysis: PRs #714–#717.

### 1. Child Safety Standards declaration (BLOCKS publishing until done)
- Published standards URL: **`/child-safety`** on the production domain
  (guest-accessible, routed beside /terms and /privacy).
- Designated child safety contact: **decide at submission time** (owner call
  2026-08-18: no email published for now — the page deliberately carries none, and
  none is required until the Console form is filed). The contact is a Console form
  field submitted to Google, not a public-page requirement. Create a dedicated
  monitored address (e.g. a `safety@` alias on a domain of choice) when filing;
  Play listings also require a general support email at that point.
- Form confirmations, all truthfully YES: published CSAE standards ✓ (the page),
  in-app reporting mechanism ✓ (Report on posts/profiles/media/DM threads, NIP-56 +
  operator queue), CSAM removal on obtaining knowledge ✓ (our surfaces + operated
  infra + operator notification, per the page), child-safety point of contact ✓,
  compliance with child safety laws incl. NCMEC reporting ✓.

### 2. Data safety form
Declare exactly this — Google diff-checks against observed traffic:
- **Account creation:** none on our servers (Nostr keys are generated client-side).
- **Data collected by us:** first-party signup telemetry ping (`/api/telemetry/signup`)
  — app interactions, not linked to identity. Declare it.
- **Data shared:** user-published content goes to user-chosen relays =
  **user-initiated sharing**, not "sharing" in the form's sense. Media uploads go to
  user-chosen Blossom servers — declare as user-initiated.
- **DMs:** end-to-end encrypted (NIP-17) → use the E2EE exemption.
- **Encryption in transit:** YES (wss/https only — re-verify no `ws://` fallback
  before each submission).
- **Deletion:** in-app NIP-62 vanish flow at /settings/danger; describe honestly
  (broadcast to write relays + full local wipe; third-party relay retention caveat
  is disclosed in-UI).
- **No ads, no third-party tracking SDKs.**

### 3. Financial features declaration
- Declare: **cryptocurrency wallet — self-custody (non-custodial)**.
- Rationale on file: keys never leave the user's signer; zaps are P2P wallet-to-wallet
  (NWC/WebLN/Lightning links); npub.cash is an independent third-party service holding
  pre-claim funds (named as such in the Wallet UI, PR #715); the in-app sweep moves
  funds under the user's own key with proofs stored locally in the browser. We hold
  nothing, ever. Google's Aug 2025 clarification puts non-custodial wallets out of
  licensing scope.
- If Play ever challenges the sweep: fallback is a build flag removing in-app sweep,
  linking out to npub.cash (the extension-account path already does this).

### 4. Age rating (IARC questionnaire)
- Answer truthfully: user-generated content YES; content moderation/filtering YES
  (default-on sensitive blur + age screen + confirm on disable, PR #716; reporting;
  blocking; trust filtering); references to crypto/gambling: crypto YES (Lightning
  tips), gambling NO.
- Expected outcome: **Mature 17+**. Precedent: Damus 18+, Primal 16+ — do not
  under-declare to chase a lower rating; that is the actual policy violation.

### 5. Export compliance
- Play console encryption question: app uses standard encryption (NIP-44 /
  NIP-17 E2EE) → qualifies for the mass-market treatment; answer accordingly.
- When the iOS track exists: `ITSAppUsesNonExemptEncryption = YES` + claim the
  mass-market exemption (5D992.c); file the annual BIS/NSA encryption
  self-classification report; complete the French ANSSI declaration or exclude
  France at launch. (Answering NO would be the misdeclaration — the app ships
  non-exempt standard encryption.)

### Review-notes kit (attach to first submission, both stores)
- Zaps: optional P2P gifts, 100% to the receiver, sent via the user's own external
  wallet; the app sells nothing and takes no cut (Apple 3.2.1(vii) / Play P2P
  exemption; Amethyst & Primal precedent).
- Auth: first-party Nostr key auth, no third-party SSO → Sign in with Apple (4.8)
  not triggered.
- Deletion: NIP-62 broadcast + full local wipe, retention caveat disclosed.
- Moderation stack: default filters, WoT tiers, NIP-56 reports + operator queue,
  block/mute, child-safety page.
- Support email (plain, non-Nostr) on both listings; /privacy URL in the console.
