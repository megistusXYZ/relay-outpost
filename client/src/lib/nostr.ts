import { EventStore } from "applesauce-core";
import { SimplePool } from "nostr-tools";
import type { Filter } from "nostr-tools";
import { throttledSubscribe } from "./relay-throttler";
import { markRelaySuccess, markRelayFailure, getHealthyRelays, sortRelaysByScore, fetchRelayLiveness, registerCoreRelays, sanitizeRelayUrls } from "./relay-health";
import { SubscriptionRegistry } from "./subscription-registry";
import { openResilientSub } from "./resilient-subscription";
import { putProfile, getAllProfiles, pruneOldProfiles } from "./indexeddb-cache";
import { setPoolRef, createPoolAuthHandler, createTemplateScopedAuthHandler, setOutpostUrlsProvider } from "./nip42-auth";
import { resolveSessionSigner } from "./session-signer";
import { armPlaneAuth, planeAuthForSubscription } from "./concord/concord-plane-auth";
import { getOutpostRelays } from "./outpost-relays";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "./signer-timeout";
import { parseAuthRequiredRelays } from "./nostr-helpers";
import type { PublishRejection } from "./publish-rejection";
import { recordFirstSeen } from "./account-age";
export { DEFAULT_RELAYS } from "./relay-constants";
import { DEFAULT_RELAYS } from "./relay-constants";

export const eventStore = new EventStore();
// enablePing: keepalive probes (browser fallback = a dummy REQ/EOSE roundtrip)
// stop NATs/proxies from idling out quiet sockets AND detect zombie sockets,
// closing them so… enableReconnect: …the relay auto-reconnects with backoff and
// re-fires every open subscription (since = last seen + 1). Without these, a
// dropped socket silently killed all "persistent" subscriptions — live Concord
// chat / DMs went deaf until a remount. See also openResilientPersistentSub.
export const pool = new SimplePool({ enablePing: true, enableReconnect: true });

/**
 * How long a read waits before nostr-tools is allowed to INVENT an end-of-stream.
 *
 * The vendor default is `baseEoseTimeout = 4400`, and the fabricated EOSE arrives
 * through the same `oneose` callback as a real one — so "the relay finished" and
 * "we got bored" are the same event to every caller in this app. A community
 * any relay slower than 4.4s therefore read as empty, and an operator was told
 * their four-channel community had no channels (#583). (The 8-12.5s figures
 * originally cited here were withdrawn: they were measured on a second socket
 * contending with this pool, not through it.)
 *
 * 10s is chosen against that measurement: comfortably past a slow-but-working
 * relay, and it only ever costs anything when a relay has gone silent — which is
 * precisely the case we must not mistake for an answer. A relay that fails to
 * CONNECT is unaffected; that path EOSEs immediately via handleClose.
 */
export const DEFAULT_READ_MAX_WAIT_MS = 10_000;

/**
 * Safe-by-default relay reads, installed once at the only place they all pass.
 *
 * `subscribeMap` is the single funnel in nostr-tools 2.23.1: subscribeMany →
 * subscribe → subscribeMap, and subscribeEose (hence querySync and get) →
 * subscribe → subscribeMap. Wrapping it once covers ~165 call sites and every
 * one added later.
 *
 * This is deliberately at the pool rather than at the call sites. The same two
 * omissions have now been found four times in four different surfaces — the
 * room list, the room interior, DM history, the moderator queues — because each
 * fix only ever reached the surface that reported the bug. A default that has to
 * be remembered is a default that will be forgotten.
 *
 * Both are opt-outable: an explicit `onauth` or `maxWait` in the params wins, so
 * callers that already tuned them (subscribeFilters' 20s, throttledPoolSubscribe's
 * 9500ms, fetchGroupMetadataResult's timeout+5s) keep their values.
 */
{
  const pooled = pool as unknown as {
    subscribeMap: (requests: unknown[], params: Record<string, unknown>) => { close(): void };
  };
  const originalSubscribeMap = pooled.subscribeMap.bind(pool);
  pooled.subscribeMap = (requests, params) =>
    originalSubscribeMap(requests, {
      ...params,
      // Per-relay gated even across a multi-relay read: the handler reads the
      // relay out of the auth template, so this never offers the user's pubkey
      // to a relay they have not opted into.
      onauth: params?.onauth ?? sharedSubscriptionAuth(),
      maxWait: params?.maxWait ?? DEFAULT_READ_MAX_WAIT_MS,
    });
}

setPoolRef(pool);
setOutpostUrlsProvider(() => new Set(getOutpostRelays().map(r => r.url.replace(/\/+$/, ""))));
pool.automaticallyAuth = createPoolAuthHandler();
// Same auth policy, but for SUBSCRIPTIONS. `automaticallyAuth` only covers relays
// that send an AUTH challenge on connect; a strict relay that instead rejects a REQ
// with `CLOSED auth-required` is only re-authed + re-subscribed when `onauth` is
// passed to subscribeMany (nostr-tools abstract-pool). Without it, gift-wrapped DMs
// from auth-required inbox relays (auth.nostr1.com, relay.nsec.app, …) are silently
// never received. createPoolAuthHandler keeps the per-relay gating (shouldAutoAuth →
// no pubkey leak to relays the user hasn't opted into).
const subscriptionAuth = createPoolAuthHandler();

/**
 * The `onauth` signer for a one-shot read, or undefined if this relay is not
 * one we auto-AUTH to.
 *
 * Exported because the recovery it enables is not optional on an auth-gated
 * relay: without `onauth` in the subscribe params, nostr-tools has no way to
 * answer a `CLOSED auth-required` — and because handleClose calls handleEose
 * FIRST, the caller sees a clean EOSE with zero events and reports a genuine
 * empty. That is how a community with four channels rendered as "No Chat Rooms
 * Found — be the first, create a channel!" to the person who runs it.
 */
export function subscriptionAuthFor(relayUrl: string) {
  return subscriptionAuth(relayUrl) || undefined;
}

/**
 * One `onauth` for a MULTI-relay read that still honours the per-relay gate.
 * The policy lives in nip42-auth (createTemplateScopedAuthHandler); this is the
 * name the read paths reach for.
 */
export function subscriptionAuthAcrossRelays() {
  return createTemplateScopedAuthHandler();
}

/**
 * The pool-wide default handler, made once rather than per subscription.
 *
 * Safe to share: createPoolAuthHandler's gate reads `globalSigner` and the
 * outpost/inbox providers at CALL time, so one instance never goes stale across
 * a sign-in, a sign-out, or a change to which relays are auto-AUTH eligible.
 */
let sharedAuthHandler: ReturnType<typeof createTemplateScopedAuthHandler> | null = null;
function sharedSubscriptionAuth() {
  sharedAuthHandler = sharedAuthHandler || createTemplateScopedAuthHandler();
  return sharedAuthHandler;
}

const BLOCKED_RELAYS_KEY = "nostr_blocked_relays";
const KIND_BLOCKED_RELAY_LIST = 10006;

let blockedRelaysSet = new Set<string>();

function normalizeRelayUrl(url: string): string {
  let u = url.trim().toLowerCase();
  if (u.startsWith("ws://")) u = "wss://" + u.slice(5);
  if (!u.startsWith("wss://")) u = "wss://" + u;
  if (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

function loadBlockedRelays(): Set<string> {
  try {
    const stored = localStorage.getItem(BLOCKED_RELAYS_KEY);
    if (!stored) return new Set();
    const arr: string[] = JSON.parse(stored);
    return new Set(arr.map(normalizeRelayUrl));
  } catch {
    return new Set();
  }
}

blockedRelaysSet = loadBlockedRelays();

function saveBlockedRelaysToStorage(relays: Set<string>) {
  localStorage.setItem(BLOCKED_RELAYS_KEY, JSON.stringify(Array.from(relays)));
}

export function getBlockedRelays(): string[] {
  return Array.from(blockedRelaysSet);
}

export function isRelayBlocked(url: string): boolean {
  return blockedRelaysSet.has(normalizeRelayUrl(url));
}

export function blockRelay(url: string) {
  blockedRelaysSet.add(normalizeRelayUrl(url));
  saveBlockedRelaysToStorage(blockedRelaysSet);
  try {
    const relayPool = pool as any;
    if (relayPool.relays) {
      const relay = relayPool.relays.get(url);
      if (relay) {
        relay.close();
        relayPool.relays.delete(url);
      }
    }
    if (relayPool._relays) {
      const relay = relayPool._relays.get(url);
      if (relay) {
        relay.close();
        relayPool._relays.delete(url);
      }
    }
  } catch {}
}

export function unblockRelay(url: string) {
  blockedRelaysSet.delete(normalizeRelayUrl(url));
  saveBlockedRelaysToStorage(blockedRelaysSet);
}

export function filterBlockedRelays(relays: string[]): string[] {
  if (blockedRelaysSet.size === 0) return relays;
  return relays.filter(r => !blockedRelaysSet.has(normalizeRelayUrl(r)));
}

export async function fetchBlockedRelayList(pubkey: string) {
  const relays = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];
  return new Promise<string[]>((resolve) => {
    let resolved = false;
    let latestEvent: any = null;
    let eoseCount = 0;
    const closers: Array<{ close(): void }> = [];

    const finalize = () => {
      if (latestEvent) {
        const urls = new Set<string>();
        for (const tag of latestEvent.tags) {
          if (tag[0] === "relay" && tag[1]) {
            urls.add(normalizeRelayUrl(tag[1]));
          }
        }
        blockedRelaysSet = urls;
        saveBlockedRelaysToStorage(blockedRelaysSet);
        resolve(Array.from(urls));
      } else {
        resolve([]);
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        for (const c of closers) { try { c.close(); } catch {} }
        finalize();
      }
    }, 8000);

    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], { kinds: [KIND_BLOCKED_RELAY_LIST], authors: [pubkey] }, {
          onevent(event: any) {
            if (!latestEvent || event.created_at > latestEvent.created_at) {
              latestEvent = event;
            }
          },
          oneose() {
            eoseCount++;
            closer.close();
            if (eoseCount >= relays.length && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              finalize();
            }
          },
        });
      });
      closers.push(closer);
    }
  });
}

export async function publishBlockedRelayList(blockedUrls: string[]): Promise<boolean> {
  const tags = blockedUrls.map(url => ["relay", url]);
  const eventTemplate = {
    kind: KIND_BLOCKED_RELAY_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  try {
    // Session signer, not window.nostr — the latter exists only for NIP-07
    // extension users, so this silently no-opped for local-key/PWA accounts.
    const signer = resolveSessionSigner();
    if (!signer) return false;
    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return false;
    return await publishEvent(signed);
  } catch {
    return false;
  }
}


/**
 * PROFILE_RELAYS — Kind 0 metadata fetches and short-lived profile lookups.
 *
 * Membership is intentionally specialized:
 *  - `purplepag.es`        — dedicated profile/relay-list indexer.
 *  - `relay.nostr.band`    — NIP-50 indexer that mirrors profile metadata.
 *  - `relay.damus.io`      — large general-purpose relay used as a fallback
 *                            so we still hit a generic relay even if the two
 *                            indexers are slow.
 *
 * `nos.lol` and `nostr.land` were removed: they're general-purpose relays
 * already covered by FAST_RELAYS and were a major contributor to the
 * "Too many concurrent REQs" rate-limit notices on `nos.lol`.
 */
export const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
];

/**
 * SEARCH_RELAYS — NIP-50 text search queries.
 *
 * Only relays that actually advertise/serve NIP-50 should live here.
 *  - `relay.nostr.band` — the strongest NIP-50 search relay.
 *  - `relay.damus.io`   — NIP-50 capable, kept as a fallback.
 *
 * `nos.lol` was removed: search wasn't a primary feature there and it
 * contributed to rate-limit notices.
 */
const SEARCH_RELAYS = [
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
];

/**
 * FAST_RELAYS — low-latency feed/notes/interactions reads.
 *
 * General-purpose relays selected for fan-out reads that need to come back
 * quickly. Kept deliberately tight.
 *
 * `nos.lol` was removed: it was the most-quoted hot relay across PROFILE,
 * SEARCH, and FAST and was the primary source of "Too many concurrent REQs"
 * notices. It remains in DEFAULT_RELAYS for publish-time broadcast diversity,
 * where the load is one-shot rather than streaming.
 */
export const FAST_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://nostr.land",
  "wss://relay.primal.net",
];

registerCoreRelays([...DEFAULT_RELAYS, ...PROFILE_RELAYS, ...SEARCH_RELAYS, ...FAST_RELAYS]);

const outpostUrls = getOutpostRelays().map((r) => r.url);
if (outpostUrls.length > 0) registerCoreRelays(outpostUrls);


export function getRelaysForPurpose(purpose: "profiles" | "search" | "notes" | "interactions" | "publish"): string[] {
  switch (purpose) {
    case "profiles": return filterBlockedRelays(sortRelaysByScore(getHealthyRelays(PROFILE_RELAYS)));
    case "search": return filterBlockedRelays(getHealthyRelays(SEARCH_RELAYS));
    case "interactions": return filterBlockedRelays(sortRelaysByScore(getHealthyRelays(FAST_RELAYS))).slice(0, 3);
    case "notes": return filterBlockedRelays(sortRelaysByScore(getHealthyRelays(FAST_RELAYS)));
    case "publish": return filterBlockedRelays(getHealthyRelays(DEFAULT_RELAYS));
  }
}

export function sortByLatency(relays: string[]): string[] {
  return sortRelaysByScore(relays);
}

const relayLastActivity = new Map<string, number>();

function trackRelayActivity(url: string) {
  relayLastActivity.set(url.replace(/\/+$/, ""), Date.now());
}

const EXEMPT_RELAYS = new Set([...PROFILE_RELAYS]);
const IDLE_CHECK_INTERVAL = 2 * 60 * 1000;
const IDLE_TIMEOUT = 5 * 60 * 1000;

let idleCleanupStarted = false;
export function startIdleConnectionCleanup() {
  if (idleCleanupStarted) return;
  idleCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [url, lastActive] of relayLastActivity) {
      if (EXEMPT_RELAYS.has(url)) continue;
      if (now - lastActive > IDLE_TIMEOUT) {
        try {
          pool.close([url]);
          relayLastActivity.delete(url);
        } catch {}
      }
    }
  }, IDLE_CHECK_INTERVAL);
}

export function warmRelayConnections() {
  const fastSet = new Set(FAST_RELAYS);
  const allRelays = filterBlockedRelays(Array.from(new Set([...DEFAULT_RELAYS, ...PROFILE_RELAYS])));
  const priority = allRelays.filter((u) => fastSet.has(u));
  const deferred = allRelays.filter((u) => !fastSet.has(u));

  function connectBatch(urls: string[]) {
    for (const url of urls) {
      const start = Date.now();
      pool.ensureRelay(url).then(() => {
        const elapsed = Date.now() - start;
        markRelaySuccess(url, elapsed);
        trackRelayActivity(url);
      }).catch(() => {
        markRelayFailure(url);
      });
    }
  }

  connectBatch(priority);
  if (deferred.length > 0) {
    setTimeout(() => connectBatch(deferred), 800);
  }
}

fetchRelayLiveness();
warmRelayConnections();

const HEX_RE = /^[0-9a-f]{64}$/i;
function isValidHex(s: string): boolean {
  return HEX_RE.test(s);
}

const globalProfileCache = new Set<string>();
const globalInteractionCache = new Set<string>();
const pendingProfileFetches = new Set<string>();
const pendingInteractionFetches = new Set<string>();

// ---- Profile-fetch resolution ledger --------------------------------------
// The three-state stranger profile gate (spam-filter.ts hideNoProfile) must
// distinguish "no profile YET" (kind-0 fetch still in flight → grace, hold)
// from "no profile, PERIOD" (fetch settled and nothing came back → the spam
// signal → drop). A pubkey lands here once its fetch batch has EOSE'd on every
// queried relay, or after a hard timeout so a hung relay can't park authors in
// the grace state forever. A kind-0 that arrives AFTER settling still wins:
// consumers check the event store first, settled-ness only classifies absence.
const settledProfileFetches = new Set<string>();
const PROFILE_SETTLE_TIMEOUT_MS = 10_000;

/** Has the kind-0 fetch for this pubkey completed (EOSE on all relays or
 *  timed out)? Only meaningful for pubkeys passed to fetchProfilesCached. */
export function isProfileFetchSettled(pubkey: string): boolean {
  return settledProfileFetches.has(pubkey);
}
let profileBatchTimer: ReturnType<typeof setTimeout> | null = null;
let interactionBatchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_DELAY = 30;

const PROFILE_SESSION_KEY = "nostr_profiles_cache";
const DEVICE_MEMORY = typeof navigator !== "undefined" && "deviceMemory" in navigator
  ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  : 8;
const PROFILE_SESSION_MAX = DEVICE_MEMORY <= 4 ? 300 : 1000;
let profilePersistTimer: ReturnType<typeof setTimeout> | null = null;
const sessionProfileCache = new Map<string, any>();

function loadSessionProfiles() {
  try {
    const raw = sessionStorage.getItem(PROFILE_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, any>;
      for (const [pk, data] of Object.entries(parsed)) {
        sessionProfileCache.set(pk, data);
      }
    }
  } catch {}
}

loadSessionProfiles();

sessionProfileCache.forEach((event) => {
  if (event && event.kind === 0) {
    eventStore.add(event);
    globalProfileCache.add(event.pubkey);
  }
});

(async () => {
  try {
    pruneOldProfiles();
    const idbProfiles = await getAllProfiles();
    let loaded = 0;
    idbProfiles.forEach((event, pubkey) => {
      if (event && event.kind === 0 && !globalProfileCache.has(pubkey)) {
        eventStore.add(event);
        globalProfileCache.add(pubkey);
        sessionProfileCache.set(pubkey, event);
        loaded++;
      }
    });
    if (loaded > 0) {
      pruneSessionProfileCache();
      persistSessionProfiles();
    }
  } catch {}
})();

function persistSessionProfiles() {
  if (profilePersistTimer) return;
  profilePersistTimer = setTimeout(() => {
    profilePersistTimer = null;
    try {
      const entries = Array.from(sessionProfileCache.entries());
      const trimmed = entries.slice(-PROFILE_SESSION_MAX);
      const obj: Record<string, any> = {};
      for (const [k, v] of trimmed) obj[k] = v;
      sessionStorage.setItem(PROFILE_SESSION_KEY, JSON.stringify(obj));
    } catch {}
  }, 2000);
}

export function getCachedProfile(pubkey: string): any | undefined {
  const cached = sessionProfileCache.get(pubkey);
  if (cached) return cached;
  // sessionProfileCache is a fast path, not the record. It is capped
  // (PROFILE_SESSION_MAX) and evicted by INSERTION ORDER, while eventStore —
  // written by every path that writes this cache — is unbounded. So a miss here
  // is usually not "unknown", it is "pushed out by a busy feed", and the answer
  // is still in the store.
  //
  // Reading only the capped map made those misses PERMANENT: fetchProfilesCached
  // skips any pubkey in globalProfileCache, which is unbounded and still holds
  // the pubkey, so nothing ever refetches it. The lookup said "I don't know them"
  // while the ledger said "already got them", for the rest of the session.
  //
  // It hit the accounts that matter most. Follows are registered first, at login,
  // so insertion-order eviction takes them first — a live probe found 7 of 18
  // follows nameless after ordinary feed use. That is the same set the
  // impersonation guard compares candidates against, so the guard ran at partial
  // strength with no way to report it. Four call sites had already hand-rolled
  // this fallback locally (InviteAcceptCard, MuteList, TrustReviews[Panel]),
  // which is what a missing fix in shared infrastructure looks like.
  return eventStore.getReplaceable(0, pubkey);
}

export function searchCachedProfiles(query: string, limit: number = 8): any[] {
  const lower = query.toLowerCase();
  const results: any[] = [];
  const entries = Array.from(sessionProfileCache.values());
  for (const event of entries) {
    if (!event || event.kind !== 0) continue;
    try {
      const content = JSON.parse(event.content);
      const name = (content.display_name || content.name || "").toLowerCase();
      const nip05 = (content.nip05 || "").toLowerCase();
      if (name.includes(lower) || nip05.includes(lower)) {
        results.push(event);
        if (results.length >= limit) break;
      }
    } catch {}
  }
  return results;
}

function pruneSessionProfileCache() {
  if (sessionProfileCache.size <= PROFILE_SESSION_MAX) return;
  const keys = Array.from(sessionProfileCache.keys());
  const toRemove = keys.slice(0, keys.length - PROFILE_SESSION_MAX);
  for (const k of toRemove) sessionProfileCache.delete(k);
}

/**
 * Ask the relays we actually met these people on.
 *
 * PROFILE_RELAYS is three PUBLIC indexers. Someone whose kind-0 lives only on a
 * private, auth-gated relay — a company Buzz instance, a closed community — is
 * simply not there. The app then rendered them as a shortened npub with a
 * placeholder avatar, which reads as "this person has no name" when the truth
 * is "we never asked the one relay that has it."
 *
 * Observed live: every member of a Buzz room showed as npub1y5s9…8ekz, in a
 * room where they were talking to each other by name.
 *
 * Deliberately a FALLBACK, not an expansion of PROFILE_RELAYS:
 *  - It runs only for pubkeys the indexers did not resolve, so the happy path
 *    pays nothing and the common case still hits 3 fast relays.
 *  - It asks only relays the user has JOINED, which is the same list that arms
 *    NIP-42 AUTH (nip42-auth.shouldAutoAuth) — an auth-gated relay would refuse
 *    an unauthenticated read anyway, so any other relay set would be pointless.
 *  - It does not re-enter the batch queue, so an genuinely unresolvable pubkey
 *    is asked about once per batch and then left alone.
 */
function retryUnresolvedOnJoinedRelays(chunk: string[]) {
  const unresolved = chunk.filter((pk) => !eventStore.getReplaceable(0, pk));
  if (unresolved.length === 0) return;

  const joined = filterBlockedRelays(
    getOutpostRelays()
      .map((r) => r.url)
      .filter((url) => !PROFILE_RELAYS.includes(url)),
  );
  if (joined.length === 0) return;

  for (const relay of joined) {
    const closer = throttledSubscribe(relay, () => {
      return pool.subscribeMany([relay], { kinds: [0], authors: unresolved }, {
        onevent(event) {
          eventStore.add(event);
          sessionProfileCache.set(event.pubkey, event);
          pruneSessionProfileCache();
          persistSessionProfiles();
          putProfile(event.pubkey, event);
          recordFirstSeen(event.pubkey, event.created_at);
        },
        oneose() { closer.close(); },
      });
    });
  }
}

function flushProfileBatch() {
  profileBatchTimer = null;
  const batch = Array.from(pendingProfileFetches).filter(isValidHex);
  pendingProfileFetches.clear();
  if (batch.length === 0) return;

  const relays = filterBlockedRelays(sortRelaysByScore(getHealthyRelays(PROFILE_RELAYS))).slice(0, 3);
  const chunks: string[][] = [];
  for (let i = 0; i < batch.length; i += 150) {
    chunks.push(batch.slice(i, i + 150));
  }

  for (const chunk of chunks) {
    // Resolution tracking: settle the chunk when every relay has EOSE'd, or
    // on the hard timeout fallback (throttled/hung relays must not leave
    // authors in the "unknown" grace state forever).
    let remainingRelays = relays.length;
    let settled = false;
    const settleChunk = () => {
      if (settled) return;
      settled = true;
      for (const pk of chunk) settledProfileFetches.add(pk);
      retryUnresolvedOnJoinedRelays(chunk);
    };
    setTimeout(settleChunk, PROFILE_SETTLE_TIMEOUT_MS);
    if (remainingRelays === 0) {
      settleChunk();
      continue;
    }
    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], { kinds: [0], authors: chunk }, {
          onevent(event) {
            eventStore.add(event);
            sessionProfileCache.set(event.pubkey, event);
            pruneSessionProfileCache();
            persistSessionProfiles();
            putProfile(event.pubkey, event);
            // First-seen ledger: a kind-0's created_at is earliest-evidence
            // input for the For You new-account gate (account-age.ts).
            recordFirstSeen(event.pubkey, event.created_at);
          },
          oneose() {
            closer.close();
            remainingRelays -= 1;
            if (remainingRelays <= 0) settleChunk();
          },
        });
      });
    }
  }
}

function flushInteractionBatch() {
  interactionBatchTimer = null;
  const batch = Array.from(pendingInteractionFetches).filter(isValidHex);
  pendingInteractionFetches.clear();
  if (batch.length === 0) return;

  const relays = filterBlockedRelays(sortRelaysByScore(getHealthyRelays(FAST_RELAYS))).slice(0, 3);
  const chunks: string[][] = [];
  for (let i = 0; i < batch.length; i += 50) {
    chunks.push(batch.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], { kinds: [1, 6, 7], "#e": chunk }, {
          onevent(event) {
            eventStore.add(event);
          },
          oneose() {
            closer.close();
          },
        });
      });
    }
  }
}

export function fetchProfilesCached(pubkeys: string[]) {
  const needed = pubkeys.filter((pk) => !globalProfileCache.has(pk));
  if (needed.length === 0) return;
  needed.forEach((pk) => {
    globalProfileCache.add(pk);
    pendingProfileFetches.add(pk);
  });
  if (!profileBatchTimer) {
    profileBatchTimer = setTimeout(flushProfileBatch, BATCH_DELAY);
  }
}

export function fetchInteractionsCached(eventIds: string[]) {
  const needed = eventIds.filter((id) => !globalInteractionCache.has(id));
  if (needed.length === 0) return;
  needed.forEach((id) => {
    globalInteractionCache.add(id);
    pendingInteractionFetches.add(id);
  });
  if (!interactionBatchTimer) {
    interactionBatchTimer = setTimeout(flushInteractionBatch, BATCH_DELAY);
  }
}

export function registerProfileInAllCaches(event: any) {
  if (!event || event.kind !== 0) return;
  eventStore.add(event);
  globalProfileCache.add(event.pubkey);
  sessionProfileCache.set(event.pubkey, event);
  pruneSessionProfileCache();
  persistSessionProfiles();
  putProfile(event.pubkey, event);
  recordFirstSeen(event.pubkey, event.created_at);
}

export function isProfileCached(pubkey: string): boolean {
  return globalProfileCache.has(pubkey);
}

export function isInteractionCached(eventId: string): boolean {
  return globalInteractionCache.has(eventId);
}

let feedDataLoaded = false;

export function markFeedDataLoaded() {
  feedDataLoaded = true;
}

export function hasFeedData(): boolean {
  return feedDataLoaded;
}

const eventRelayMap = new Map<string, Set<string>>();

export function trackEventRelay(eventId: string, relayUrl: string) {
  let relays = eventRelayMap.get(eventId);
  if (!relays) {
    relays = new Set();
    eventRelayMap.set(eventId, relays);
  }
  relays.add(relayUrl);
}

export function getEventRelays(eventId: string): string[] {
  const relays = eventRelayMap.get(eventId);
  return relays ? Array.from(relays) : [];
}

export function subscribeToFeed(filter: Filter, relays: string[] = FAST_RELAYS, onComplete?: () => void) {
  const healthyRelays = filterBlockedRelays(getHealthyRelays(relays));
  const seenIds = new Set<string>();
  let eoseCount = 0;
  let completed = false;
  const closers: Array<{ close(): void }> = [];

  const checkComplete = () => {
    if (!completed && eoseCount >= healthyRelays.length) {
      completed = true;
      onComplete?.();
    }
  };

  const feedTimeout = setTimeout(() => {
    if (!completed) {
      completed = true;
      for (const c of closers) { try { c.close(); } catch {} }
      onComplete?.();
    }
  }, 12000);

  for (const url of healthyRelays) {
    const start = Date.now();
    trackRelayActivity(url);
    const closer = throttledSubscribe(url, () => {
      // A connect FAILURE reaches oneose. nostr-tools' handleClose calls
      // handleEose(i) before recording the close (index.js:1192), so a relay
      // whose socket never opened looks byte-identical to one that answered
      // with nothing. Crediting that as a success is not merely generous:
      // markRelaySuccess decrements `failures` AND zeroes `cooldownUntil`, so
      // a dead relay clears its own cooldown by failing, gets put straight
      // back in rotation by getHealthyRelays, and fails again — it can never
      // cool down through this path. Defer the credit by a microtask; onclose
      // lands synchronously right after (index.js:1194) and cancels it.
      let closedWithoutAnswering = false;
      const s = pool.subscribeMany([url], filter, {
        onevent(event) {
          trackEventRelay(event.id, url);
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            eventStore.add(event);
          }
        },
        oneose() {
          queueMicrotask(() => {
            if (!closedWithoutAnswering) markRelaySuccess(url, Date.now() - start);
          });
          eoseCount++;
          closer.close();
          checkComplete();
        },
        onclose() { closedWithoutAnswering = true; },
      });
      return s;
    });
    closers.push(closer);
  }

  return {
    close() {
      clearTimeout(feedTimeout);
      completed = true;
      for (const c of closers) {
        try { c.close(); } catch {}
      }
    },
  };
}

export function subscribeToFeedPersistent(filter: Filter, relays: string[] = FAST_RELAYS, onevent?: (event: any) => void) {
  const healthyRelays = filterBlockedRelays(getHealthyRelays(relays));
  const seenIds = new Set<string>();
  const closers: Array<{ close(): void }> = [];

  for (const url of healthyRelays) {
    trackRelayActivity(url);
    const closer = throttledSubscribe(url, () => {
      return pool.subscribeMany([url], filter, {
        onevent(event) {
          trackRelayActivity(url);
          trackEventRelay(event.id, url);
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            eventStore.add(event);
            onevent?.(event);
          }
        },
      });
    });
    closers.push(closer);
  }

  return {
    close() {
      for (const c of closers) {
        try { c.close(); } catch {}
      }
    },
  };
}

export function fetchProfiles(pubkeys: string[], relays: string[] = PROFILE_RELAYS) {
  const valid = pubkeys.filter(isValidHex);
  if (valid.length === 0) return;
  const closers: Array<{ close(): void }> = [];
  for (const relay of sanitizeRelayUrls(relays)) {
    const closer = throttledSubscribe(relay, () => {
      return pool.subscribeMany([relay], { kinds: [0], authors: valid }, {
        onevent(event) {
          eventStore.add(event);
          sessionProfileCache.set(event.pubkey, event);
          pruneSessionProfileCache();
          persistSessionProfiles();
          putProfile(event.pubkey, event);
        },
        oneose() {
          closer.close();
        },
      });
    });
    closers.push(closer);
  }
  return {
    close() {
      for (const c of closers) {
        try { c.close(); } catch {}
      }
    },
  };
}

let contactListFetchedRef = new Set<string>();

export function resetContactListCache() {
  contactListFetchedRef = new Set();
}

export function fetchContactLists(pubkeys: string[], relays: string[] = FAST_RELAYS.slice(0, 3)) {
  const needed = pubkeys.filter(pk => isValidHex(pk) && !contactListFetchedRef.has(pk));
  if (needed.length === 0) return;
  for (const pk of needed) contactListFetchedRef.add(pk);

  const BATCH_SIZE = 20;
  for (let i = 0; i < needed.length; i += BATCH_SIZE) {
    const batch = needed.slice(i, i + BATCH_SIZE);
    const delay = i > 0 ? Math.floor(i / BATCH_SIZE) * 1500 : 0;
    setTimeout(() => {
      for (const relay of relays) {
        const closer = throttledSubscribe(relay, () => {
          const timeout = setTimeout(() => { try { closer.close(); } catch {} }, 10000);
          return pool.subscribeMany([relay], { kinds: [3], authors: batch }, {
            onevent(event) {
              eventStore.add(event);
            },
            oneose() {
              clearTimeout(timeout);
              closer.close();
            },
          });
        });
      }
    }, delay);
  }
}

export function fetchInteractions(eventIds: string[], relays: string[] = FAST_RELAYS.slice(0, 4)) {
  const valid = eventIds.filter(isValidHex);
  if (valid.length === 0) return;
  const closers: Array<{ close(): void }> = [];
  for (const relay of relays) {
    const closer = throttledSubscribe(relay, () => {
      return pool.subscribeMany([relay], { kinds: [1, 6, 7], "#e": valid }, {
        onevent(event) {
          eventStore.add(event);
        },
        oneose() {
          closer.close();
        },
      });
    });
    closers.push(closer);
  }
  return {
    close() {
      for (const c of closers) {
        try { c.close(); } catch {}
      }
    },
  };
}

// NOTE: this is a generic relay subscription helper — it forwards each event to the
// caller's `onevent` and does NOT add to the applesauce `eventStore`. Callers add to
// the store themselves where a reactive model needs it (feeds, profiles, etc.). The
// DM callers are deliberately different: gift wraps (kind 1059) are encrypted and have
// no reactive model, so handleGiftWrap decrypts them and persists the PLAINTEXT to the
// purpose-built `dmCache` (with the decrypt-once ledger) — raw wraps never enter the
// reactive store. This is by design, not a missing `eventStore.add`.
// The actual persistent subscription. Extracted so it can be the injected
// opener for the dedup registry (see persistentPoolSubscribe below).
function openPersistentSub(
  relays: string[],
  filters: Filter | Filter[],
  handlers: { onevent: (event: any) => void; oneose: () => void; onclose?: () => void },
): { close(): void } {
  if (!filters || relays.length === 0) {
    handlers.oneose();
    return { close() {} };
  }
  const singleFilter = Array.isArray(filters) ? filters[0] : filters;
  if (!singleFilter || typeof singleFilter !== 'object') {
    handlers.oneose();
    return { close() {} };
  }
  const healthyRelays = filterBlockedRelays(getHealthyRelays(relays));
  if (healthyRelays.length === 0) {
    handlers.oneose();
    return { close() {} };
  }
  // Concord plane AUTH (Armada interop): when this REQ's authors are derived
  // stream planes on an already-challenged connection, direct-send their
  // kind-22242s BEFORE the REQ frame — nostr-tools' one-cached-AUTH-per-
  // connection flow can't cover a second subscription's planes, and the relay
  // rejects wrap REQs whose authors aren't all authenticated. No-op for
  // non-Concord filters and unchallenged relays.
  for (const relayUrl of healthyRelays) armPlaneAuth(relayUrl, singleFilter.authors);
  let eoseFired = false;
  let eoseCount = 0;
  const totalRelays = healthyRelays.length;

  const sub = pool.subscribeMany(healthyRelays, singleFilter, {
    onevent(event: any) {
      handlers.onevent(event);
    },
    oneose() {
      eoseCount++;
      if (!eoseFired && eoseCount >= totalRelays) {
        eoseFired = true;
        handlers.oneose();
      }
    },
    // Fires once EVERY relay's REQ has ended (socket death, connect failure,
    // relay CLOSED, or our own close). The resilient wrapper distinguishes
    // caller-close from underneath-close and reopens only for the latter.
    onclose() {
      handlers.onclose?.();
    },
    // Auto-AUTH when a relay closes the REQ with `auth-required` so gift-wrapped DMs
    // on auth-gated inbox relays actually arrive. Only invoked on demand (zero cost
    // for normal relays). The kind-22242 template carries the relay in its `relay`
    // tag; reuse the per-relay opt-in gating from createPoolAuthHandler.
    //
    // Concord plane REQs (authors = derived stream planes) authenticate AS the
    // planes instead of the user — Armada-flavored community relays require
    // every filter author to be an authenticated pubkey (see concord-plane-auth).
    async onauth(authEvt) {
      const relayUrl = authEvt.tags?.find((t) => t[0] === "relay")?.[1] ?? "";
      const planeAuth = planeAuthForSubscription(relayUrl, singleFilter.authors, authEvt);
      if (planeAuth) return planeAuth;
      const signer = subscriptionAuth(relayUrl);
      if (!signer) throw new Error(`auto-auth not enabled for ${relayUrl}`);
      return signer(authEvt);
    },
  });

  return { close() { sub.close(); } };
}

// ── Self-healing persistent subscriptions ────────────────────────────────────
// openPersistentSub is a one-shot: if the underlying REQs all die (socket drop
// the pool-level reconnect gave up on, connect failure, relay CLOSED), nothing
// reopens them and consumers go silently deaf — the "Concord messages only
// appear after re-entering the channel" bug. openResilientPersistentSub wraps
// it in the reopen-with-backoff supervisor, and `online`/visibilitychange kick
// any pending retries so recovery is immediate when the app comes back.
const pendingSubKicks = new Set<() => void>();
function kickResilientSubs() {
  for (const kick of [...pendingSubKicks]) {
    try { kick(); } catch {}
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("online", kickResilientSubs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kickResilientSubs();
  });
}

function openResilientPersistentSub(
  relays: string[],
  filters: Filter | Filter[],
  handlers: { onevent: (event: any) => void; oneose: () => void },
): { close(): void } {
  const sub = openResilientSub(
    (r, f, h) => openPersistentSub(r, f, h),
    sanitizeRelayUrls(relays),
    filters,
    handlers,
  );
  pendingSubKicks.add(sub.kick);
  return {
    close() {
      pendingSubKicks.delete(sub.kick);
      sub.close();
    },
  };
}

// Registry that coalesces identical concurrent persistent subscriptions into one
// underlying socket subscription. Opt-in (localStorage ro_sub_dedup=1) while it
// bakes; the default path is byte-for-byte the pre-existing behaviour.
const persistentSubRegistry = new SubscriptionRegistry((relays, filters, h) =>
  openResilientPersistentSub(relays, filters, h),
);

function subDedupEnabled(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem("ro_sub_dedup") === "1"; } catch { return false; }
}

export function persistentPoolSubscribe(
  relays: string[],
  filters: Filter | Filter[],
  opts: {
    onevent?: (event: any) => void;
    oneose?: () => void;
  },
): { close(): void } {
  if (subDedupEnabled()) {
    return persistentSubRegistry.subscribe(relays, filters, {
      onevent: opts.onevent,
      oneose: opts.oneose,
    });
  }
  return openResilientPersistentSub(relays, filters, {
    onevent: (e) => opts.onevent?.(e),
    oneose: () => opts.oneose?.(),
  });
}

export function throttledPoolSubscribe(
  relays: string[],
  filters: Filter | Filter[],
  opts: {
    onevent?: (event: any) => void;
    oneose?: () => void;
  },
): { close(): void } {
  if (!filters || relays.length === 0) {
    opts.oneose?.();
    return { close() {} };
  }
  if (typeof filters !== 'object') {
    opts.oneose?.();
    return { close() {} };
  }
  const normalizedFilters = Array.isArray(filters) ? filters[0] : filters;
  if (!normalizedFilters || typeof normalizedFilters !== 'object') {
    opts.oneose?.();
    return { close() {} };
  }
  const healthyRelays = filterBlockedRelays(getHealthyRelays(relays));
  const closers: Array<{ close(): void }> = [];
  let eoseCount = 0;
  let completed = false;
  const totalRelays = healthyRelays.length;
  const respondedRelays = new Set<string>();

  const finish = () => {
    if (completed) return;
    completed = true;
    for (const relay of healthyRelays) {
      if (!respondedRelays.has(relay)) {
        markRelayFailure(relay);
      }
    }
    opts.oneose?.();
  };

  const safetyTimeout = setTimeout(finish, 10000);

  for (const relay of healthyRelays) {
    const start = Date.now();
    trackRelayActivity(relay);
    const closer = throttledSubscribe(relay, () => {
      // See subscribeToFeed above: oneose fires for a relay that never
      // connected, and crediting it clears its cooldown.
      let closedWithoutAnswering = false;
      return pool.subscribeMany([relay], normalizedFilters, {
        // Per-relay, because this loop already is. Without it a relay that
        // answers a REQ with `CLOSED auth-required` is never re-asked, and
        // since handleClose fires handleEose FIRST the caller just sees a
        // clean empty EOSE. That is why the 30-day DM backfill came back
        // empty from auth-gated inbox relays while the live tail — which does
        // pass onauth — delivered fine: the same mailbox, two answers.
        onauth: subscriptionAuthFor(relay),
        // Without this, nostr-tools' invented EOSE (baseEoseTimeout = 4400)
        // fires first and `oneose` below closes the subscription while the
        // relay is still answering — measured at 4740ms against a relay that
        // needed ~8s. onauth alone does NOT fix that: authentication succeeds
        // and the answer still arrives after we have hung up. Sits just under
        // the 10s safetyTimeout, so a real EOSE always wins and the ceiling
        // still bounds the wait.
        maxWait: 9500,
        onclose() { closedWithoutAnswering = true; },
        onevent(event: any) {
          opts.onevent?.(event);
        },
        oneose() {
          respondedRelays.add(relay);
          queueMicrotask(() => {
            if (!closedWithoutAnswering) markRelaySuccess(relay, Date.now() - start);
          });
          eoseCount++;
          closer.close();
          if (eoseCount >= totalRelays) {
            clearTimeout(safetyTimeout);
            finish();
          }
        },
      });
    });
    closers.push(closer);
  }

  return {
    close() {
      clearTimeout(safetyTimeout);
      completed = true;
      for (const c of closers) {
        try { c.close(); } catch {}
      }
    },
  };
}

const PRUNE_THRESHOLD = 5000;
const PRUNE_INTERVAL = 5 * 60 * 1000;
const KEEP_KINDS = new Set([0, 3, 10002, 30023, 30078, 10003, 31337]);
const MAX_EVENT_AGE = 2 * 60 * 60;
const MAX_REACTION_AGE = 60 * 60;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

export function startEventStorePruning(userPubkey?: string) {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    pruneEventStore(userPubkey);
  }, PRUNE_INTERVAL);
}

function pruneEventStore(userPubkey?: string) {
  try {
    // On low-end / "lite" devices, hold roughly half as many events and trim
    // them sooner — meaningfully lower memory pressure where it matters most.
    const lite = typeof document !== "undefined" && document.documentElement.getAttribute("data-perf") === "lite";
    const threshold = lite ? Math.floor(PRUNE_THRESHOLD / 2) : PRUNE_THRESHOLD;
    const maxAge = lite ? Math.floor(MAX_EVENT_AGE / 2) : MAX_EVENT_AGE;
    const maxReactionAge = lite ? Math.floor(MAX_REACTION_AGE / 2) : MAX_REACTION_AGE;

    const allEvents = eventStore.getByFilters({});
    if (allEvents.length < threshold) return;

    const now = Math.floor(Date.now() / 1000);
    let pruned = 0;

    for (const event of allEvents) {
      if (KEEP_KINDS.has(event.kind)) continue;
      if (userPubkey && event.pubkey === userPubkey) continue;

      const age = now - event.created_at;
      const isReaction = event.kind === 7 || event.kind === 9735;

      if (isReaction && age > maxReactionAge) {
        eventStore.remove(event.id);
        pruned++;
      } else if (!isReaction && age > maxAge) {
        eventStore.remove(event.id);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[EventStore] Pruned ${pruned} old events (${allEvents.length - pruned} remaining)`);
    }
  } catch (err) {
    console.warn("[EventStore] Prune error:", err);
  }
}

export function verifySignedEventKind(signed: any, expectedKind: number): boolean {
  if (!signed || typeof signed.kind !== "number" || signed.kind !== expectedKind) {
    console.error(`[Signer] Kind mismatch: expected ${expectedKind}, got ${signed?.kind}`);
    return false;
  }
  return true;
}

const RELAY_PUBLISH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function tryPublish(publishRelays: string[], event: any): Promise<{ successCount: number; total: number; authRequiredRelays: string[]; rejections: PublishRejection[] }> {
  const promises = pool.publish(publishRelays, event);
  const timedPromises = promises.map((p, i) =>
    withTimeout(p, RELAY_PUBLISH_TIMEOUT_MS, publishRelays[i])
  );
  const results = await Promise.allSettled(timedPromises);
  let successCount = 0;
  const authSet = new Set<string>();
  const rejections: PublishRejection[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // SimplePool.publish RESOLVES with the string "connection failure: …" when
      // it never reached the relay at all, instead of rejecting. Counting that as
      // a success is how a publish that touched nothing still reports "sent to
      // 1/1 relays" — so classify it by its value, not by settled-ness.
      const value = typeof r.value === "string" ? r.value : "";
      if (value.startsWith("connection failure")) {
        rejections.push({ relay: publishRelays[i], message: value });
        console.warn(`[Publish] Never reached ${publishRelays[i]}:`, value);
        return;
      }
      successCount++;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason ?? "");
      // The relay's own words. nostr-tools rejects with `new Error(<OK message>)`,
      // so this is verbatim: 'invalid: a group event must carry an "h" tag',
      // 'blocked: to create groups open …'. Callers can finally say WHY.
      rejections.push({ relay: publishRelays[i], message: reason });
      const detected = parseAuthRequiredRelays(r.reason);
      if (detected.length > 0) {
        authSet.add(publishRelays[i]);
      } else {
        const lower = reason.toLowerCase();
        if (lower.includes("auth-required") || lower.includes("restricted: not authenticated")) {
          authSet.add(publishRelays[i]);
        }
      }
      console.warn(`[Publish] Failed on ${publishRelays[i]}:`, r.reason);
    }
  });
  return { successCount, total: publishRelays.length, authRequiredRelays: Array.from(authSet), rejections };
}

let lastAuthRequiredAt = 0;
export function wasAuthRequiredRecently(windowMs = 1500): boolean {
  return Date.now() - lastAuthRequiredAt < windowMs;
}

const recentAuthToasts = new Map<string, number>();
function notifyAuthRequired(relays: string[]) {
  if (relays.length === 0) return;
  const now = Date.now();
  const fresh = relays.filter((r) => {
    const last = recentAuthToasts.get(r) ?? 0;
    if (now - last < 8000) return false;
    recentAuthToasts.set(r, now);
    return true;
  });
  if (fresh.length === 0) return;
  import("@/hooks/use-toast").then(({ toast }) => {
    const list = fresh.map((r) => r.replace(/^wss?:\/\//, "")).join(", ");
    toast({
      title: `Couldn't sign in to ${list}`,
      description: "Sent to your other relays, but this one needs authentication that didn't complete. If it's the recipient's only inbox, your message may not arrive.",
      variant: "destructive",
    });
  }).catch(() => {});
}

/**
 * Publish, and keep what the relays said when they refused.
 *
 * `publishEvent` below is the boolean-returning wrapper the app has always used
 * and still the right default. This variant exists for the handful of callers
 * that must EXPLAIN a failure — creating a NIP-29 group is the motivating case,
 * where "invalid: a group event must carry an h tag" and "blocked: open the site
 * in your browser" are different problems with different fixes, and collapsing
 * both to `false` cost real debugging time.
 */
export async function publishEventDetailed(event: any, relays: string[] = DEFAULT_RELAYS, targetPubkey?: string, userSelected?: boolean, privateOnly?: boolean, suppressAuthToast?: boolean): Promise<{ ok: boolean; rejections: PublishRejection[] }> {
  if (!privateOnly) {
    eventStore.add(event);
  }

  const freshOutpost = getOutpostRelays().map((r) => r.url);
  if (freshOutpost.length > 0) registerCoreRelays(freshOutpost);

  const isProtected = Array.isArray(event?.tags) && event.tags.some((t: string[]) => t[0] === "-");
  if (isProtected) {
    const normalize = (u: string) => u.replace(/\/+$/, "").toLowerCase();
    const defaultsNorm = new Set(DEFAULT_RELAYS.map(normalize));
    const safe = relays.filter((r) => !defaultsNorm.has(normalize(r)));
    if (safe.length < relays.length) {
      console.warn("[Publish] Protected (NIP-70) event: stripping default public relays from broadcast list.");
    }
    if (safe.length === 0) {
      console.warn("[Publish] Protected (NIP-70) event has no non-default relay target — refusing to broadcast.");
      throw new Error("Protected event has no explicit relay target. Choose a private/outpost relay before posting.");
    }
    relays = safe;
    userSelected = true;
    targetPubkey = undefined;
  }

  let publishRelays = userSelected
    ? filterBlockedRelays(relays)
    : filterBlockedRelays(getHealthyRelays(relays));

  if (!userSelected && targetPubkey) {
    try {
      const { getReadRelays } = await import("./outbox");
      const targetReadRelays = getReadRelays(targetPubkey, []);
      if (targetReadRelays.length > 0) {
        const merged = new Set([...publishRelays, ...targetReadRelays.slice(0, 3)]);
        publishRelays = filterBlockedRelays(getHealthyRelays(Array.from(merged)));
      }
    } catch {}
  }

  if (!userSelected && publishRelays.length < 3) {
    const fallback = filterBlockedRelays(getHealthyRelays(relays.slice(0, 5)));
    const merged = new Set([...publishRelays, ...fallback]);
    publishRelays = Array.from(merged);
  }

  if (!userSelected && publishRelays.length === 0) {
    publishRelays = filterBlockedRelays(relays.slice(0, 3));
  }

  if (publishRelays.length === 0) {
    throw new Error("No relays available for publishing");
  }

  for (const url of publishRelays) trackRelayActivity(url);

  // Scoped NIP-42 auto-AUTH: deliberate publishes (DM delivery + explicit relay picks
  // pass userSelected) clear their targets so the pool's automaticallyAuth hook will
  // authenticate to auth-required inbox relays (auth.nostr1.com, relay.nsec.app, …).
  // Without this a gift-wrapped DM never reaches the recipient's auth-required relay.
  if (userSelected) {
    try {
      const { allowAuthForPublish } = await import("./nip42-auth");
      allowAuthForPublish(publishRelays);
    } catch {}
  }

  console.log(`[Publish] Attempting event ${event.id?.slice(0, 8)} to ${publishRelays.length} relays:`, publishRelays);
  let { successCount, authRequiredRelays, rejections } = await tryPublish(publishRelays, event);

  if (successCount < publishRelays.length) {
    const { getAuthStatus } = await import("./nip42-auth");
    const needsAuthWait = publishRelays.some((url) => {
      const s = getAuthStatus(url).status;
      return s === "challenged" || s === "authenticating" || s === "authenticated";
    });

    if (needsAuthWait) {
      console.log("[Publish] Some relays need AUTH, retrying...");
      const authDeadline = Date.now() + 12000;
      for (let attempt = 0; attempt < 3; attempt++) {
        const remaining = authDeadline - Date.now();
        if (remaining <= 0) {
          console.warn("[Publish] AUTH retry deadline reached, proceeding with current results");
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(1500, remaining)));
        if (Date.now() >= authDeadline) break;
        const retryTimeout = Math.min(RELAY_PUBLISH_TIMEOUT_MS, authDeadline - Date.now());
        if (retryTimeout <= 0) break;
        const retry = await tryPublish(publishRelays, event);
        successCount = retry.successCount;
        authRequiredRelays = retry.authRequiredRelays;
        // The retry's refusals supersede the first attempt's: after a successful
        // AUTH the relay may object to something else entirely, and reporting the
        // stale "not authenticated" would send the caller down the wrong path.
        rejections = retry.rejections;
        if (successCount >= publishRelays.length) break;

        const stillAuthing = publishRelays.some((url) => {
          const s = getAuthStatus(url).status;
          return s === "challenged" || s === "authenticating";
        });
        if (!stillAuthing) break;
      }
    }
  }

  if (authRequiredRelays.length > 0) {
    lastAuthRequiredAt = Date.now();
    // DMs suppress this: deliverMessage already warns only when the recipient's inbox
    // got nothing (it throws on total failure). An auth failure on a non-chosen relay
    // while the real inbox succeeded is noise, not a delivery problem.
    if (!suppressAuthToast) notifyAuthRequired(authRequiredRelays);
  }

  if (successCount === 0) {
    console.error("[Publish] Failed on ALL relays:", publishRelays);
    return { ok: false, rejections };
  }
  console.log(`[Publish] Event ${event.id?.slice(0, 8)} sent to ${successCount}/${publishRelays.length} relays`);
  return { ok: true, rejections };
}

/** Did it land anywhere? The answer almost every caller wants. */
export async function publishEvent(event: any, relays: string[] = DEFAULT_RELAYS, targetPubkey?: string, userSelected?: boolean, privateOnly?: boolean, suppressAuthToast?: boolean): Promise<boolean> {
  const { ok } = await publishEventDetailed(event, relays, targetPubkey, userSelected, privateOnly, suppressAuthToast);
  return ok;
}
