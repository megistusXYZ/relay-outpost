# Relay Outpost

A full-featured Nostr social client with relay-based communities, Web of Trust integration, and privacy-first publishing.

Relay Outpost treats relays as first-class social spaces — not just infrastructure. Each relay becomes an **outpost**: a community hub with its own feed, members, knowledge base, moderation, and media storage. Combined with personalized trust scoring, encrypted messaging, scheduled publishing, and fine-grained privacy controls, it provides a complete social experience built entirely on the open Nostr protocol.

---

## Open Source Philosophy

Relay Outpost is open source because the Nostr ecosystem is strongest when clients are transparent, interoperable, and community-driven. We believe:

- **Clients should be auditable.** Users should be able to verify what their client does with their keys, their data, and their relay connections.
- **The protocol benefits from reference implementations.** Over 25 NIPs are implemented here — not behind abstractions, but in readable, forkable code that other developers can learn from and build on.
- **Relay operators deserve clients that respect their work.** Relay Outpost is built to showcase relays as communities, not commoditize them as infrastructure. Operators who invest in running relays should have a client that surfaces their NIP-11 metadata, respects their AUTH policies, honors their content boundaries, and gives their users a real community experience.
- **Decentralization means choice.** If you don't like how Relay Outpost works, fork it. Run your own. The protocol guarantees your identity and content are portable — no lock-in.

Contributions, forks, and feedback are welcome. See [Contributing](#contributing) below.

---

## Table of Contents

- [Why Relay Outpost](#why-relay-outpost)
- [Outposts](#outposts)
- [Content Calendar](#content-calendar)
- [Direct Messaging](#direct-messaging)
- [Features](#features)
- [Supported NIPs](#supported-nips)
- [How It Fits Into the Nostr Ecosystem](#how-it-fits-into-the-nostr-ecosystem)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## Why Relay Outpost

Nostr gives users sovereign identity and censorship resistance — but the protocol layer alone doesn't create communities. Most clients treat relays as interchangeable message pipes. Relay Outpost takes a different approach:

- **Relays as communities.** Each relay is a place, not a pipe. You join an outpost, see its members, read its knowledge base, and post within its context.
- **Trust without centralization.** GrapeRank Web of Trust scoring lets you filter noise without relying on a platform's moderation team. You decide your reach depth — from direct follows only to the entire network.
- **Privacy by architecture.** Protected events (NIP-70), relay-aware publishing, EXIF stripping, and NIP-17 encrypted DMs with NIP-44 gift-wrap are built in from the start — not bolted on.
- **Scheduling & planning.** A unified content calendar with server-side post scheduling, NIP-52 event discovery, iCal feed subscriptions, and creator stream tracking.
- **Full protocol coverage.** Over 25 NIPs implemented, from basic notes to live streaming, wallet integration, group chat, long-form publishing, and relay administration.

---

## Outposts

Outposts are the core concept in Relay Outpost. An outpost is a relay viewed as a community space.

### What an Outpost Provides

- **Community Feed** — a dedicated timeline of notes published to that relay, with author profiles, reactions, reposts, and zaps
- **Waves** — Reddit-style threaded discussions using Kind 11 events with NIP-22 comment trees, giving each outpost its own forum
- **Comms (NIP-29 Group Chat)** — real-time relay-based group messaging with channels, moderation tools, join/leave flows, and admin controls for relays that support NIP-29
- **Horizon (Knowledge Base)** — a Confluence/Notion-style article section powered by NIP-23 long-form content, organized into NIP-32 labeled sections (Guides, Updates, Resources, etc.)
- **Community Health Scores** — 0–100 reputation scoring based on GrapeRank trust data, factoring in trusted member percentage, flagged accounts, community size, and activity
- **Members & Moderation** — see who publishes to the relay, who moderates it, and what content policies apply
- **Blossom Media Storage** — when a relay advertises Blossom servers in its NIP-11 document, uploads from that outpost are stored on the relay's own media infrastructure
- **NIP-58 Community Badges** — create badge definitions, award badges to members, and display accepted badges on profiles
- **Relay Ops Center** — an operator dashboard for relay admins with NIP-86 moderation tools, event filtering, access control, and badge management

### Discovery

- Browse the network via NIP-66 relay monitors
- Search by name, description, tags, software, or URL
- See NIP support badges, auth requirements, and payment status at a glance
- One-click join for any relay on the network

### For Relay Operators

Relay Outpost is designed to make running a relay meaningful. Operators get:

- A visual admin dashboard for managing their relay's community
- NIP-86 moderation API integration for event management
- NIP-42 AUTH support for gated access
- NIP-70 protected events that respect relay boundaries
- Blossom media server integration for self-hosted file storage
- NIP-58 badge creation and awarding for community recognition
- Full NIP-11 metadata display so users see what your relay offers

---

## Content Calendar

The Content Calendar is a unified hub for managing your publishing schedule and tracking events across the Nostr ecosystem.

### Scheduling & Publishing

- **Server-Side Scheduler** — schedule notes, polls, and articles for future publication with automatic relay delivery
- **Client-Side Encryption** — scheduled posts are encrypted with AES-GCM before being stored server-side
- **Publishing History** — a visual timeline of your published content with clickable post previews
- **Management** — cancel, reschedule, or retry failed posts directly from the calendar
- **DM Reminder Cards** — scheduled DM reminders (Kind 1059 gift-wrap) display human-readable content previews with contextual icons

### Event Discovery

- **NIP-52 Calendar Events** — search and pin date-based (Kind 31922) and time-based (Kind 31923) events from across the network
- **Network Search** — discover community events from your follows or the broader Nostr network
- **Pinned Events** — pin discovered events to your personal calendar, synced via NIP-78 app-specific settings

### Subscriptions

- **iCal/ICS Feeds** — subscribe to any public iCal feed URL (sports schedules, holidays, conference calendars) with server-side proxy for CORS handling
- **Feed Catalog** — curated directory of popular calendar feeds organized by category (holidays, crypto events, etc.)
- **Creator Streams** — subscribe to specific Nostr creators to track their planned live streams (Kind 30311) on your calendar
- **Per-Feed Reminders** — toggle DM reminders on or off for individual subscribed feeds, with configurable timing (10 min, 30 min, 1 hour before events); reminders are delivered as NIP-17 encrypted self-DMs

### Personal Events

- **Custom Events** — add birthdays, anniversaries, and personal dates with recurrence support (once, weekly, monthly, yearly)
- **Private & Public Events** — create events visible only to you or share them as NIP-17 encrypted DM invites to specific contacts
- **Built-in Holidays** — auto-calculated major holidays with toggle visibility
- **Metadata** — attach emojis, notes, and external URLs to any event

### Visual Design

- **Color-Coded Categories** — six distinct filter categories: Scheduled (violet), Published (emerald), Events (sky), My Events (amber), Feeds (rose), Streams (indigo)
- **Monthly Grid** — dot indicators on each day showing event density by type
- **Day Detail Panel** — collapsible sections for each event type with full context

---

## Direct Messaging

Relay Outpost implements a full X/Twitter-style DM experience built entirely on NIP-17 encrypted messaging:

- **Split-Pane Layout** — conversation list + flexible thread panel on desktop; full-screen thread with back navigation on mobile
- **Primary & Requests Inbox** — conversations from people you follow land in Primary; unknown senders go to Requests
- **Message Clustering** — messages within a 5-minute window from the same sender are grouped for cleaner readability
- **Date Separators** — visual day dividers with smart formatting (Today, Yesterday, or full date)
- **Smart URL Linking** — URLs in event descriptions, calendar items, and DM previews are automatically hyperlinked with proper punctuation handling
- **Contact Avatars** — sender profile pictures at the start of each cluster, clickable to visit their profile
- **Delivery Tracking** — green checkmark on sent messages confirms relay delivery
- **Media Attachments** — send images, audio, and video via Blossom upload with inline progress
- **Conversation Management** — delete, restore, promote, and demote conversations between Primary and Requests
- **Mobile Long-Press Actions** — touch-hold reveals a bottom action sheet for message operations
- **NIP-44 Encryption** — all messages use NIP-44 gift-wrap encryption with relay routing via Kind 10050 DM relay lists
- **Real-Time Notifications** — gift-wrapped DM notifications with background subscription on dedicated DM inbox relays

---

## Features

### Privacy & Security
- **NIP-70 Protected Events** — posts to private relays include the `["-"]` tag, signaling that the event should not be broadcast further
- **Relay-Aware Publishing** — choose exactly which relays receive each post (All, Private Only, Public Only, or custom selection) with full select/deselect control
- **Private Relay Isolation** — notes from private outpost relays are excluded from the main home feed
- **EXIF Metadata Stripping** — images and audio files are scrubbed of metadata client-side before upload
- **NIP-36 Content Warnings** — sensitive content is blurred behind a tap-to-reveal overlay with branded "Signal Flagged" styling
- **SSRF Protection** — all server-side URL fetches validate DNS resolution against private IP ranges

### Social
- **Following Feed** — outbox-model feed from your follow list with reply filtering and Primal cache pre-fetch for instant loading
- **Outpost Communities** — relay-based community spaces with their own feeds, members, health scores, and moderation
- **Waves (Topics)** — threaded discussions within outposts using Kind 11 events and NIP-22 comment trees
- **Comms (Group Chat)** — NIP-29 relay-based group messaging with channels, join flows, and admin tools
- **Horizon (Knowledge Base)** — NIP-23 long-form articles organized into NIP-32 labeled sections per outpost
- **Reactions & Zaps** — NIP-25 reactions with custom emojis (NIP-30) and NIP-57 Lightning zaps via NWC
- **Reposts & Quotes** — share and quote-post with relay hint tags
- **Bookmarks** — NIP-51 encrypted bookmark lists for saved content

### Trust & Moderation
- **GrapeRank Web of Trust** — personalized trust scores from Brainstorm's GrapeRank API power feed filtering, trust badges, and engagement analysis
- **Reach Depth Slider** — 6-level WoT filter from "Direct follows only" to "Global" to "Off"
- **Trust Tier Badges** — Highly Trusted, Trusted, Neutral, Low Trust, and Flagged indicators on every avatar
- **Thread Trust Bar** — visual breakdown of reply trust composition with bot-brigade detection
- **Signal Check** — per-post engagement quality verdict (Organic / Mixed / Suspicious / Inorganic)
- **Trust Reviews** — NIP-31871 attestation display on profiles with status badges (Verified, Accepted, Vouched, Expired, Revoked)
- **Flagged User Detection** — automated flagging via GrapeRank with dimmed posts, red indicators, and feed suppression
- **NIP-86 Relay Moderation** — operator controls for banning events and managing allowed pubkeys
- **Spam Filtering** — combines Nostr.Band spam API, WoT scores, and mute lists

### Publishing & Content
- **Post Composer** — rich compose experience with relay selection, scheduling, emoji/sticker/GIF picker, and media attachments
- **Long-form Articles** — NIP-23 article editor with Tiptap rich text, image/video/audio embeds, code blocks, and cover images
- **Content Calendar** — unified scheduling hub with NIP-52 event discovery, iCal subscriptions, and creator stream tracking
- **Blossom Media Uploads** — decentralized media storage with relay-advertised Blossom servers, personal server lists, and nostr.build fallback
- **Text-to-Speech** — Microsoft Edge neural voices with multi-voice thread narration and natural speech processing
- **RSS Integration** — subscribe to RSS/podcast feeds with inline playback
- **Custom Emojis & GIFs** — NIP-30 emoji packs plus GIF search with privacy-preserving server-side proxy

### Notifications
- **Real-Time Alerts** — live notifications for replies, mentions, reposts, reactions, zaps, and new followers
- **NIP-17 DM Notifications** — gift-wrapped DM alerts with NIP-44 decryption on dedicated inbox relays
- **Aggregated Views** — reactions, reposts, and zaps grouped by target event for clean presentation
- **Repost Content Previews** — repost notifications show the actual text of your reposted note instead of raw event data
- **Smart Lookback** — 6-hour fast fetch with 30-day backfill for comprehensive notification history

### Relay Management
- **NIP-11 Relay Info** — full relay metadata display with NIP support badges and Blossom server indicators
- **NIP-42 AUTH** — automatic challenge-response authentication for gated relays
- **NIP-65 Relay Lists** — outbox-model relay routing for optimal content delivery
- **NIP-66 Relay Discovery** — browse the relay network via monitor relays with search and NIP filters
- **Relay Health Monitoring** — latency tracking, exponential cooldowns, liveness pre-checks, and idle connection cleanup
- **Relay Ops Center** — admin dashboard with live feed, event moderation, access control whitelists, broadcasts, and badge management
- **Blocked Relay Lists** — Kind 10006 blocked relay persistence to Nostr

### Media
- **Video Feed** — shorts-style vertical video player with swipe navigation and grid mode
- **Image Gallery** — multi-image posts with lightbox viewer
- **Music Player** — Kind 31337 music tracks with persistent cross-page playback and audio duration tags
- **Live Streams** — NIP-53 live event discovery with HLS playback, live chat, profile live indicators, and Picture-in-Picture support (including mobile and HLS streams)
- **Audio Feed** — podcast and music discovery with background playback
- **GIF Search** — KLIPY-powered GIF search with server-side privacy proxy and trending defaults

### Wallet
- **NIP-47 Wallet Connect** — send, receive, and view transaction history with Nostr profile context
- **QR Scanner** — scan Lightning invoices and LNURL from camera
- **Zap Integration** — one-tap zaps with customizable default amounts
- **Balance Privacy** — toggle to blur wallet balance across all UI surfaces
- **Unified BTC Badge** — header badge showing BTC price or wallet balance with market stats, sparkline, mempool fees, and sats converter

### Search & Discovery
- **Multi-Tab Search** — People, Posts, Hashtags, Live, RSS, and Vouches tabs with per-tab search
- **Brainstorm Search Integration** — profile search powered by Brainstorm's MeiliSearch index of 2.7M+ Nostr profiles with WoT rank data
- **WoT-Grouped Results** — non-followed profiles grouped by trust tier (Highly Trusted, Trusted, Neutral, Low Trust)
- **Trending Discovery** — trending posts, hashtags, and content surfaced via Nostr.Band
- **Vouches Browser** — browse Kind 31871 attestation events showing who is vouching for whom across the network

### Profiles
- **Network Signal** — GrapeRank-powered influence gauge with tier badge, relationship context, and follower stats
- **Trust Reviews** — attestation-based reputation display with attester avatars, WoT influence, and status badges
- **NIP-58 Badges** — accepted and pending badge display with acceptance flow
- **Activity Stats** — signal strength ring for active users
- **Relay Tab** — NIP-65 relay list display per profile
- **Live Indicators** — pulsing red ring and "LIVE" badge on profiles currently streaming

### Analytics
- **Dashboard** — visual analytics for network growth, relay health, engagement velocity, and the "Zap Economy"
- **Event Console** — raw Nostr event inspector for debugging and protocol exploration

### Knowledge Base
- **WTF is this?** — searchable FAQ, feature guides, and deep-dive articles covering Nostr basics, keys & security, relays & outposts, Web of Trust, zaps & bitcoin, privacy, social features, platform comparisons, and big-picture philosophy
- **Tag-Based Filtering** — 9 topic tags with cross-category content coverage across FAQ, Guides, and Deep Dives
- **External Resources** — curated links to nostr.com, Brainstorm WoT documentation, and beginner guides

### Performance & Caching
- **Brainstorm Direct Document API** — profile and WoT lookups use direct key-value endpoints instead of full-text search, yielding ~30% faster per-request response times
- **Bulk Profile Prefetch** — parallel bulk fetch warms the profile cache before the primary data source responds
- **Server-Side WoT Score Cache** — 10-minute LRU cache eliminates redundant upstream lookups
- **High-Concurrency Batch Lookups** — up to 15 parallel upstream requests per batch for maximum throughput
- **Primal Cache Layer** — profile stats, feeds, follower lists, and event counts via Primal's caching API with session-level IndexedDB persistence
- **Banner & Image Preloading** — `fetchPriority="high"` and dynamic `<link rel="preload">` for near-instant rendering
- **Auto-refresh on tab return** — feeds update automatically after 5+ minutes of inactivity
- **Prioritized relay warm-up** — feed-serving relays connect first; remaining relays deferred for faster initial load

---

## Supported NIPs

| NIP | Description | Usage in Relay Outpost |
|-----|-------------|----------------------|
| NIP-01 | Basic protocol flow | Core event handling and relay communication |
| NIP-02 | Follow lists | Following feed, friend-of-friend discovery |
| NIP-07 | Browser extension signing | Login via Alby, nos2x, and other extensions |
| NIP-11 | Relay information document | Outpost metadata, Blossom server discovery, capability detection |
| NIP-17 | Encrypted direct messages | Private messaging with gift-wrap relay routing |
| NIP-19 | bech32 entity encoding | npub, note, naddr, nevent links throughout the UI |
| NIP-22 | Comment/reply threading | Waves discussions and post reply trees |
| NIP-23 | Long-form content | Horizon knowledge base articles and article editor |
| NIP-25 | Reactions | Like, custom emoji, and cross-client reactions |
| NIP-29 | Relay-based groups | Outpost Comms group chat with moderation |
| NIP-30 | Custom emojis | Emoji packs for reactions and post content |
| NIP-32 | Labeling | Horizon article sections via namespace labels |
| NIP-36 | Sensitive content | Content warnings with tap-to-reveal overlay |
| NIP-42 | Relay authentication | Gated relay access for private outposts |
| NIP-44 | Encrypted payloads | NIP-17 DM encryption via gift-wrap |
| NIP-46 | Remote signing | Nostr Connect / QR-based mobile login |
| NIP-47 | Nostr Wallet Connect | Lightning wallet send/receive/history |
| NIP-51 | Lists | Bookmarks, custom feeds, mute lists, group lists |
| NIP-52 | Calendar events | Event discovery, pinning, and calendar integration |
| NIP-53 | Live events | Live stream discovery, HLS playback, and chat |
| NIP-57 | Zaps | Lightning payments on posts and profiles |
| NIP-58 | Badges | Community badge creation, awarding, and display |
| NIP-65 | Relay list metadata | Outbox-model relay routing |
| NIP-66 | Relay discovery | Network-wide relay browser via monitors |
| NIP-70 | Protected events | Private relay content isolation |
| NIP-78 | App-specific data | Persistent settings and pinned calendar events |
| NIP-86 | Relay management API | Operator moderation and admin tools |
| NIP-98 | HTTP auth | Authenticated media uploads to Blossom servers |

---

## How It Fits Into the Nostr Ecosystem

Relay Outpost is a client — it doesn't run its own relay or store user data on a central server. It connects to the existing Nostr relay network and layers a community experience on top.

**For users:** You get a social client that works with any Nostr relay, any NIP-07 signer, and any Lightning wallet. Your identity, follows, and content are portable — nothing is locked to Relay Outpost.

**For relay operators:** You get a client that actually showcases your relay as a destination. Relay Outpost surfaces your NIP-11 metadata, supports your auth policies, respects your content boundaries, and gives your community a visual home with feeds, discussions, group chat, and a knowledge base.

**For the protocol:** Relay Outpost demonstrates that relays can be more than dumb pipes. By implementing NIP-70 protected events, NIP-42 AUTH, NIP-86 moderation, NIP-29 group chat, NIP-52 calendar events, NIP-58 badges, and Blossom media routing at the client level, it validates protocol features that benefit the broader ecosystem.

**For developers:** The codebase is a working reference for over 25 NIPs in a production client. If you're building a Nostr app and need to see how NIP-17 gift-wrap DMs, NIP-29 group chat, NIP-58 badges, or NIP-86 relay management actually work end-to-end, the code is here — readable, forkable, and MIT-licensed.

### Interoperability

- Works with any Nostr relay (no proprietary extensions required)
- Supports standard NIP-07 browser extensions and NIP-46 remote signers
- Events published from Relay Outpost are standard Nostr events readable by any client
- Blossom media uploads use the open Blossom protocol — files are accessible from any client
- GrapeRank scores and profile search come from Brainstorm's public API — not a closed system
- Calendar events use standard NIP-52 kinds — discoverable by any NIP-52-aware client
- NIP-29 group messages are standard relay-based events — interoperable with other NIP-29 clients

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui, Radix UI |
| Nostr | nostr-tools, Applesauce SDK |
| Backend | Express.js, Node.js |
| Database | PostgreSQL (Drizzle ORM) |
| Rich Text | Tiptap |
| Media | HLS.js, sharp |
| State | Applesauce EventStore, TanStack Query |
| Search | Brainstorm MeiliSearch (2.7M+ profiles) |
| Caching | IndexedDB, sessionStorage, in-memory LRU |

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- A NIP-07 browser extension (e.g., Alby, nos2x) or NIP-46 remote signer

### Installation

```bash
git clone https://github.com/megistusXYZ/relay-outpost-xyz.git
cd relay-outpost-xyz
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/relay_outpost
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NODE_ENV` | No | `production` serves the built SPA; unset/`development` runs Vite with HMR |
| `PORT` | No | HTTP port to listen on (default `5000`) |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins; set to your domain(s) in production |
| `PODCAST_INDEX_API_KEY` | No | Podcast Index API key for podcast search |
| `PODCAST_INDEX_API_SECRET` | No | Podcast Index API secret |
| `KLIPY_API_KEY` | No | KLIPY (Tenor-compatible) API key for GIF search |
| `BETA_ACCESS_CODE` | No | Access code checked by `/api/beta/verify` for a private beta |
| `VITE_BETA_GATE` | No | Build-time flag; unset/`0` = no gate (public, default), `1` = require a code on the landing page |

A ready-to-copy [`.env.example`](.env.example) is included — `cp .env.example .env` and fill in `DATABASE_URL`.

### Database Setup

```bash
npm run db:push
```

### Development

```bash
npm run dev
```

The app runs on port 5000 by default.

### Production Build

```bash
npm run build
npm start
```

### Run your own outpost (Docker)

The fastest way to self-host the whole stack (app + PostgreSQL):

```bash
cp .env.example .env        # optional — compose ships sane defaults
docker compose up --build   # builds the image, starts Postgres, applies the schema
```

Then open `http://localhost:5000`. The app container runs `npm run db:push` on start
(idempotent) and serves the built SPA + API from a single Node process. Put a reverse
proxy (Caddy/nginx) in front for TLS and set `ALLOWED_ORIGINS` to your domain in
production.

Prefer to run it directly? `npm install → npm run db:push → npm run build → npm start`
against any Node 20+ host and a Postgres database.

**Don't want to host the whole UI?** You can keep using the public app and point only the
**scheduler** at your own backend: run this server yourself, set its `ALLOWED_ORIGINS` to the
public app's domain, then in the app go to **Settings → Network → Scheduler server** and enter
your server's URL. Server-scheduled posts then go to *your* database instead of the operator's.
(On-device scheduling never touches any server.)

**Optional external services.** Web of Trust (GrapeRank/Brainstorm), profile search, and
Nostr Archives are proxied to public services by default — nothing to configure, and the
app degrades gracefully if they're unavailable. Run your own if you'd rather not depend
on them.

---

## Architecture

```
├── client/                  # React frontend
│   └── src/
│       ├── components/      # UI components (shadcn/ui based)
│       │   ├── calendar/    # Content calendar components
│       │   ├── icons/       # Custom SVG icon components
│       │   └── ui/          # shadcn/ui primitives
│       ├── contexts/        # React contexts (auth, GrapeRank, media, notifications)
│       ├── hooks/           # Custom hooks (badges, attestations, feeds)
│       ├── lib/             # Core libraries
│       │   ├── nostr.ts     # Relay pool, subscriptions, caching
│       │   ├── nip11.ts     # NIP-11 relay info with Blossom server parsing
│       │   ├── nip29.ts     # NIP-29 group chat protocol helpers
│       │   ├── nip42-auth.ts    # NIP-42 AUTH handler
│       │   ├── nip58-badges.ts  # NIP-58 badge lifecycle
│       │   ├── nip78-settings.ts # NIP-78 app-specific data
│       │   ├── calendar-events.ts   # NIP-52 calendar event helpers
│       │   ├── calendar-feeds.ts    # iCal feed parsing and management
│       │   ├── schedule.ts          # Post scheduling API
│       │   ├── schedule-crypto.ts   # AES-GCM encryption for scheduled posts
│       │   ├── outpost-relays.ts    # Outpost relay management
│       │   ├── outbox.ts    # Outbox-model relay routing
│       │   ├── brainstorm-search.ts # Brainstorm profile search, WoT batch, bulk prefetch
│       │   ├── graperank.ts # GrapeRank WoT integration
│       │   ├── dm.ts        # NIP-17 DM sending (gift-wrap, NIP-44)
│       │   ├── dm-cache.ts  # IndexedDB message/conversation cache
│       │   ├── media-upload.ts  # Blossom + nostr.build uploads
│       │   ├── spam-filter.ts   # Spam/WoT filtering
│       │   └── zap.ts       # Lightning zap utilities
│       └── pages/           # Route pages
├── server/                  # Express backend
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # API routes (OG proxy, LNURL, podcasts, GIFs, iCal, streams, Brainstorm proxy)
│   ├── scheduler.ts         # Server-side post scheduler (60s cron)
│   └── db.ts                # Database connection
└── shared/                  # Shared types and schemas
    └── schema.ts            # Drizzle ORM schema (scheduled_posts, etc.)
```

The frontend connects directly to Nostr relays — the Express backend serves as a lightweight proxy layer for CORS-restricted APIs (OpenGraph metadata, LNURL resolution, podcast search, GIF search, iCal feeds, HLS streams) and runs the post scheduling engine. No user data beyond scheduled posts is stored server-side, and those are encrypted client-side before transmission.

---

## Contributing

Contributions are welcome. This is an open-source project built for the Nostr community — whether you're fixing a bug, adding a feature, improving documentation, or porting a NIP implementation, we'd love your help.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

### Areas Where Help is Appreciated

- **NIP implementations** — there are always more NIPs to support
- **Mobile UX** — improving touch interactions, responsiveness, and mobile-specific flows
- **Relay operator tools** — expanding the Relay Ops Center with new management capabilities
- **Accessibility** — making the app more usable for everyone
- **Translations** — localizing the interface for non-English speakers
- **Testing** — adding coverage for core flows
- **Documentation** — improving guides, inline help, and the WTF knowledge base

For bug reports and feature requests, please open an issue.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Support

Relay Outpost is independently developed and MIT-licensed. If it's useful to you, here's how to help keep it going:

- **Zap it on Nostr** — `⚡ <your-lightning-address>` (e.g. `you@getalby.com`)  ·  npub: `<your-npub>`
- **Sponsor** — [GitHub Sponsors](https://github.com/sponsors/megistusXYZ)
- **Spread the word** — share it with your community
- **Contribute** — code, docs, translations, or testing (see [Contributing](#contributing))
- **Run a relay** and use Relay Outpost as your community's client

Grant and ecosystem support from organizations backing open-source Nostr development is welcome — including [OpenSats](https://opensats.org), [HRF](https://hrf.org/devfund), and [Spiral](https://spiral.xyz).

> Maintainer note: replace the `<your-lightning-address>`, `<your-npub>`, and Sponsors handle above with your real details before publishing.
