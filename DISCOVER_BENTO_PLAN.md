# Discover becomes a real place

Decisions from the 2026-08-07 grilling, with what the codebase says each one
costs. Companion to `POSITIONING_AND_IA.md`; this is the piece its decision
table deferred with "Discover: Public Nostr, News, finding Outposts."

## The finding that started it

**Discover is not a discovery surface.** `nav-destinations.ts` points it at
`path: "/"` — the Home feed, the old Feed tab renamed. When the IA collapsed
8 → 4, News, Articles and Communities lost their nav entries entirely and now
survive on redirects (`/news` → `/search?tab=media&type=news`), contextual
links, and one unread-news shortcut in the launcher.

The codebase had already caught this: the News badge was REMOVED from the
Discover tab because "tapping Discover showed a feed with no news in it and
the number never moved" — reported from a phone as *"Discover is showing
notifications."* The comment says the badge can return "when News is genuinely
reachable under Discover." This plan is that work.

## The decisions

| # | Question | Decision |
|---|---|---|
| 1 | Contain the feed or replace it? | **Replace** — Discover lands on a bento chooser; the feed becomes one tile |
| 2 | Static tiles or live? | **Live** — every tile carries real content |
| 3 | Routing | **New `/discover` route; `/` stays the feed.** Nothing redirects, no bookmarks break |
| 4 | Tile set | **Feed · News · Communities · Articles + universal search bar on top** |
| 5 | Layout | **Asymmetric: 1 hero + 3 compact.** Desktop: hero left, three stacked right. Mobile: hero, then three compact rows — all four above the fold |
| 6 | Hero lane | **News, fixed** (RSSHeroCard already renders image + headline + source; works signed-out) |
| 7 | Tile empty states | **Three honest states**: content / "Nothing new" / "Couldn't reach — retry". "Nothing new" only after `canReachAny()` proves someone answered |
| 8 | Signed-out | **Same bento + one sign-in row.** No lock badges — all four lanes have public content (For-you feed is `requiresAuth: false`, RSS is HTTP, long-form is public, /outposts is a public directory) |
| 9 | Tile destinations | **Restore `/news` and `/articles` as real routes.** The standalone pages exist (`pages/RSSFeed.tsx`, `pages/ArticlesFeed.tsx`) — Search renders them `embedded`; this deletes two redirects |
| 10 | Badges | **No badge on the Discover tab.** The unread count lives on the News tile, next to the thing that clears it. A count on a chooser is the badge-nobody-could-clear bug rebuilt |
| 11 | Rollout | **Direct, no flag.** `/discover` is net-new and `/` is untouched; rollback is re-pointing one nav path |

## Rules carried from elsewhere in the repo

- **Reachability**: tiles report through `withReach` / `canReachAny`
  (`lib/relay-reach.ts`). Absent is never rendered as empty. No fourth
  hand-rolled version of this primitive.
- **Tiles never disappear.** A dead relay must not remove the door to
  Communities — the whole page IS the door. State changes inside the tile.
- **Surfaces use `.glass-*`** so the page reacts to Performance Full/Lite
  (perf-surface consistency, PRs #342/#347/#349), and the mobile
  `::before/::after` noise layers stay `display:none` (glass flicker, #98).
- **Guest = same surface.** `buildNavDestinations` returns `[discover]` alone
  for signed-out visitors — this page is their entire nav. One sign-in row,
  not per-tile locks.
- **Search bar on top** follows the shipped Outposts pattern: one universal
  paste/search input covers "find a person" and "I have a link" without
  spending a tile.
- **Media stays dead** as a destination (IA decision 5). No Media tile. A Live
  tile is out until the FeaturedStrip → `/calendar` dead-end is fixed.

## What it costs (measured)

- **Nav re-point**: `discover.path` `"/"` → `"/discover"` in
  `nav-destinations.ts` — one line, three consumers (rail, footer, launcher)
  all read the shared list.
- **New page**: `pages/Discover.tsx` — the only net-new build. Hero = existing
  `RSSHeroCard` data path; Communities tile = `fetchCommunityActivity`
  (already reach-aware, shipped for the Chats ordering); Articles/Feed tiles =
  first item of existing queries.
- **Route restores**: `/news` and `/articles` stop redirecting, render the
  existing standalone pages un-embedded. Two route lines.
- **Redirect**: `/search?tab=media&type=news` etc. keep working unchanged —
  nothing breaks inbound links.

## Open, deliberately deferred

- Whether the People/vouching surface earns a tile later (kept off to hold
  four tiles).
- Whether `/discover` should absorb the guest LandingMarketing funnel.
- The News badge's return to any tab-level surface: only if the bento itself
  ever marks news read, which it currently must not.

---

# Round 2 (2026-08-08): Search × Discover, News as a lane, people discovery

Grilled after the bento shipped (#628) and the first hands-on test.

| # | Question | Decision |
|---|---|---|
| 12 | The bar promises people but only searches communities | **Live people rows in the dropdown** — top 3–4 name matches (avatar, name, nip-05) above the community rows, tap → profile. Uses the same user search Search's People tab and DM new-chat already run. |
| 13 | Search vs Discover | **Two roles, one engine.** The bar = quick-jump ("take me to X"); /search = deep results ("find things about X"), reached via the bar's Search-everything row or the header magnifier. Nothing retired. |
| 14 | News page | **Lane polish only.** Back-to-Discover affordance on mobile; the expanded-IA News tab re-points from `/search?tab=media&type=news` to the real `/news`; the page's own promoted search hero demotes to a compact row (two universal search bars a tap apart is one too many). Everything #125 shipped stays. |
| 15 | People discovery on the bento | **Quiet strip under the grid** — one row, 4–6 avatar cards, "People to follow", one-tap Follow. Not a fifth tile: the grid stays 1 hero + 3. |
| 16 | Strip sourcing | **Friends-of-follows first, trending fallback.** Both pools pass the flagged/spam floor before render; already-followed accounts never appear; vouched-first deferred until vouch coverage can fill a strip. |

## Build constraints carried forward

- The strip's Follow button goes through the **guarded kind-3 path** (the
  follow-list wipe footgun: never publish on an empty base — 51023d6's three
  guarded sites are the only sanctioned writers).
- Trending pools are Primal-fed and can contain accounts the user's shield
  would hide — the flagged-tier filter runs BEFORE render, not after tap.
- The people rows in the bar reuse the existing debounced user search; no new
  fetch machinery.
- /news back-affordance must not regress expanded-IA arrivals (its footer tab
  will now point at /news directly).
