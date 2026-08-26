# Relay Outpost — Manual Device QA Checklist

Things that can't be unit-tested in the node harness (UI, viewing, login flows,
desktop vs mobile). Run on a real device. The automated suite covers the logic behind
content creation (`client/src/lib/content-pipeline.test.ts`) and NIP-65 relay
selection (`client/src/lib/relay-prefs.test.ts`); this checklist covers the rest.

## Setup (do this first)
- [ ] Test on **cellular or VPN** — home Wi-Fi with Spectrum/CUJO false-blocks `relayop.xyz`.
- [ ] Run each section **twice**: once with **raw nsec / local key**, once with the **NoStash extension**.
- [ ] Test at least once on a **fresh install / incognito** (real network load, not service-worker cache).

## A. Login flows
- [ ] **Create account** → completes → lands in the app with a working session.
- [ ] **"Secure your account" → "Set a password instead"** → password form shows (no blank). If it blanks, the error card shows the real error — capture it.
- [ ] **Passkey / Face ID** path (HTTPS only — deployed site or cloudflared tunnel, not LAN http).
- [ ] **Raw nsec** login → signs in, persists across reload.
- [ ] **NoStash extension** login → signs in.
- [ ] Background/foreground repeatedly → **no "Signer reconnected" toast** on nsec; ≤1 per 30s on extension.

## B. Creating content (desktop AND mobile)
- [ ] **Post a note** → appears in feed; verify it shows in another client (Damus/Amethyst).
- [ ] **Reply** → threads correctly in the other client (not detached).
- [ ] **React** (like) shows · **Repost** shows.
- [ ] **Upload image / video** → renders inline here AND in another client (imeta).
- [ ] **Article / poll / audio** (whichever you use).
- [ ] **Client-tag toggle** (Settings → Account): off → new note has no "via Relay Outpost"; on → it does.
- [ ] **DM**: send → recipient on another client receives + reads it; open an **old thread** → history back-fills.

## C. Viewing pages & tabs
- [ ] Feed (Latest/Trending) loads & ranks · Search · Profile · Notifications · Outposts/channels · Wallet · Settings — each loads without blanking.
- [ ] **New-user default feed**: a brand-new / invited account (few follows) lands on **For You** with a populated feed — NOT a near-empty "Following". Switching to Following is a manual tap. (An account that explicitly set "Following" as default keeps it.)

## D. Mobile-specific (regression-prone fixes)
- [ ] **Side menu** opens as a **solid** drawer (no see-through / flicker).
- [ ] **Messages page loads** on mobile PWA; tapping a conversation opens the thread full-screen (no rotate needed).
- [ ] **Media player** expand → no spazz; swipe-down closes smoothly.
- [ ] **Feed video autoplay is muted**: scroll the feed past several videos → each autoplays **silently**. Unmuting one video (its controls) must NOT make the next videos play with sound as you scroll. (Regression: unmute used to carry across the whole feed.)
- [ ] **PWA icon**: delete + reinstall to Home Screen → brand mark (not "R"). Requires the published build.

## E. Known-open to confirm specifically
- [ ] **Auth-relay DMs**: send to/from an account whose kind-10050 inbox is `auth.nostr1.com` / `relay.nsec.app` → arrives (receive-AUTH fix).
- [ ] **Onboarding follow step** → "Continue" is reachable by scrolling on mobile.
- [ ] **Friend invite** → open your `/?inviter=npub…` link logged-OUT, create a brand-new account: the inviter must appear pre-checked in onboarding AND the new account must end up following them. (Regression: the inviter used to be dropped on the `/` route.)

## How to run the local build on a device
- LAN (most features, no SW/passkey): `http://<mac-ip>:5002` (same Wi-Fi; `ipconfig getifaddr en0`).
- Full PWA/passkey (HTTPS): `cloudflared tunnel --url http://localhost:5002`, open the printed `https://…trycloudflare.com` URL.
- Or the deployed site `relayop.xyz` on cellular/VPN.
