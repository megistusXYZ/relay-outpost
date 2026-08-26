import { pool, eventStore, DEFAULT_RELAYS, verifySignedEventKind, filterBlockedRelays } from "@/lib/nostr";
import { queryAnswered } from "./relay-reach";
import { signWithTimeout } from "@/lib/signer-timeout";
import { throttledSubscribe } from "@/lib/relay-throttler";
import { getHealthyRelays, sortRelaysByScore } from "@/lib/relay-health";
import { getPrivateOutpostUrls } from "@/lib/outpost-relays";
import { selectRelaysByMode, type RelayPreference } from "@/lib/relay-prefs";
import type { Event } from "nostr-tools";

const KIND_RELAY_LIST = 10002;

// Re-exported for back-compat; the type + selection logic now live in relay-prefs.ts
// (dependency-free, so they're unit-testable without this module's relay graph).
export type { RelayPreference };

const relayListCache = new Map<string, RelayPreference[]>();
const fetchedPubkeys = new Set<string>();
let fetchQueue: string[] = [];
let fetchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY = 100;
/**
 * RELAY_LIST_RELAYS — discovery for Kind 10002 (NIP-65 relay list) and
 * Kind 10050 (NIP-17 DM relay list).
 *
 * Only the two specialized indexers that actively mirror these replaceable
 * metadata events:
 *  - `purplepag.es`     — dedicated profile/relay-list indexer.
 *  - `relay.nostr.band` — broad indexer that stores Kind 10002/10050 reliably.
 *
 * Do not add general-purpose relays here — they enforce REQ caps that produce
 * "too many concurrent REQs" notices under batch lookups, and they don't add
 * coverage these two indexers don't already provide. `relay.damus.io` was
 * removed in this audit for that reason.
 */
const RELAY_LIST_RELAYS = ["wss://purplepag.es", "wss://relay.nostr.band"];

/**
 * Broader discovery set for kind-10002 lookups. The two specialized indexers in
 * RELAY_LIST_RELAYS are the primary source, but a non-trivial number of users
 * only ever published their NIP-65 list to general relays. For single-profile
 * lookups (the Profile page) we widen to the app's general relays so the empty
 * "No relay list published" state is genuinely empty, not just an indexer miss.
 * Mirrors the breadth used by the kind-10050 DM fetch (RELAY_LIST_RELAYS + a few
 * general relays).
 */
function getRelayListDiscoveryRelays(): string[] {
  const set = new Set<string>(RELAY_LIST_RELAYS);
  for (const r of DEFAULT_RELAYS) set.add(r);
  return Array.from(set);
}

export function parseRelayList(event: Event): RelayPreference[] {
  const prefs: RelayPreference[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "r" && tag[1]) {
      const url = tag[1].trim();
      if (!url.startsWith("wss://")) continue;
      // Relay lists in the wild carry the literal "wss://" (empty host) and
      // similar husks; letting them through crashed new URL() downstream
      // (live report: unhandled "Invalid URL: wss://" on /profile).
      try {
        if (!new URL(url).hostname) continue;
      } catch {
        continue;
      }
      const marker = tag[2];
      if (marker === "read") {
        prefs.push({ url, mode: "read" });
      } else if (marker === "write") {
        prefs.push({ url, mode: "write" });
      } else {
        prefs.push({ url, mode: "both" });
      }
    }
  }
  return prefs;
}

const HEX_RE = /^[0-9a-f]{64}$/i;

function flushFetchQueue() {
  fetchTimer = null;
  const pubkeys = Array.from(new Set(fetchQueue)).filter((pk) => HEX_RE.test(pk));
  fetchQueue = [];
  if (pubkeys.length === 0) return;

  const chunks: string[][] = [];
  for (let i = 0; i < pubkeys.length; i += 50) {
    chunks.push(pubkeys.slice(i, i + 50));
  }

  // For small lookups (typically a single viewed profile) widen the discovery
  // set to the app's general relays — many users only published their NIP-65
  // list to general relays, not the specialized indexers. For large batch
  // lookups (feed prefetch) stick to the two indexers to avoid tripping the
  // "too many concurrent REQs" caps on general relays.
  const discoveryRelays = pubkeys.length <= 3
    ? getRelayListDiscoveryRelays()
    : RELAY_LIST_RELAYS;

  for (const chunk of chunks) {
    for (const relay of discoveryRelays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], { kinds: [KIND_RELAY_LIST], authors: chunk }, {
          onevent(event: Event) {
            eventStore.add(event);
            const existing = relayListCache.get(event.pubkey);
            if (!existing || event.created_at > (existing as any)._ts) {
              const prefs = parseRelayList(event);
              (prefs as any)._ts = event.created_at;
              relayListCache.set(event.pubkey, prefs);
            }
          },
          oneose() {
            closer.close();
          },
        });
      });
    }
  }
}

export function fetchRelayLists(pubkeys: string[], opts?: { force?: boolean }) {
  const force = opts?.force === true;
  const needed = force ? pubkeys : pubkeys.filter(pk => !fetchedPubkeys.has(pk));
  if (needed.length === 0) return;
  needed.forEach(pk => fetchedPubkeys.add(pk));
  fetchQueue.push(...needed);
  if (!fetchTimer) {
    fetchTimer = setTimeout(flushFetchQueue, BATCH_DELAY);
  }
}

export function getWriteRelays(pubkey: string, fallback: string[] = DEFAULT_RELAYS): string[] {
  const relays = selectRelaysByMode(relayListCache.get(pubkey), "write");
  return relays.length > 0 ? relays : fallback;
}

/**
 * Outbox floor for PUBLIC posts: union the user's picked relays with their
 * advertised NIP-65 write relays, so a curated selection (e.g. "3 outposts
 * only") can never make posts invisible to followers on other clients — they
 * resolve the author's outbox from kind-10002, not from this app's picker.
 * Deliberately falls back to [] (NOT DEFAULT_RELAYS): if no relay list is
 * cached we add nothing, rather than silently re-adding defaults the user
 * unchecked. Callers must skip this for protected / private-only posts.
 */
export function withOutboxFloor(selected: string[], pubkey: string | null | undefined): string[] {
  if (!pubkey) return selected;
  const outbox = getWriteRelays(pubkey, []);
  if (outbox.length === 0) return selected;
  const norm = (u: string) => u.replace(/\/+$/, "");
  return [...new Set([...selected.map(norm), ...outbox.map(norm)])];
}

/**
 * Uncapped variant of {@link getWriteRelays}. Used by paths that need to
 * reach every relay a user has ever written to (e.g. NIP-62 vanish), where
 * the 5-relay cap in `getWriteRelays` would leak coverage.
 */
export function getAllWriteRelays(pubkey: string, fallback: string[] = DEFAULT_RELAYS): string[] {
  const prefs = relayListCache.get(pubkey);
  if (!prefs || prefs.length === 0) return fallback;
  const writeRelays = prefs
    .filter(p => p.mode === "write" || p.mode === "both")
    .map(p => p.url);
  if (writeRelays.length === 0) return fallback;
  return writeRelays;
}

export function hasCachedRelayList(pubkey: string): boolean {
  const prefs = relayListCache.get(pubkey);
  return !!prefs && prefs.length > 0;
}

/**
 * Returns the created_at of the cached NIP-65 relay-list event for the
 * given pubkey, or 0 if none is cached. Used to detect cache refresh
 * without relying on mere "presence" of a (possibly stale) entry.
 */
export function getRelayListTimestamp(pubkey: string): number {
  const prefs = relayListCache.get(pubkey) as (RelayPreference[] & { _ts?: number }) | undefined;
  return prefs?._ts ?? 0;
}

export function getReadRelays(pubkey: string, fallback: string[] = DEFAULT_RELAYS): string[] {
  const relays = selectRelaysByMode(relayListCache.get(pubkey), "read");
  return relays.length > 0 ? relays : fallback;
}

export function getOutboxRelaysForAuthors(pubkeys: string[], maxPerAuthor: number = 2): string[] {
  const relaySet = new Set<string>();
  for (const pk of pubkeys) {
    const writeRelays = getWriteRelays(pk, []);
    for (const url of writeRelays.slice(0, maxPerAuthor)) {
      relaySet.add(url);
    }
  }
  if (relaySet.size === 0) return DEFAULT_RELAYS.slice(0, 5);
  const result = Array.from(relaySet);
  if (result.length < 3) {
    for (const r of DEFAULT_RELAYS) {
      if (!relaySet.has(r)) result.push(r);
      if (result.length >= 5) break;
    }
  }
  return result.slice(0, 8);
}

export function getUserNotesFetchRelays(pubkey: string, max: number = 6): string[] {
  const writeRelays = getWriteRelays(pubkey, []);
  const merged = new Set<string>();
  for (const r of writeRelays) merged.add(r);
  for (const r of DEFAULT_RELAYS) merged.add(r);
  const filtered = filterBlockedRelays(Array.from(merged));
  const healthy = getHealthyRelays(filtered);
  const sorted = sortRelaysByScore(healthy);
  const writeSet = new Set(writeRelays);
  const prioritized: string[] = [];
  for (const r of sorted) if (writeSet.has(r)) prioritized.push(r);
  for (const r of sorted) if (!writeSet.has(r)) prioritized.push(r);
  return prioritized.slice(0, max);
}

export function getRelayList(pubkey: string): RelayPreference[] {
  return relayListCache.get(pubkey) || [];
}

export function getRelayListMeta(pubkey: string): { prefs: RelayPreference[]; ts: number; attempted: boolean } {
  const prefs = relayListCache.get(pubkey) || [];
  const ts = ((prefs as any)._ts as number | undefined) ?? 0;
  return { prefs, ts, attempted: fetchedPubkeys.has(pubkey) };
}

export function hasRelayList(pubkey: string): boolean {
  return relayListCache.has(pubkey);
}

export function getRelayListStats(): { cached: number; fetched: number } {
  return { cached: relayListCache.size, fetched: fetchedPubkeys.size };
}

const KIND_DM_RELAY_LIST = 10050;
const DM_RELAY_LS_KEY = "relay_outpost_dm_relays";

const dmRelayCache = new Map<string, string[]>();
const dmRelayNegativeCache = new Map<string, number>();
// Short: a chat UX must pick up a freshly-published kind-10050 quickly. Long
// enough only to avoid hammering indexers within a tight render loop.
const DM_NEGATIVE_CACHE_TTL = 30 * 1000;

function parseDMRelayList(event: Event): string[] {
  const relays: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "relay" && tag[1] && tag[1].startsWith("wss://")) {
      relays.push(tag[1]);
    }
  }
  return relays;
}

export function getDMRelayListCached(pubkey: string): string[] {
  return dmRelayCache.get(pubkey) || [];
}

export function hasDMRelayList(pubkey: string): boolean {
  const cached = dmRelayCache.get(pubkey);
  return !!cached && cached.length > 0;
}

export async function fetchDMRelayList(
  pubkey: string,
  opts?: { force?: boolean },
): Promise<string[]> {
  const cached = dmRelayCache.get(pubkey);
  if (cached && cached.length > 0) return cached;

  // force bypasses the negative cache so an explicit send always re-checks for a
  // freshly-published kind-10050 (keeps the positive cache).
  if (!opts?.force) {
    const negTs = dmRelayNegativeCache.get(pubkey);
    if (negTs && Date.now() - negTs < DM_NEGATIVE_CACHE_TTL) return [];
  }

  // A kind-10050 lives in its OWNER'S outbox (NIP-17) — the two indexers are a
  // shortcut, not the source of truth, and one of them was measured simply not
  // holding a 10050 that damus had. So before concluding anything, make sure
  // we actually KNOW the target's outbox: if their NIP-65 isn't cached yet
  // (cold thread open — the exact case), fetch it now and wait. Skipping this
  // made the discovery set collapse to the two indexers, both of which
  // ANSWERED honestly about their own emptiness — so the `answered` guard
  // passed and we confidently told the sender "this user hasn't published a
  // DM relay list" about a list sitting on the user's own relays. A reachable
  // relay can answer a question that cannot contain your answer.
  if (getWriteRelays(pubkey, []).length === 0) {
    try {
      const { events: nip65 } = await queryAnswered(getRelayListDiscoveryRelays(), {
        kinds: [KIND_RELAY_LIST],
        authors: [pubkey],
        limit: 1,
      });
      if (nip65.length > 0) {
        nip65.sort((a, b) => b.created_at - a.created_at);
        const prefs = parseRelayList(nip65[0]);
        (prefs as RelayPreference[] & { _ts?: number })._ts = nip65[0].created_at;
        relayListCache.set(pubkey, prefs);
      }
    } catch { /* no outbox knowledge — the wider fallback set below still applies */ }
  }

  const discoveryRelays = [...RELAY_LIST_RELAYS];
  const userWriteRelays = getWriteRelays(pubkey, []);
  for (const r of userWriteRelays.slice(0, 2)) {
    if (!discoveryRelays.includes(r)) discoveryRelays.push(r);
  }
  const userReadRelays = getReadRelays(pubkey, []);
  for (const r of userReadRelays.slice(0, 2)) {
    if (!discoveryRelays.includes(r)) discoveryRelays.push(r);
  }
  // The big general relays are where most clients' defaults put a 10050
  // (Amethyst included) — and they are already this module's DM fallback set,
  // so asking them costs nothing new and catches the user whose indexer
  // coverage is thin. Found live: a 10050 on damus/nos.lol that neither
  // indexer had, rendered as "their app hasn't said where to deliver".
  for (const r of DM_FALLBACK_RELAYS) {
    if (!discoveryRelays.includes(r)) discoveryRelays.push(r);
  }

  try {
    const { events, answered } = await queryAnswered(discoveryRelays, {
      kinds: [KIND_DM_RELAY_LIST],
      authors: [pubkey],
      limit: 1,
    });

    if (events.length > 0) {
      events.sort((a, b) => b.created_at - a.created_at);
      const relays = parseDMRelayList(events[0]);
      dmRelayCache.set(pubkey, relays);
      dmRelayNegativeCache.delete(pubkey);
      return relays;
    }
    // ZERO EVENTS IS NOT AN ANSWER UNTIL SOMEONE ANSWERED.
    //
    // "Confirmed empty" means the relays ANSWERED (a real EOSE) and had
    // nothing — not merely that the query resolved. Two failure modes used to
    // land here and be filed as fact: an unreachable relay set (querySync
    // resolves [] without throwing), and a reachable relay that REFUSES the
    // REQ — nostr-tools reports `CLOSED auth-required` as an ordinary
    // end-of-stream. The interim fix probed `canReachAny` after the fact,
    // which caught the first mode but not the second: a relay you can
    // connect to has still not answered the question it declined.
    //
    // The cost was not subtle. Two accounts created in THIS app, both of which
    // publish a kind-10050 at signup, were told about each other: "Their app
    // hasn't said where to deliver private messages — this chat may not reach
    // them." We asserted a stranger's app was incompatible on the strength of a
    // question we never got to ask, about a list we had written ourselves.
    //
    // `wasDMRelayListConfirmedEmpty` is also what auto-publish keys off, and a
    // kind-10050 is REPLACEABLE — so a false "confirmed empty" could overwrite
    // the user's real DM inbox routing with a guess.
    if (answered) dmRelayNegativeCache.set(pubkey, Date.now());
    return [];
  } catch (err) {
    // Kept for a GENUINE throw (malformed filter, aborted pool). The
    // unreachable case is handled above, where it actually occurs.
    console.warn("[DM Relay List] Failed to fetch:", err);
    return [];
  }
}

/**
 * True only after a SUCCESSFUL kind-10050 query that found nothing (a real
 * "user has no DM relay list"), not after a network error. Used by auto-publish.
 */
export function wasDMRelayListConfirmedEmpty(pubkey: string): boolean {
  return dmRelayNegativeCache.has(pubkey);
}

export function getLocalDMRelays(): string[] {
  try {
    const raw = localStorage.getItem(DM_RELAY_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function setLocalDMRelays(relays: string[]) {
  try {
    localStorage.setItem(DM_RELAY_LS_KEY, JSON.stringify(relays));
  } catch {}
}

export async function publishDMRelayList(
  relays: string[],
  signer: any,
): Promise<boolean> {
  const tags = relays.map((r) => ["relay", r]);
  const event = {
    kind: KIND_DM_RELAY_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  try {
    const signed = await signWithTimeout(signer, event);
    if (!verifySignedEventKind(signed, KIND_DM_RELAY_LIST)) {
      console.error("[DM Relay List] Signer returned wrong event kind");
      return false;
    }
    const { publishEvent } = await import("@/lib/nostr");
    const ok = await publishEvent(signed);
    if (ok) {
      const pubkey = signed.pubkey;
      dmRelayCache.set(pubkey, relays);
      setLocalDMRelays(relays);
    }
    return ok;
  } catch (err) {
    console.error("[DM Relay List] Failed to publish:", err);
    return false;
  }
}

// Broad, generalist relays used as a last resort for DM delivery/discovery.
// Single source of truth — mirrored by Settings' default DM relay suggestions.
// Open fallback relays only — widen DM reach when a recipient hasn't published a NIP-17
// inbox. AUTH-required relays (auth.nostr1.com, relay.nsec.app) are deliberately NOT in
// this blind set: publishing to them unprompted just fails NIP-42 AUTH and alarms the
// sender for no reason. They're still used when they ARE the recipient's chosen inbox
// (pinned from their kind-10050 in getDMRelaysForContact).
export const DM_FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

// ── Own kind-10050 inbox: advertise + AUTH scope ─────────────────────────────

const DM_AUTOPUB_KEY = (pk: string) => `relay_outpost_10050_autopub_${pk}`;
const dmAutopubInFlight = new Set<string>();

/**
 * The relays the user has explicitly chosen as their DM inbox: their published
 * kind-10050 (authoritative) plus locally-configured DM relays. This is the
 * TIGHT set — a strict subset of getMyDMReceiveRelays — used to scope receive-
 * side auto-AUTH: we prove our identity ONLY to relays we ourselves designated
 * as our mailbox (reading your own mail legitimately requires it), never to the
 * broader read/write/fallback relays folded into the receive set.
 */
/** Whether we've already auto-published our own kind-10050 inbox (success flag).
 *  Single source for the localStorage key, shared with the SELF-banner check. */
export function wasOwnDMInboxAutopublished(myPubkey: string): boolean {
  try { return localStorage.getItem(DM_AUTOPUB_KEY(myPubkey)) === "1"; } catch { return false; }
}

export function getOwnDMInboxRelays(myPubkey: string): string[] {
  const set = new Set<string>();
  for (const r of getDMRelayListCached(myPubkey)) set.add(r);
  for (const r of getLocalDMRelays()) set.add(r);
  return Array.from(set);
}

/**
 * Ensure the user advertises a kind-10050 DM inbox so OTHER clients (Amethyst,
 * etc.) know where to deliver gift wraps. Publishes once per install (localStorage
 * flag, set only on success) and only when a forced fetch confirms none exists —
 * never clobbering an inbox the user set elsewhere, and never on a network error.
 * Moved out of the Messages page so it can run at load (not just on first Chats
 * open): a user who never opened Chats had no advertised inbox, so cross-client
 * DMs to them were dropped. The advertised set is the user's chosen DM relays
 * (small, per NIP-17's 1–3 SHOULD), which getMyDMReceiveRelays always subscribes
 * to — so senders deliver exactly where the background receiver is listening.
 */
export async function ensureOwnDMRelayList(myPubkey: string, signer: any): Promise<void> {
  if (!myPubkey || !signer?.nip44) return;
  if (dmAutopubInFlight.has(myPubkey)) return; // guard double-mount / reconnect re-run
  try {
    if (localStorage.getItem(DM_AUTOPUB_KEY(myPubkey)) === "1") return;
  } catch {}
  dmAutopubInFlight.add(myPubkey);
  try {
    const existing = await fetchDMRelayList(myPubkey, { force: true });
    if (existing.length > 0) {
      try { localStorage.setItem(DM_AUTOPUB_KEY(myPubkey), "1"); } catch {}
      return;
    }
    if (!wasDMRelayListConfirmedEmpty(myPubkey)) return; // query errored — retry later
    const local = getLocalDMRelays();
    // NIP-17 SHOULD: keep the list small (1–3 relays).
    const toPublish = (local.length > 0 ? local : DM_FALLBACK_RELAYS).slice(0, 3);
    const ok = await publishDMRelayList(toPublish, signer);
    if (ok) {
      try { localStorage.setItem(DM_AUTOPUB_KEY(myPubkey), "1"); } catch {}
    }
  } catch {
    /* transient — a later call retries; the success-only flag prevents dup publishes */
  } finally {
    dmAutopubInFlight.delete(myPubkey);
  }
}

function rankRelays(urls: Iterable<string>): string[] {
  return sortRelaysByScore(
    getHealthyRelays(filterBlockedRelays(Array.from(new Set(urls)))),
  );
}

/**
 * Relays to PUBLISH a gift wrap to a contact (NIP-65 inbox model, Wisp-style).
 * The recipient's published kind-10050 inbox relays are authoritative and pinned
 * first; with none, fall back to their NIP-65 read AND write relays plus broad
 * defaults. The sender's own DM relays are always included (self-copy + symmetry).
 */
export function getDMRelaysForContact(
  contactPubkey: string,
  myPubkey?: string,
): string[] {
  const contactDm = getDMRelayListCached(contactPubkey);
  const rest = new Set<string>();

  if (contactDm.length === 0) {
    for (const r of getReadRelays(contactPubkey, []).slice(0, 4)) rest.add(r);
    for (const r of getWriteRelays(contactPubkey, []).slice(0, 4)) rest.add(r);
    for (const r of DM_FALLBACK_RELAYS) rest.add(r);
  }
  if (myPubkey) {
    for (const r of getLocalDMRelays()) rest.add(r);
    for (const r of getDMRelayListCached(myPubkey)) rest.add(r);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  // Recipient inbox first (authoritative), then health/score-ranked remainder.
  // filterBlockedRelays applies to the pinned set too (subscribe paths don't
  // re-filter the way publishEvent does).
  for (const r of [...filterBlockedRelays(contactDm), ...rankRelays(rest)]) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out.slice(0, 12);
}

// Broadened popular set for NOTIFICATION reception. A mention/reaction/zap
// reaches you either via your NIP-65 read relays (outbox-model clients like
// Amethyst publish a p-tagged event to the recipient's read relays) OR by being
// broadcast to a big generalist relay — so we union both. Open relays only (no
// AUTH-gated ones: notifications aren't worth an AUTH prompt on a blind read).
export const NOTIF_FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
];

/**
 * Relays to SUBSCRIBE for my own notifications (mentions/reactions/zaps/reposts/
 * replies, filter #p = me). My NIP-65 read relays are the correct inbox — an
 * outbox-model sender publishes the p-tagged event there so I see it — unioned
 * with a broadened popular fallback for clients that still broadcast widely.
 * Health/score-ranked and capped. Pure + synchronous (reads relay-list caches);
 * never empty (the fallback guarantees coverage before my NIP-65 list loads).
 */
export function getMyNotificationRelays(myPubkey: string, max = 6): string[] {
  const set = new Set<string>();
  for (const r of getReadRelays(myPubkey, []).slice(0, 6)) set.add(r);
  for (const r of NOTIF_FALLBACK_RELAYS) set.add(r);
  const ranked = rankRelays(set);
  // Guard: if every candidate is transiently unhealthy/blocked, fall back to the
  // raw popular set so notifications never go to an empty relay list.
  return (ranked.length ? ranked : NOTIF_FALLBACK_RELAYS).slice(0, max);
}

/**
 * Relays to RECEIVE my own gift wraps (filter #p = me). My published kind-10050
 * inbox is authoritative and pinned first, then broadened with my read + write
 * relays and fallbacks so wraps mis-routed by a sender are still found.
 */
export function getMyDMReceiveRelays(myPubkey: string, max = 12): string[] {
  const mine = getDMRelayListCached(myPubkey);
  const rest = new Set<string>();
  for (const r of getLocalDMRelays()) rest.add(r);
  for (const r of getReadRelays(myPubkey, []).slice(0, 5)) rest.add(r);
  for (const r of getWriteRelays(myPubkey, []).slice(0, 5)) rest.add(r);
  for (const r of DM_FALLBACK_RELAYS) rest.add(r);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of [...filterBlockedRelays(mine), ...rankRelays(rest)]) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out.slice(0, max);
}

export function getOptimalRelaysForFeed(pubkeys: string[], maxRelays: number = 6): string[] {
  const relayCoverage = new Map<string, Set<string>>();
  const privateUrls = getPrivateOutpostUrls();

  for (const pk of pubkeys) {
    const writeRelays = getWriteRelays(pk, []);
    for (const url of writeRelays.slice(0, 2)) {
      if (privateUrls.has(url.replace(/\/+$/, "").toLowerCase())) continue;
      let covered = relayCoverage.get(url);
      if (!covered) {
        covered = new Set();
        relayCoverage.set(url, covered);
      }
      covered.add(pk);
    }
  }

  if (relayCoverage.size === 0) return DEFAULT_RELAYS.slice(0, 5);

  const healthy = getHealthyRelays(Array.from(relayCoverage.keys()));
  const scored = healthy.map(url => ({
    url,
    coverage: relayCoverage.get(url)?.size ?? 0,
  }));
  scored.sort((a, b) => b.coverage - a.coverage);

  const selected: string[] = [];
  const coveredAuthors = new Set<string>();

  for (const { url } of scored) {
    if (selected.length >= maxRelays) break;
    const authors = relayCoverage.get(url);
    if (!authors) continue;
    let newCoverage = 0;
    for (const a of authors) {
      if (!coveredAuthors.has(a)) newCoverage++;
    }
    if (newCoverage > 0 || selected.length < 3) {
      selected.push(url);
      for (const a of authors) coveredAuthors.add(a);
    }
  }

  const coverageRatio = pubkeys.length > 0 ? coveredAuthors.size / pubkeys.length : 0;
  if (coverageRatio < 0.5 || selected.length < 3) {
    for (const r of DEFAULT_RELAYS) {
      if (!selected.includes(r)) selected.push(r);
      if (selected.length >= maxRelays) break;
    }
  }

  return sortRelaysByScore(selected).slice(0, maxRelays);
}
