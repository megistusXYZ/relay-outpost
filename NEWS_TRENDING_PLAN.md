# News, made trendy: from forced presets to a trending front page

Decisions from the 2026-08-08 grilling, with what the codebase says each one
costs. Companion to `DISCOVER_BENTO_PLAN.md` — News is one of its lanes, and
this is how that lane stops being an RSS reader you must curate and becomes a
fast, personal, trending front page.

## The finding that started it

The News page **forces ~35 preset feeds** on every new user (`NEWS_STARTER_FEEDS`
+ the podcast starter set, auto-loaded in `rss-feeds.ts`) and ranks them with
**our own** `news-scoring.ts`. Two problems fall out of that:

- **Speed.** "All feeds" can source ~90 feeds; even with the staged loader
  (`RSSFeed.tsx` front-page + idle backfill, 6 feeds / 400ms) it is a fan-out of
  dozens of `/api/rss?url=` round-trips **per user**, plus client-side scoring of
  hundreds of items.
- **Relevance.** A new user gets *our 35 opinions* as "their subscriptions,"
  which they then have to prune. The presets are the product instead of the
  substrate.

Meanwhile **podcasts already ride a real external trending signal** — Podcast
Index (`/api/podcastindex/trending`, `/trend-suggestions`, a rolling 14-day
history in `server/routes.ts`). News has no equivalent; its "trending" is our
curated list in whatever order our scorer picks. That asymmetry is the whole
opportunity.

## The one claim

**Lead with the pulse, not the presets.** The News page opens on *what is hot
right now* — outlet consensus, lifted by what your own network is sharing — not
on 35 feeds we chose for you.

## The decisions

| # | Question | Decision |
|---|---|---|
| 1 | What leads on first open? | **Trending, not subscriptions.** A discovery surface (Google News / Artifact), not a personal RSS inbox. Your own sources lead the moment you add any. |
| 2 | Where does the ranking signal come from? | **A blend: cross-source corroboration (primary) + Nostr-network boost.** Outlet consensus as the universal floor, lifted by what your web-of-trust shares. Not a third-party news API (no key/quota/fragility), not our editorial scoring. |
| 3 | How does the user steer it *from the jump*? | **A lightweight topic lens** (World / Business / Tech / Sports / Bitcoin / Nostr…), reads silently refining the weighting underneath. Source curation demoted to a power-user affordance, not the primary model. |
| 4 | Do podcasts stay on the surface? | **Yes, as a separate rail** riding Podcast Index trending — never interleaved into the news ranking. Each content type rides the signal it is actually good at. |
| 5 | Does rank or unread lead the flow? | **Trending rank leads; read dims in place.** The front-page model, not the inbox. A "N new since you looked" nudge handles freshness without reordering. |
| 6 | Where do a user's own added sources live? | **Both:** an add *boosts* that source in the Trending river (matters immediately, everywhere) **and** accumulates into a chronological **Following** lane that appears only once non-empty. |
| 7 | How is trending computed server-side? | **Lightweight fuzzy corroboration, one cached job per interval** — group near-duplicate headlines by title/keyword + shared entities in a time window, rank clusters by (outlet count × recency × topic weight). No ML, no external clustering API. |
| 8 | Where is the Nostr boost computed? | **Client-side re-rank off network-shared URLs.** The base payload stays one cached, universal thing; the personal lift rides follow-feed data the client already handles. Zero per-user server work. |
| 9 | How visible is the *why*? | **Explicit but restrained signal badges** — a corroboration count and, when it exists, "N you follow shared." Loud on the hero and top cluster, a faint pip down the tail. |

## The architecture, in one breath

> **One cached server job** computes the universal trending front page
> (fuzzy corroboration over a broad source pool, per topic). **The client
> fetches it once** and paints. **The client re-ranks it** against the URLs
> its own network has been sharing, lifting the stories your web-of-trust is
> talking about. Podcasts ride Podcast Index trending in a **separate rail**.
> Topics you picked **tilt** the ranking; sources you add **boost** it and fill
> a **Following** lane. Read stories **dim in place**; rank never yields to
> read-state.

The speed win is structural: today every user fans out ~90 `/api/rss` requests
and scores hundreds of items on-device. Tomorrow every user fetches **one
cached, pre-ranked payload** and does a cheap local re-rank. The `/api/rss`
120-req/min/IP budget stops being a per-user concern because the fan-out is
**one job**, not thousands of client requests.

## Why corroboration + Nostr, specifically — the complementarity

The two signals cover each other's blind spots, which is why the blend beats
either alone:

- **General news** (a story BBC, Guardian, NPR, CBS, PBS, Al Jazeera are all
  running) gets **strong corroboration** — outlet consensus is dense there.
- **Niche topics** (Bitcoin, Nostr, a narrow blog) have **few outlets to
  corroborate**, so corroboration is weak — and *that* is exactly where the
  **Nostr-network boost** carries the weight, because those are the stories your
  web-of-trust actually shares.

No other news app can show "3 people you follow shared this," because no other
news app has a portable trust graph. That line, on a mid-list story, is the
entire reason this reads as *yours* and not as another aggregator.

## What it costs (measured against the codebase)

### Already built / reusable

- **The per-feed proxy + cache.** `/api/rss?url=` (SSRF-guarded, TTL cache,
  `Cache-Control: public max-age=300`) is exactly the primitive the server
  aggregation job calls internally. The server fans out over the same route it
  already serves; the client just stops doing so.
- **A corroboration factor already exists** in `news-scoring.ts`
  (`factors.corroboration`, +5 per unique outlet, capped) — decision 7 promotes
  this concept to the primary ranking and moves it server-side.
- **The topic taxonomy** — `news-categories.ts` buckets (World / Business /
  Tech / Sports / …) are the topic-lens chips (decision 3). No new taxonomy.
- **Podcast trending** — `/api/podcastindex/trending` and `trend-suggestions`
  power the rail (decision 4) with zero new server work.
- **The read ledger** (`RSS_READ_KEY`, `rssItemKey`) drives "dim in place"
  (decision 5) — it already exists; it just stops being the *sort key*.
- **The network-shares signal** overlaps the External Discussion bridge
  (`EXTERNAL_DISCUSSION_PLAN.md`, NIP-73) and the home feed's follow
  subscription — the client already reads the notes we need to scan for URLs.
- **The "front page" instinct** — `NEWS_FRONT_PAGE_URLS` and the staged loader
  already encode "paint a small curated set first." The server job generalizes
  that from "12 feeds first" to "the ranked front page, precomputed."

### Real engineering (net-new)

1. **The server aggregation + clustering job** (decision 7). Periodically fan
   out the broad news pool over `/api/rss`, fuzzy-cluster near-duplicate
   headlines within a window, rank clusters, cache per topic. This is the
   dominant cost and the thing that makes everything fast. Start with fuzzy
   title/keyword + entity overlap; leave a seam to swap in semantic clustering
   later if the pilot shows the grouping is too coarse.
2. **The `/api/news/trending` endpoint** the client fetches (one payload, topic
   param, cached).
3. **The client-side network re-rank** (decision 8): scan recent follow-feed
   notes for URLs, build a "links my network shared + who + zap/repost weight"
   map (GrapeRank-weighted when `wotReady`, degrading to follow-count), match
   against the trending list, lift matches. NIP-73 external refs count where
   present; bare URLs in kind-1 are the bulk, so they are not required.
4. **The page rebuild** (decisions 5, 9): trending-rank order (not unread-first),
   read dims in place, signal badges (corroboration count + network lift),
   topic-lens chips, the podcast rail, the appear-when-populated Following lane.
   The magazine/desktop vs single-column/mobile split from the current page is
   preserved.

### The migration

- **Forced presets → invisible substrate.** `NEWS_STARTER_FEEDS` et al. stop
  auto-loading as "your subscriptions"; they become the server job's source
  pool. `loadHiddenDefaults()` semantics change from "which of our feeds you
  pruned" to (mostly) unused for a topic-lens user.
- **Custom feeds keep working, differently.** `loadCustomFeeds()` adds now do
  two things (decision 6): boost that source in Trending **and** populate the
  Following lane. No data is lost; the meaning of an "add" widens.
- **The per-feed cache is shared both ways.** A feed the server job fetched is
  instant when a user drills into that single source, and vice-versa — the
  `["/api/rss", url]` key stays the join.
- **Rollout behind a flag**, same shape as the IA/bento flags (`ro_*`), so the
  new front page can land inert and flip once verified — and roll back to the
  current reader in one boolean.

## Open, deliberately deferred

- **Semantic clustering** (decision 7, option B). Ship fuzzy; upgrade only if
  the pilot shows differently-worded coverage isn't grouping.
- **How aggressively reads personalize the topic weighting** (decision 3's
  silent layer). Start with a light touch; tune from real behavior.
- **Whether Following eventually earns its own destination** rather than an
  appear-when-populated lane — a question for when a cohort actually curates
  sources at volume.
- **A "trending news" DVM / Nostr-native aggregation** as a future replacement
  for the RSS pool, if the ecosystem grows one — the corroboration job is the
  bridge until then.

## The honest caveat

There is **no free trending-news API** the way Podcast Index hands us trending
podcasts. Corroboration is *our* computation over public RSS — defensible
("outlet consensus, not our opinion") but still infrastructure we own and must
keep healthy. The Nostr boost is the differentiator, but news coverage on
Nostr is thin today, so for a general audience the corroboration floor is
doing most of the work at launch. Don't let the pitch get retold internally as
"we use a trending API" — we *built* the trending signal, and the network lift
is what makes it ours.
