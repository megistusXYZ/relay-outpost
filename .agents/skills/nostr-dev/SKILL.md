---
name: nostr-dev
description: Nostr protocol development rules, Applesauce SDK patterns, relay architecture, spam filtering, visual branding conventions, and feed system design. Use when building, debugging, or extending any Nostr-related feature in this application.
---

# Nostr Developer Skill & Knowledge Base

## 1. Agent Role & Context
You are an expert full-stack developer specializing in the **Nostr protocol**, React, TypeScript, and the **Applesauce SDK**. Your objective is to build, debug, and architect robust, interoperable Nostr applications within a Replit environment.

You follow the architectural patterns established by production-grade clients like **noStrudel** (`hzrd149/nostrudel`). Nostr is a decentralized pub/sub network over WebSockets. There are no HTTP REST APIs; all core data is fetched and published via WebSockets (`wss://`).

## 2. Core Protocol Rules (NIP-01)
**Reference:** [nostrbook.dev/protocol](https://nostrbook.dev/protocol/)

### The Nostr Event Schema
Everything in Nostr is an Event. Events are immutable JSON objects. **Never mutate an event after it is signed**, or you will invalidate the signature (`sig`) and relays will reject it.
```json
{
  "id": "<32-byte hex sha256 of the serialized event data>",
  "pubkey": "<32-byte hex public key of the creator>",
  "created_at": "<unix timestamp in seconds>",
  "kind": "<integer>",
  "tags": [
    ["e", "<32-byte hex event id>", "<relay url>", "<marker>"],
    ["p", "<32-byte hex pubkey>", "<relay url>"],
    ["d", "<identifier>"]
  ],
  "content": "<arbitrary string or JSON>",
  "sig": "<64-byte hex schnorr signature>"
}
```

### Filters (Querying Relays)
Filters act as the API query. `#` plus a single letter (like `#d`) searches for events containing that specific tag.
```json
{
  "authors": ["<hex_pubkey>"],
  "kinds": [1, 31990],
  "#d": ["<identifier>"],
  "limit": 100
}
```

## 3. Kinds, NIP-19, & Interoperability
**Reference:** [nostrhub.io](https://nostrhub.io/) | [nostrbook.dev/kinds](https://nostrbook.dev/kinds/)

- **Regular (1000-9999):** Appended to database. Cannot be edited.
- **Replaceable (10000-19999):** Relays only keep the *newest* event per `pubkey`.
- **Parameterized Replaceable (30000-39999) [NIP-33]:** Relays keep the newest event based on `pubkey`, `kind`, AND a `d` tag identifier.

### Decoding `naddr`:
Nostr relays require **Hexadecimal**, but UIs use **Bech32** (`npub1...`, `naddr1...`).
To fetch a NIP-33 event from an `naddr`:
1. Use `nip19.decode("naddr1...")` from `nostr-tools`.
2. Destructure to get `data.pubkey`, `data.kind`, and `data.identifier`.
3. Construct filter: `{"authors": [pubkey], "kinds": [kind], "#d": [identifier]}`

## 4. Architecture Rules

### Rule 1: Strict Separation of Nostr Logic from UI Components
Nostr data is decentralized, inherently untrusted and often malformed. **Never parse Nostr event tags directly inside React components.** Create dedicated "Helper" files to extract and validate data.

*Example Helper Pattern (`src/helpers/nostr/app-handlers.ts`):*
```typescript
import { NostrEvent } from "nostr-tools";

export const APP_HANDLER_KIND = 31990;

export function getAppName(event: NostrEvent): string {
  const name = event.tags.find(t => t[0] === "name")?.[1];
  if (!name) throw new Error("Missing app name");
  return name;
}

export function validateAppHandler(event: NostrEvent): boolean {
  try {
    getAppName(event);
    return true;
  } catch (e) {
    return false;
  }
}
```

### Rule 2: Applesauce Reactive State
Do not stuff raw Nostr events into standard React `useState`.
- **`EventStore`:** Instantiate `applesauce-core` globally. It acts as an in-memory deduplicating database.
- **React Hooks:** Use `applesauce-react` hooks (like `useStoreQuery`) to bind the `EventStore` directly to the UI.
- **CRITICAL:** Always wrap Applesauce query objects in `useMemo` to prevent infinite re-renders.

### Rule 3: The "Outbox Model" (NIP-65)
Do not hardcode a single static list of global relays. To scale properly:
1. Lookup a user's NIP-65 Relay List (Kind `10002`).
2. Fetch events *authored by* the user from their **Write (Outbox)** relays.
3. Send replies *to* the user to their **Read (Inbox)** relays.

### Rule 4: Error Boundaries & Graceful Degradation
If a single Nostr event is malformed by a bad client, it should crash that specific list item, NOT the entire page grid. Always wrap individual feed items or complex Nostr views in React `<ErrorBoundary />` components.

## 5. Security & Signers
- **Never handle raw `nsec` (private keys) in the UI.** Do not ask users to paste them.
- Rely on **NIP-07** (`window.nostr.signEvent`) for browser extension signing.
- Support **NIP-46** remote signers (nsecBunker, Amber) via `applesauce-signers`.
- Use `applesauce-signers` to abstract signer logic away from the core UI.

## 6. Relay Connection (nostr-tools v2)
**CRITICAL:** Strictly use `nostr-tools` version 2.x syntax. Do NOT write deprecated v1 code (e.g., do not use `relay.connect()`, `relayPool.sub()`, or the old `signEvent` function from the core library).

### Current Implementation
This project uses `nostr-tools` `SimplePool` for relay connections. This is stable and battle-tested.

**Future direction:** For new features, prefer Applesauce `RelayPool` when it provides clear benefits (e.g., built-in outbox routing). Do not migrate existing working SimplePool code unless there's a concrete reason.

```typescript
import { EventStore } from "applesauce-core";
import { SimplePool } from "nostr-tools";

export const eventStore = new EventStore();
export const pool = new SimplePool();

export function subscribeToData(filters: any[], relays: string[]) {
  const sub = pool.subscribeMany(relays, filters, {
    onevent(event) {
      eventStore.add(event);
    },
    oneose() {
      sub.close();
    }
  });
  return sub;
}
```

### Event Publishing (v2 Syntax)
```typescript
import { finalizeEvent, verifyEvent } from "nostr-tools";

// NIP-07 Browser Extension
// const signedEvent = await window.nostr.signEvent(eventTemplate);

if (verifyEvent(signedEvent)) {
  pool.publish(relays, signedEvent);
}
```

## 7. Handling Unfamiliar NIPs (Anti-Hallucination)
There are 100+ active NIPs. This document only covers core foundations.
If asked to implement a specific feature for an unfamiliar NIP:
1. **Do NOT guess the schema, kind numbers, or tag arrays.**
2. Stop and ask the user to provide the exact NIP specification link (from `https://github.com/nostr-protocol/nips`).
3. Once the schema is provided, strictly follow **Rule 1 (The Helper Pattern)** to parse it safely.

## 8. Project-Specific: Spam Filtering System
Located in `client/src/lib/spam-filter.ts`. Multi-layer system for the global firehose feed.

### Critical Rule: Followed Users Bypass Quality Filters
The follow-bypass applies to quality heuristic filters (machine-readable content, no-profile, follower count). Spam list lookups, mute lists, and duplicate detection apply to all users regardless of follow status. This ensures followed users are never unfairly filtered by heuristics, while still enforcing explicit block/mute decisions.

### Filter Layers (in order)
1. **Machine-readable content detection** — Filters JSON blobs, base64 payloads, broadcast messages *(bypassed for followed users)*
2. **No-profile account filtering** — Loaded-but-empty profiles are filtered; unknown/not-yet-loaded profiles return `null` (pass-through) to prevent over-filtering during initial load *(bypassed for followed users)*
3. **Follower count threshold** — 20+ followers required for global firehose, fetched via Primal Cache *(bypassed for followed users)*
4. **Nostr.Band spam API** — Known spammer list *(applies to all users)*
5. **Web-of-Trust (WoT) scoring** — Trust graph analysis
6. **User-defined mutes** — Muted pubkeys and keywords *(applies to all users)*
7. **Duplicate content detection** — Near-duplicate text matching *(applies to all users)*

### Primal Cache Integration (`client/src/lib/primal-cache.ts`)
- Endpoint: `wss://cache.primal.net/v1`
- Batch follower count fetching: 300ms debounced, 50 pubkeys per batch
- 10-minute TTL cache
- Reactive UI updates via listener pattern

## 9. Project-Specific: Feed Architecture
Space-themed feed system with four built-in feeds:
- **Raw Signal** — Global firehose (spam filters apply)
- **Deep Scan** — Trending content
- **Transmission** — Follows only, no replies
- **Open Comms** — Follows + replies

### Feed Mechanics
- Cursor-based pagination using `created_at` timestamps
- "Show N new posts" buffer — new events queue above the fold, user clicks to reveal
- Infinite scroll with `IntersectionObserver`
- Custom "Saved Frequencies" with hashtag, author, keyword (include/exclude), and content type filters, persisted in PostgreSQL

## 10. Project-Specific: Visual Branding Conventions
All pages must follow the unified dark aesthetic with purple accents.

### Card Styling
- Use `glass-card` class on all `<Card>` components for frosted-glass appearance
- Never use plain `bg-card` or `bg-card/50` on cards — always `glass-card`

### Page Headers
- Icon: Use appropriate Lucide icon with `text-purple-400/80` color
- Title: `font-brand tracking-wider uppercase` class
- Consistent across all pages (Feed, Images, Articles, RSS, Audio, Relays, Console, etc.)

### Loading States
- Use `RelayOutpostLoader` component for branded loading (SVG animated logo)
- Use shadcn `<Skeleton>` for inline loading states within components
- Never show blank screens — always show branded skeleton or loader

### Content Truncation
- Posts exceeding 300 characters: truncate at word boundary with "Show more"/"Show less" toggle
- Applies to both main feed posts and thread replies

## 11. Project-Specific: Media Handling
- **Lazy loading:** All external media uses `IntersectionObserver` for viewport-based loading
- **NIP-94 Blurhash:** Decode `imeta` blurhash values into placeholder images while full images load. Dimension-aware containers prevent layout shift. Results cached in memory.
- **Media proxy:** Available as an optimization via Express backend for heavy feeds, but not mandatory for all images. Use judiciously based on performance needs.
- **YouTube embeds:** Use oEmbed API for thumbnail preview cards

## 12. Project-Specific: Relay Management
- WSS-only enforcement for all relay connections
- Connect/disconnect toggle per relay with localStorage persistence
- Default relays protected from deletion
- Health dashboard with latency testing at `/relays`
- NIP-65 outbox model: Background fetching of Kind 10002 relay lists for followed users, batched with 200ms delay in chunks of 50 pubkeys

## 13. Agent Coding Directives Checklist
Before completing any file generation, verify:
1. [ ] **Hex Conversion:** Did I convert any NIP-19 string (`npub`/`naddr`) to hex before querying a relay?
2. [ ] **Timestamps:** Are all generated timestamps in **seconds** (Unix epoch), not milliseconds?
3. [ ] **Immutability:** Am I mutating an event object after it's signed? (Never do this).
4. [ ] **Helpers:** Did I extract `event.tags.find` logic into a reusable, typed helper function outside the UI component?
5. [ ] **Memoization:** Did I wrap Applesauce query objects in `useMemo` to prevent infinite React loops?
6. [ ] **Cleanup:** Did I call `sub.close()` on unmount or on the `oneose` callback to prevent memory leaks?
7. [ ] **Branding:** Does the new page/component follow the `glass-card` + `font-brand` + purple accent conventions?
8. [ ] **Spam Bypass:** If this touches feed filtering, do followed users bypass all quality filters?
9. [ ] **Loading State:** Is there a branded loader or skeleton for all async states?
