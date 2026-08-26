import { eventStore, trackEventRelay, DEFAULT_RELAYS, throttledPoolSubscribe, registerProfileInAllCaches } from "./nostr";
import type { Event } from "nostr-tools";
import { searchBrainstorm } from "./brainstorm-search";

// Primal's cache hosts, tried in order. `cache.primal.net` is the documented
// entry point and stays first, but MEASURED 2026-08-03 it flaps: six probes
// 30s apart returned 502/200/200/502/502/200 — roughly half — while
// cache2.primal.net answered every time and primal.net itself was up, so it is
// the host and not the network. There was no fallback, and ensureConnection
// catches its own failure and resolves into a backoff (:139-153), so every
// caller proceeded as though connected and got []. For fetchUserProfileStats
// that renders as "0 followers · 0 following · 0 posts" on a real profile.
const PRIMAL_CACHE_URLS = [
  "wss://cache.primal.net/v1",
  "wss://cache2.primal.net/v1",
  "wss://cache1.primal.net/v1",
];
/** Index of the host that last worked — start there next time. */
let primalHostIndex = 0;
const PRIMAL_CACHE_URL = PRIMAL_CACHE_URLS[0];

let ws: WebSocket | null = null;
let wsReady = false;
let connectPromise: Promise<void> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

setTimeout(() => ensureConnection().catch(() => {}), 100);
const pendingRequests = new Map<string, {
  resolve: (events: Event[]) => void;
  reject: (err: Error) => void;
  events: Event[];
  timeout: ReturnType<typeof setTimeout>;
}>();

let subCounter = 0;
function nextSubId(): string {
  return `primal_${++subCounter}_${Date.now()}`;
}

function handleMessage(msg: MessageEvent) {
  try {
    const data = JSON.parse(msg.data);
    if (!Array.isArray(data)) return;

    const verb = data[0];
    const subId = data[1];

    if (verb === "NOTICE") {
      const noticeData = data[1];
      if (Array.isArray(noticeData) && noticeData.length >= 2) {
        const noticeSubId = noticeData[0];
        const pending = pendingRequests.get(noticeSubId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(noticeSubId);
          pending.resolve(pending.events);
        }
      }
      return;
    }

    if (verb === "CLOSED") {
      console.warn("[Primal WS] CLOSED:", subId, data[2]);
      const pending = pendingRequests.get(subId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(subId);
        pending.resolve(pending.events);
      }
      return;
    }

    const pending = pendingRequests.get(subId);
    if (!pending) return;

    if (verb === "EVENT") {
      const event = data[2] as Event;
      pending.events.push(event);
    } else if (verb === "EOSE" || verb === "COUNT") {
      if (verb === "COUNT") {
        const countData = data[2];
        pending.events.push({ kind: -1, count: countData?.count ?? 0 } as any);
      }
      clearTimeout(pending.timeout);
      pendingRequests.delete(subId);
      pending.resolve(pending.events);
      try { ws?.send(JSON.stringify(["CLOSE", subId])); } catch {}
    }
  } catch (err) {
    console.error("Primal WS parse error:", err);
  }
}

function createConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
      wsReady = false;

      const socket = new WebSocket(PRIMAL_CACHE_URLS[primalHostIndex]);

      // Advance to the next host on failure. Without this the list is
      // decoration: ensureConnection would retry the same flapping host with a
      // longer delay forever.
      const tryNextHost = () => {
        primalHostIndex = (primalHostIndex + 1) % PRIMAL_CACHE_URLS.length;
      };

      const connectionTimeout = setTimeout(() => {
        if (!wsReady) {
          try { socket.close(); } catch {}
          tryNextHost();
          reject(new Error("Connection timeout"));
        }
      }, 8000);

      socket.onopen = () => {
        clearTimeout(connectionTimeout);
        ws = socket;
        wsReady = true;
        reconnectDelay = 1000;
        // This host answered — stay on it until it stops.
        resolve();
      };

      socket.onmessage = handleMessage;

      socket.onerror = () => {
        clearTimeout(connectionTimeout);
        // A 502 from the host surfaces here, not as a close with a code we can
        // read. Rotate so the next attempt reaches a different machine.
        if (!wsReady) tryNextHost();
      };

      socket.onclose = () => {
        clearTimeout(connectionTimeout);
        wsReady = false;
        if (ws === socket) ws = null;
        connectPromise = null;
        pendingRequests.forEach((pending) => {
          clearTimeout(pending.timeout);
          pending.resolve(pending.events);
        });
        pendingRequests.clear();
        const queued = requestQueue.splice(0);
        for (const fn of queued) {
          try { fn(); } catch {}
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

async function ensureConnection(): Promise<void> {
  if (ws && wsReady && ws.readyState === WebSocket.OPEN) return;

  if (connectPromise) return connectPromise;

  connectPromise = createConnection()
    .catch((err) => {
      console.warn("[Primal] Connection failed, will retry:", err.message);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      return new Promise<void>((resolve) => {
        setTimeout(async () => {
          connectPromise = null;
          try {
            await ensureConnection();
            resolve();
          } catch {
            resolve();
          }
        }, reconnectDelay);
      });
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

function sendMessage(msg: string) {
  if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    console.warn("[Primal] WS not ready, message dropped");
  }
}

const MAX_CONCURRENT_REQS = 8;
const requestQueue: Array<() => void> = [];

function drainQueue() {
  while (requestQueue.length > 0 && pendingRequests.size < MAX_CONCURRENT_REQS) {
    const next = requestQueue.shift();
    if (next) next();
  }
}

function request(subId: string, filter: any, timeoutMs = 10000): Promise<Event[]> {
  const execute = (resolve: (events: Event[]) => void) => {
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(subId);
      if (pending) {
        pendingRequests.delete(subId);
        pending.resolve(pending.events);
        drainQueue();
      }
    }, timeoutMs);

    pendingRequests.set(subId, {
      resolve: (events) => { resolve(events); drainQueue(); },
      reject: () => { resolve([]); drainQueue(); },
      events: [],
      timeout,
    });

    if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify(["REQ", subId, filter]);
      ws.send(msg);
    } else {
      pendingRequests.delete(subId);
      clearTimeout(timeout);
      resolve([]);
      drainQueue();
    }
  };

  return new Promise((resolve) => {
    if (pendingRequests.size >= MAX_CONCURRENT_REQS) {
      requestQueue.push(() => execute(resolve));
    } else {
      execute(resolve);
    }
  });
}

function countRequest(subId: string, filter: any, timeoutMs = 8000): Promise<number> {
  const execute = (resolve: (n: number) => void) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(subId);
      resolve(0);
      drainQueue();
    }, timeoutMs);

    pendingRequests.set(subId, {
      resolve: (events) => {
        const countEvt = events.find((e: any) => e.kind === -1);
        resolve((countEvt as any)?.count ?? 0);
        drainQueue();
      },
      reject: () => { resolve(0); drainQueue(); },
      events: [],
      timeout,
    });
    const msg = JSON.stringify(["COUNT", subId, filter]);
    sendMessage(msg);
  };

  return new Promise((resolve) => {
    if (pendingRequests.size >= MAX_CONCURRENT_REQS) {
      requestQueue.push(() => execute(resolve));
    } else {
      execute(resolve);
    }
  });
}

export interface EventStats {
  replies: number;
  reposts: number;
  likes: number;
  zaps: number;
  zapAmount: number;
}

export interface UserProfileStats {
  /**
   * Did Primal actually answer? False means the counts below are this
   * struct's zero-initialised DEFAULTS, not measurements.
   *
   * MEASURED against the live cache 2026-08-03: a pubkey generated seconds
   * earlier — genuinely zero followers — comes back WITH a kind-10000105 whose
   * content has `followers_count: 0` explicitly present. Primal does not omit
   * the field for a real zero. So the discriminator is not "is the field
   * missing" but "did the kind-10000105 event arrive at all", which is what
   * this flag records. A real zero is measured; a silent Primal is not.
   */
  measured: boolean;
  followersCount: number;
  followingCount: number;
  noteCount: number;
  replyCount: number;
  longFormCount: number;
  timeJoined?: number;
  lastSeen?: number;
}

function parseEventStats(event: Event): Record<string, EventStats> {
  if (event.kind !== 10000100) return {};
  try {
    const content = JSON.parse(event.content);
    if (content.event_id) {
      const eventId = content.event_id;
      return {
        [eventId]: {
          replies: content.replies ?? 0,
          reposts: content.reposts ?? 0,
          likes: content.likes ?? 0,
          zaps: content.zaps ?? 0,
          zapAmount: content.satszapped ?? content.sats_zapped ?? 0,
        },
      };
    }
    const result: Record<string, EventStats> = {};
    for (const [eventId, stats] of Object.entries(content)) {
      const s = stats as any;
      if (typeof s === "object" && s !== null && !Array.isArray(s)) {
        result[eventId] = {
          replies: s.replies ?? s.reply_count ?? 0,
          reposts: s.reposts ?? s.repost_count ?? 0,
          likes: s.likes ?? s.reaction_count ?? 0,
          zaps: s.zaps ?? s.zap_count ?? 0,
          zapAmount: s.satszapped ?? s.sats_zapped ?? 0,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseUserProfileStats(events: Event[]): UserProfileStats {
  const stats: UserProfileStats = {
    measured: false,
    followersCount: 0,
    followingCount: 0,
    noteCount: 0,
    replyCount: 0,
    longFormCount: 0,
  };
  for (const event of events) {
    if (event.kind === 10000105) {
      try {
        const content = JSON.parse(event.content);
        stats.measured = true;
        stats.followersCount = content.followers_count ?? content.followers ?? 0;
        stats.followingCount = content.follows_count ?? content.following ?? 0;
        stats.noteCount = content.note_count ?? content.notes ?? 0;
        stats.replyCount = content.reply_count ?? 0;
        stats.longFormCount = content.long_form_note_count ?? 0;
        if (content.time_joined) stats.timeJoined = content.time_joined;
        if (content.last_seen) stats.lastSeen = content.last_seen;
      } catch {}
    }
  }
  return stats;
}

/**
 * Fetch specific events BY ID from Primal's cache — the guest deep-link
 * fallback. A share link can point at a post that lives only on the author's
 * own write relays (or relays a guest can't auth to); Primal's crawler has
 * usually seen it anyway. Returns only the requested ids, whatever kind they
 * are (a kind-20 picture post is as shareable as a note).
 */
export async function fetchPrimalEventsById(eventIds: string[]): Promise<Event[]> {
  if (eventIds.length === 0) return [];
  await ensureConnection();
  const wanted = new Set(eventIds);
  const events = await request(nextSubId(), {
    cache: ["events", { event_ids: eventIds, extended_response: false }],
  });
  const hits = events.filter((e) => wanted.has(e.id));
  for (const e of hits) eventStore.add(e);
  return hits;
}

export async function fetchEventCounts(eventIds: string[]): Promise<Record<string, EventStats>> {
  if (eventIds.length === 0) return {};
  await ensureConnection();

  const subId = nextSubId();
  const allEvents: Event[] = [];
  const chunkSize = 5;
  for (let c = 0; c < eventIds.length; c += chunkSize) {
    const chunk = eventIds.slice(c, c + chunkSize);
    const cSubId = c === 0 ? subId : nextSubId();
    const filter = {
      cache: ["events", {
        event_ids: chunk,
        extended_response: true,
      }],
    };
    const chunkEvents = await request(cSubId, filter);
    allEvents.push(...chunkEvents);
  }
  const events = allEvents;

  const result: Record<string, EventStats> = {};
  let hasStatsEvent = false;

  for (const event of events) {
    if (event.kind === 10000100) {
      hasStatsEvent = true;
      const parsed = parseEventStats(event);
      Object.assign(result, parsed);
    }
    if (event.kind === 0) {
      registerProfileInAllCaches(event);
    } else if (event.kind === 1 || event.kind === 6) {
      eventStore.add(event);
      if (event.kind === 1) {
        const parentId = getReplyParentId(event);
        if (parentId) {
          updateLastReplyTimestamp(parentId, event.created_at);
        }
      }
    }
  }

  if (!hasStatsEvent) {
    if (events.length === 0) {
      throw new Error("Primal returned no stats data");
    }
  }

  const zeroFilledIds: string[] = [];
  for (const id of eventIds) {
    if (!result[id]) {
      result[id] = { replies: 0, reposts: 0, likes: 0, zaps: 0, zapAmount: 0 };
      zeroFilledIds.push(id);
    }
  }

  if (zeroFilledIds.length > 0) {
    scheduleRelayVerification(zeroFilledIds);
  }

  return result;
}

const relayVerifiedIds = new Map<string, number>();
let relayVerifyTimer: ReturnType<typeof setTimeout> | null = null;
let relayVerifyQueue: string[] = [];
const RELAY_VERIFY_DELAY = 1500;
const RELAY_VERIFY_MAX_BATCH = 20;
const RELAY_VERIFY_TTL = 10 * 60 * 1000;
const RELAY_VERIFY_MAX_TRACKED = 2000;

function pruneVerifiedIds() {
  if (relayVerifiedIds.size <= RELAY_VERIFY_MAX_TRACKED) return;
  const now = Date.now();
  for (const [id, ts] of relayVerifiedIds) {
    if (now - ts > RELAY_VERIFY_TTL || relayVerifiedIds.size > RELAY_VERIFY_MAX_TRACKED) {
      relayVerifiedIds.delete(id);
    }
  }
}

function countRelayStats(id: string) {
  let latestReplyTs = 0;
  const replies = [...eventStore.getByFilters({ kinds: [1] })].filter(
    (e) => {
      const eTags = e.tags.filter((t: string[]) => t[0] === "e");
      if (eTags.length === 0) return false;
      const hasMarkers = eTags.some((t: string[]) => t[3] === "reply" || t[3] === "root" || t[3] === "mention");
      const isReply = hasMarkers ? eTags.some((t: string[]) => t[1] === id && t[3] === "reply") : eTags[eTags.length - 1][1] === id;
      if (isReply && e.created_at > latestReplyTs) latestReplyTs = e.created_at;
      return isReply;
    }
  ).length;
  if (latestReplyTs > 0) updateLastReplyTimestamp(id, latestReplyTs);
  const reposts = [...eventStore.getByFilters({ kinds: [6] })].filter(
    (e) => e.tags.some((t: string[]) => t[0] === "e" && t[1] === id)
  ).length;
  const likes = [...eventStore.getByFilters({ kinds: [7] })].filter(
    (e) => e.tags.some((t: string[]) => t[0] === "e" && t[1] === id)
  ).length;
  return { replies, reposts, likes };
}

function processRelayVerifyBatch() {
  const unique = Array.from(new Set(relayVerifyQueue));
  relayVerifyQueue = [];
  relayVerifyTimer = null;
  const batch = unique.slice(0, RELAY_VERIFY_MAX_BATCH);
  const overflow = unique.slice(RELAY_VERIFY_MAX_BATCH);
  const now = Date.now();
  batch.forEach((id) => relayVerifiedIds.set(id, now));
  pruneVerifiedIds();
  if (batch.length === 0) {
    if (overflow.length > 0) scheduleRelayVerification(overflow);
    return;
  }
  (async () => {
    try {
      const { fetchInteractions } = await import("@/lib/nostr");
      fetchInteractions(batch);
      await new Promise((r) => setTimeout(r, 2000));
      for (const id of batch) {
        const existing = primalStatsCache.get(id);
        if (!existing) continue;
        const { replies, reposts, likes } = countRelayStats(id);
        if (replies > 0 || reposts > 0 || likes > 0) {
          const merged: EventStats = {
            replies: Math.max(existing.replies, replies),
            reposts: Math.max(existing.reposts, reposts),
            likes: Math.max(existing.likes, likes),
            zaps: existing.zaps,
            zapAmount: existing.zapAmount,
          };
          primalStatsCache.set(id, merged);
        }
      }
    } catch {}
    if (overflow.length > 0) scheduleRelayVerification(overflow);
  })();
}

function scheduleRelayVerification(ids: string[]) {
  const now = Date.now();
  const newIds = ids.filter((id) => {
    const ts = relayVerifiedIds.get(id);
    return !ts || now - ts > RELAY_VERIFY_TTL;
  });
  if (newIds.length === 0) return;
  relayVerifyQueue.push(...newIds);
  if (relayVerifyTimer) return;
  relayVerifyTimer = setTimeout(processRelayVerifyBatch, RELAY_VERIFY_DELAY);
}

let prefetchCooldownUntil = 0;
let prefetchInFlight = false;
let prefetchQueue: string[] = [];

export async function prefetchStatsImmediate(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  if (Date.now() < prefetchCooldownUntil) return;
  const unfetched = eventIds.filter((id) => !primalStatsCache.has(id));
  if (unfetched.length === 0) return;

  if (prefetchInFlight) {
    prefetchQueue.push(...unfetched);
    return;
  }

  prefetchInFlight = true;
  try {
    let toFetch = unfetched;
    while (toFetch.length > 0) {
      const batchSize = 50;
      const batches: string[][] = [];
      for (let i = 0; i < toFetch.length; i += batchSize) {
        batches.push(toFetch.slice(i, i + batchSize));
      }
      const results = await Promise.allSettled(
        batches.map((batch) => fetchEventCounts(batch))
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          primalStatsCache.update(result.value);
        }
      }
      if (prefetchQueue.length > 0) {
        toFetch = Array.from(new Set(prefetchQueue)).filter((id) => !primalStatsCache.has(id));
        prefetchQueue = [];
      } else {
        toFetch = [];
      }
    }
  } catch {
    prefetchCooldownUntil = Date.now() + 10000;
    prefetchQueue = [];
  } finally {
    prefetchInFlight = false;
  }
}

export interface PrimalFeedResult {
  posts: Event[];
  profiles: Event[];
  statsLoaded: boolean;
}

export async function fetchGlobalFeed(limit: number = 50, since?: number, until?: number, userPubkey?: string): Promise<PrimalFeedResult> {
  await ensureConnection();
  const subId = nextSubId();
  const params: any = { limit, include_replies: false };
  if (since) params.since = since;
  if (until) params.until = until;
  if (userPubkey) params.user_pubkey = userPubkey;

  const events = await request(subId, {
    cache: ["feed", params],
  }, 12000);

  const posts: Event[] = [];
  const profiles: Event[] = [];
  const seenIds = new Set<string>();
  let statsLoaded = false;

  for (const event of events) {
    if (event.kind === 1) {
      trackEventRelay(event.id, PRIMAL_CACHE_URL);
      eventStore.add(event);
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        posts.push(event);
      }
    } else if (event.kind === 6) {
      trackEventRelay(event.id, PRIMAL_CACHE_URL);
      eventStore.add(event);
    } else if (event.kind === 0) {
      registerProfileInAllCaches(event);
      profiles.push(event);
    } else if (event.kind === 10000100) {
      const parsed = parseEventStats(event);
      primalStatsCache.update(parsed);
      statsLoaded = true;
    }
  }

  return {
    posts: posts.sort((a, b) => b.created_at - a.created_at),
    profiles,
    statsLoaded,
  };
}

export async function fetchFollowsFeed(pubkey: string, limit: number = 50, since?: number, until?: number): Promise<PrimalFeedResult> {
  await ensureConnection();
  const subId = nextSubId();
  const params: any = { pubkey, limit, include_replies: false };
  if (since) params.since = since;
  if (until) params.until = until;

  const events = await request(subId, {
    cache: ["feed", params],
  }, 12000);

  const posts: Event[] = [];
  const profiles: Event[] = [];
  const seenIds = new Set<string>();
  let statsLoaded = false;

  for (const event of events) {
    if (event.kind === 1) {
      trackEventRelay(event.id, PRIMAL_CACHE_URL);
      eventStore.add(event);
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        posts.push(event);
      }
    } else if (event.kind === 6) {
      trackEventRelay(event.id, PRIMAL_CACHE_URL);
      eventStore.add(event);
    } else if (event.kind === 0) {
      registerProfileInAllCaches(event);
      profiles.push(event);
    } else if (event.kind === 10000100) {
      const parsed = parseEventStats(event);
      primalStatsCache.update(parsed);
      statsLoaded = true;
    }
  }

  return {
    posts: posts.sort((a, b) => b.created_at - a.created_at),
    profiles,
    statsLoaded,
  };
}

export async function fetchNip45Count(filter: { kinds: number[]; "#e"?: string[]; "#p"?: string[]; authors?: string[] }): Promise<number> {
  await ensureConnection();
  const subId = nextSubId();
  return countRequest(subId, filter);
}

export async function fetchUserProfileStats(pubkey: string): Promise<UserProfileStats> {
  await ensureConnection();
  const subId = nextSubId();
  const events = await request(subId, {
    cache: ["user_profile", {
      pubkey,
    }],
  });

  for (const event of events) {
    if (event.kind === 0) {
      registerProfileInAllCaches(event);
    }
  }

  return parseUserProfileStats(events);
}

export async function fetchTrendingFeed(selector: string = "trending_4h", userPubkey?: string, limit: number = 30): Promise<Event[]> {
  await ensureConnection();
  const subId = nextSubId();
  const params: any = { selector };
  if (userPubkey) params.user_pubkey = userPubkey;

  const events = await request(subId, {
    cache: ["scored", params],
  }, 15000);

  const posts: Event[] = [];
  for (const event of events) {
    if (event.kind === 1 || event.kind === 6) {
      trackEventRelay(event.id, PRIMAL_CACHE_URL);
      eventStore.add(event);
      if (event.kind === 1) posts.push(event);
    }
    if (event.kind === 0) {
      registerProfileInAllCaches(event);
    }
    if (event.kind === 10000100) {
      const parsed = parseEventStats(event);
      primalStatsCache.update(parsed);
    }
  }

  return posts.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

export async function fetchPrimalArticles(
  limit: number = 20,
  until?: number,
  topic?: string,
  pubkey?: string,
  userPubkey?: string,
): Promise<{ articles: Event[]; statsLoaded: boolean }> {
  const articles: Event[] = [];
  const seenIds = new Set<string>();
  let statsLoaded = false;

  try {
    await ensureConnection();
    if (!ws || !wsReady) return { articles, statsLoaded };

    const subId = nextSubId();
    const params: any = { limit };
    if (until && until > 0) params.until = until;
    if (topic) params.topic = topic;
    if (pubkey) params.pubkey = pubkey;
    if (userPubkey) params.user_pubkey = userPubkey;

    const events = await request(subId, {
      cache: ["long_form_content_feed", params],
    }, 8000);

    for (const event of events) {
      if (event.kind === 30023) {
        trackEventRelay(event.id, PRIMAL_CACHE_URL);
        eventStore.add(event);
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          articles.push(event);
        }
      } else if (event.kind === 0) {
        registerProfileInAllCaches(event);
      } else if (event.kind === 10000100) {
        const parsed = parseEventStats(event);
        primalStatsCache.update(parsed);
        statsLoaded = true;
      }
    }
  } catch (err) {
    console.warn("[Primal] fetchPrimalArticles failed:", err);
  }

  return { articles: articles.sort((a, b) => b.created_at - a.created_at), statsLoaded };
}

export async function fetchThreadView(eventId: string, userPubkey?: string): Promise<Event[]> {
  const replies: Event[] = [];

  try {
    await ensureConnection();
    if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
      const subId = nextSubId();
      const params: any = { event_id: eventId, limit: 50 };
      if (userPubkey) params.user_pubkey = userPubkey;

      const events = await request(subId, {
        cache: ["thread_view", params],
      }, 3000);

      const seenIds = new Set<string>();
      for (const event of events) {
        if (event.kind === 1) {
          eventStore.add(event);
          if (event.id !== eventId && !seenIds.has(event.id)) {
            seenIds.add(event.id);
            replies.push(event);
          }
        }
        if (event.kind === 0) {
          registerProfileInAllCaches(event);
        }
        if (event.kind === 10000100) {
          const parsed = parseEventStats(event);
          primalStatsCache.update(parsed);
        }
      }

      if (replies.length > 0) {
        const replyIds = replies.map((r) => r.id).slice(0, 30);
        if (replyIds.length > 0) {
          try {
            const { pool, DEFAULT_RELAYS } = await import("./nostr");
            const nestedReplies = await Promise.race([
              pool.querySync(DEFAULT_RELAYS.slice(0, 4), {
                kinds: [1],
                "#e": replyIds,
                limit: 100,
              }),
              new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 3000)),
            ]);
            for (const event of nestedReplies) {
              eventStore.add(event);
              if (event.id !== eventId && !seenIds.has(event.id)) {
                seenIds.add(event.id);
                replies.push(event);
              }
            }
            const nestedReplyIds = nestedReplies.filter((e) => e.kind === 1 && !replyIds.includes(e.id)).map((e) => e.id).slice(0, 30);
            if (nestedReplyIds.length > 0) {
              const deeperReplies = await Promise.race([
                pool.querySync(DEFAULT_RELAYS.slice(0, 4), {
                  kinds: [1],
                  "#e": nestedReplyIds,
                  limit: 50,
                }),
                new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 2500)),
              ]);
              for (const event of deeperReplies) {
                eventStore.add(event);
                if (event.id !== eventId && !seenIds.has(event.id)) {
                  seenIds.add(event.id);
                  replies.push(event);
                }
              }
            }
          } catch (err) {
            console.warn("[Thread] Nested reply fetch failed:", err);
          }
        }
        return replies.sort((a, b) => a.created_at - b.created_at);
      }
    }
  } catch (err) {
    console.warn("[Primal] Thread view failed, falling back to relays:", err);
  }

  try {
    const { pool, DEFAULT_RELAYS } = await import("./nostr");
    const relayReplies = await Promise.race([
      pool.querySync(DEFAULT_RELAYS.slice(0, 4), {
        kinds: [1],
        "#e": [eventId],
        limit: 50,
      }),
      new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 3000)),
    ]);
    const seenIds = new Set<string>();
    for (const event of relayReplies) {
      eventStore.add(event);
      if (event.id !== eventId && !seenIds.has(event.id)) {
        seenIds.add(event.id);
        replies.push(event);
      }
    }
    const directReplyIds = replies.map((e) => e.id).slice(0, 30);
    if (directReplyIds.length > 0) {
      try {
        const nestedReplies = await Promise.race([
          pool.querySync(DEFAULT_RELAYS.slice(0, 4), {
            kinds: [1],
            "#e": directReplyIds,
            limit: 100,
          }),
          new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 2500)),
        ]);
        for (const event of nestedReplies) {
          eventStore.add(event);
          if (event.id !== eventId && !seenIds.has(event.id)) {
            seenIds.add(event.id);
            replies.push(event);
          }
        }
      } catch {}
    }
    const authorPubkeys = Array.from(new Set(replies.map((e) => e.pubkey))).slice(0, 30);
    if (authorPubkeys.length > 0) {
      const profiles = await Promise.race([
        pool.querySync(DEFAULT_RELAYS.slice(0, 3), {
          kinds: [0],
          authors: authorPubkeys,
        }),
        new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 2500)),
      ]);
      for (const p of profiles) registerProfileInAllCaches(p);
    }
    const replyIds = replies.map((e) => e.id).slice(0, 50);
    if (replyIds.length > 0) {
      const { fetchInteractions } = await import("./nostr");
      fetchInteractions(replyIds, DEFAULT_RELAYS.slice(0, 4));
    }
  } catch (err) {
    console.error("[Relay fallback] Thread fetch error:", err);
  }

  return replies.sort((a, b) => a.created_at - b.created_at);
}

const threadCache = new Map<string, { replies: Event[]; timestamp: number }>();
const THREAD_CACHE_TTL = 60000;

export function getCachedThread(eventId: string): Event[] | null {
  const cached = threadCache.get(eventId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > THREAD_CACHE_TTL) {
    threadCache.delete(eventId);
    return null;
  }
  return cached.replies;
}

export function setCachedThread(eventId: string, replies: Event[]) {
  threadCache.set(eventId, { replies: [...replies], timestamp: Date.now() });
  if (threadCache.size > 200) {
    const oldest = Array.from(threadCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    for (const [k] of oldest) threadCache.delete(k);
  }
}

export function fetchThreadRepliesStreaming(
  eventId: string,
  onReplies: (replies: Event[]) => void,
  opts?: { signal?: AbortSignal }
): { cancel: () => void } {
  const seenIds = new Set<string>();
  const allReplies: Event[] = [];
  let cancelled = false;
  let relaySubClose: (() => void) | null = null;

  const pendingEvents: Event[] = [];
  const acceptedIds = new Set<string>([eventId]);

  const getReplyTarget = (event: Event): string | null => {
    const eTags = event.tags.filter((t) => t[0] === "e");
    if (eTags.length === 0) return null;
    const replyTag = eTags.find((t) => t[3] === "reply");
    if (replyTag) return replyTag[1];
    const rootTag = eTags.find((t) => t[3] === "root");
    if (rootTag) {
      const nonRoot = eTags.filter((t) => t[3] !== "root");
      if (nonRoot.length > 0) return nonRoot[nonRoot.length - 1][1];
      return rootTag[1];
    }
    if (eTags.length === 1) return eTags[0][1];
    return eTags[eTags.length - 1][1];
  };

  const isDescendant = (event: Event): boolean => {
    const replyTarget = getReplyTarget(event);
    if (!replyTarget) return false;
    return acceptedIds.has(replyTarget);
  };

  const tryFlushPending = () => {
    if (pendingEvents.length === 0) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = pendingEvents.length - 1; i >= 0; i--) {
        if (isDescendant(pendingEvents[i])) {
          const evt = pendingEvents.splice(i, 1)[0];
          seenIds.add(evt.id);
          acceptedIds.add(evt.id);
          eventStore.add(evt);
          allReplies.push(evt);
          changed = true;
        }
      }
    }
    if (allReplies.length > 0) {
      onReplies(allReplies.slice().sort((a, b) => a.created_at - b.created_at));
    }
  };

  const addReply = (event: Event) => {
    if (cancelled) return;
    if (event.id === eventId || seenIds.has(event.id)) return;
    if (event.kind !== 1) {
      if (event.kind === 0) registerProfileInAllCaches(event);
      if (event.kind === 10000100) {
        const parsed = parseEventStats(event);
        primalStatsCache.update(parsed);
      }
      return;
    }
    if (isDescendant(event)) {
      seenIds.add(event.id);
      acceptedIds.add(event.id);
      eventStore.add(event);
      allReplies.push(event);
      onReplies(allReplies.slice().sort((a, b) => a.created_at - b.created_at));
      tryFlushPending();
    } else {
      seenIds.add(event.id);
      pendingEvents.push(event);
    }
  };

  const cancel = () => {
    cancelled = true;
    relaySubClose?.();
  };

  if (opts?.signal) {
    opts.signal.addEventListener("abort", cancel, { once: true });
  }

  (async () => {
    const { throttledPoolSubscribe, FAST_RELAYS } = await import("./nostr");
    if (cancelled) return;

    const primalPromise = (async () => {
      try {
        await ensureConnection();
        if (ws && wsReady && ws.readyState === WebSocket.OPEN) {
          const subId = nextSubId();
          const params: any = { event_id: eventId, limit: 50 };
          const events = await request(subId, {
            cache: ["thread_view", params],
          }, 2500);
          if (cancelled) return;
          for (const event of events) {
            addReply(event);
          }
          tryFlushPending();
        }
      } catch {}
    })();

    const relayPromise = new Promise<void>((resolve) => {
      if (cancelled) { resolve(); return; }
      const timeout = setTimeout(() => {
        relaySubClose?.();
        resolve();
      }, 3000);

      const sub = throttledPoolSubscribe(
        FAST_RELAYS.slice(0, 4),
        { kinds: [1], "#e": [eventId], limit: 50 },
        {
          onevent: (event: Event) => {
            addReply(event);
          },
          oneose: () => {
            clearTimeout(timeout);
            relaySubClose?.();
            resolve();
          },
        }
      );
      relaySubClose = () => sub.close();
    });

    await Promise.all([primalPromise, relayPromise]);
    tryFlushPending();

    if (allReplies.length > 0) {
      setCachedThread(eventId, allReplies);
    }

    if (cancelled || allReplies.length === 0) return;

    try {
      const tps = throttledPoolSubscribe;
      const fr = FAST_RELAYS;
      const fetchedParentIds = new Set<string>([eventId]);

      for (let pass = 0; pass < 3; pass++) {
        if (cancelled) break;
        const newIds = allReplies
          .map((e) => e.id)
          .filter((id) => !fetchedParentIds.has(id));
        if (newIds.length === 0) break;

        newIds.forEach((id) => fetchedParentIds.add(id));
        const countBefore = allReplies.length;

        await new Promise<void>((resolve) => {
          const activeSubs: { close: () => void }[] = [];
          const timeout = setTimeout(() => {
            activeSubs.forEach(s => { try { s.close(); } catch {} });
            resolve();
          }, 3000);

          const batchSize = 30;
          const batches = [];
          for (let i = 0; i < newIds.length; i += batchSize) {
            batches.push(newIds.slice(i, i + batchSize));
          }

          if (batches.length === 0) {
            clearTimeout(timeout);
            resolve();
          } else {
            let done = 0;
            const checkDone = () => {
              done++;
              if (done >= batches.length) {
                clearTimeout(timeout);
                resolve();
              }
            };
            for (const batch of batches) {
              const sub = tps(
                fr.slice(0, 4),
                { kinds: [1], "#e": batch, limit: 100 },
                {
                  onevent: (event: Event) => { addReply(event); },
                  oneose: () => { sub.close(); checkDone(); },
                }
              );
              activeSubs.push(sub);
            }
          }
        });

        if (allReplies.length === countBefore) break;
      }

      if (allReplies.length > 0) {
        setCachedThread(eventId, allReplies);
      }
    } catch {}

    const pubkeys = Array.from(new Set(allReplies.map((e) => e.pubkey))).slice(0, 30);
    if (pubkeys.length > 0) {
      try {
        const { fetchProfilesCached } = await import("./nostr");
        fetchProfilesCached(pubkeys);
      } catch {}
    }

    const replyIds = allReplies.map((e) => e.id).filter((id) => !primalStatsCache.has(id)).slice(0, 50);
    if (replyIds.length > 0) {
      try {
        const stats = await fetchEventCounts(replyIds);
        primalStatsCache.update(stats);
      } catch {}
    }
  })();

  return { cancel };
}

export async function searchArticles(query: string, limit: number = 8): Promise<Event[]> {
  const articles: Event[] = [];
  const seen = new Set<string>();
  if (!query.trim()) return articles;

  try {
    const { pool } = await import("./nostr");
    const searchRelays = ["wss://relay.nostr.band", "wss://search.nos.today"];
    const events = await pool.querySync(searchRelays, { kinds: [30023], search: query, limit });
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      eventStore.add(event);
      articles.push(event);
    }
  } catch {}

  return articles;
}

export async function searchNostr(query: string, limit: number = 20, userPubkey?: string): Promise<Event[]> {
  // Run BOTH the Primal cache search (ranked) and a relay NIP-50 search
  // concurrently, each bounded so neither can hang the UI: the Primal cache
  // socket retries-forever on connect, and a NIP-50 relay may connect but never
  // send EOSE. Merge Primal's ranked results with relay hits. Because they run in
  // parallel, total latency is the slower single leg, not their sum.
  const primalAttempt: Promise<Event[]> = (async () => {
    try {
      const connected = await Promise.race([
        ensureConnection().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
      ]);
      if (!connected || !ws || !wsReady) return [];
      const subId = nextSubId();
      const filter: any = { cache: ["search", { query, limit }] };
      if (userPubkey) filter.cache[1].user_pubkey = userPubkey;
      const events = await request(subId, filter, 4000);
      const out: Event[] = [];
      for (const event of events) {
        if (event.kind === 1) { eventStore.add(event); out.push(event); }
        else if (event.kind === 0) { registerProfileInAllCaches(event); }
      }
      return out;
    } catch { return []; }
  })();

  const relayAttempt: Promise<Event[]> = (async () => {
    try {
      const { pool } = await import("./nostr");
      // maxWait: querySync otherwise waits for EOSE from EVERY relay, so one that
      // connects but never EOSEs (observed on relay.nostr.band) hangs forever.
      const events = await pool.querySync(
        ["wss://relay.nostr.band", "wss://relay.damus.io", "wss://search.nos.today"],
        { kinds: [1], search: query, limit },
        { maxWait: 5000 },
      );
      const out: Event[] = [];
      for (const event of events) { eventStore.add(event); out.push(event); }
      return out;
    } catch (err) {
      console.error("[Search relay] error:", err);
      return [];
    }
  })();

  // Merge both legs (don't fall back only when Primal is empty): Primal's ranked
  // results first, then any NIP-50 relay hits not already present — more coverage,
  // de-duplicated by event id.
  const [primalPosts, relayPosts] = await Promise.all([primalAttempt, relayAttempt]);
  const seen = new Set<string>();
  const posts: Event[] = [];
  for (const e of [...primalPosts, ...relayPosts]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    posts.push(e);
  }
  hydrateSearchAuthors(posts);
  return posts;
}

// Hydrate author profiles for search results in the background — never block
// the rendered posts on this (cards fall back to cache until profiles arrive).
function hydrateSearchAuthors(posts: Event[]): void {
  const pubkeys = Array.from(new Set(posts.map((e) => e.pubkey))).slice(0, 50);
  if (pubkeys.length === 0) return;
  import("./nostr")
    .then(({ pool, DEFAULT_RELAYS }) =>
      pool
        .querySync(DEFAULT_RELAYS.slice(0, 3), { kinds: [0], authors: pubkeys }, { maxWait: 4000 })
        .then((profiles) => { for (const p of profiles) registerProfileInAllCaches(p); })
        .catch(() => {}),
    )
    .catch(() => {});
}

export async function searchNostrPaginated(query: string, limit: number = 20, until?: number, seenIds?: Set<string>, userPubkey?: string): Promise<Event[]> {
  // Same merge strategy as searchNostr: run Primal (ranked) + NIP-50 relays in
  // parallel and combine, rather than relay-only-when-Primal-empty. Both legs are
  // bounded so neither hangs the "load more".
  const primalLeg: Promise<Event[]> = (async () => {
    try {
      // Bound the Primal connect — ensureConnection() retries forever, so never await it raw.
      const connected = await Promise.race([
        ensureConnection().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
      ]);
      if (!connected || !ws || !wsReady) return [];
      const subId = nextSubId();
      const params: any = { query, limit };
      if (until) params.until = until;
      if (userPubkey) params.user_pubkey = userPubkey;
      const events = await request(subId, { cache: ["search", params] }, 4000);
      const out: Event[] = [];
      for (const event of events) {
        if (event.kind === 1) { eventStore.add(event); out.push(event); }
        else if (event.kind === 0) { registerProfileInAllCaches(event); }
      }
      return out;
    } catch { return []; }
  })();

  const relayLeg: Promise<Event[]> = (async () => {
    try {
      const { pool } = await import("./nostr");
      const filter: any = { kinds: [1], search: query, limit };
      if (until) filter.until = until;
      // maxWait — see searchNostr: a non-EOSEing search relay must not hang the call.
      const events = await pool.querySync(
        ["wss://relay.nostr.band", "wss://relay.damus.io", "wss://search.nos.today"],
        filter,
        { maxWait: 5000 },
      );
      const out: Event[] = [];
      for (const event of events) { eventStore.add(event); out.push(event); }
      return out;
    } catch (err) {
      console.error("[Search paginated relay] error:", err);
      return [];
    }
  })();

  const [primalPosts, relayPosts] = await Promise.all([primalLeg, relayLeg]);
  // Skip ids already shown (caller passes the running seen-set), Primal first.
  const seen = new Set<string>(seenIds ? Array.from(seenIds) : []);
  const posts: Event[] = [];
  for (const e of [...primalPosts, ...relayPosts]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    posts.push(e);
  }
  hydrateSearchAuthors(posts);
  return posts;
}

export interface SearchUsersStatus {
  events: Event[];
  attempted: number;
  reachable: number;
  allBackendsFailed: boolean;
}

export async function searchUsersWithStatus(query: string, limit: number = 10): Promise<SearchUsersStatus> {
  (searchUsers as any).__lastWotScores = null;
  let attempted = 0;
  let reachable = 0;

  attempted++;
  try {
    const { events, wotScores } = await searchBrainstorm(query, limit);
    reachable++;
    if (events.length > 0) {
      if (wotScores.size > 0) {
        (searchUsers as any).__lastWotScores = wotScores;
      }
      return { events, attempted, reachable, allBackendsFailed: false };
    }
  } catch {}

  const profiles: Event[] = [];

  attempted++;
  try {
    await ensureConnection();
    if (ws && wsReady) {
      reachable++;
      const subId = nextSubId();
      const events = await request(subId, { cache: ["user_search", { query, limit }] }, 8000);
      for (const event of events) {
        if (event.kind === 0) { registerProfileInAllCaches(event); profiles.push(event); }
      }
      if (profiles.length > 0) return { events: profiles, attempted, reachable, allBackendsFailed: false };
    }
  } catch {}

  attempted++;
  try {
    const { pool } = await import("./nostr");
    const searchRelays = ["wss://relay.nostr.band", "wss://search.nos.today"];
    // maxWait: querySync otherwise waits for EOSE from every relay; relay.nostr.band
    // is known to connect but never EOSE, which would hang People search forever.
    const events = await pool.querySync(searchRelays, { kinds: [0], search: query, limit }, { maxWait: 5000 });
    reachable++;
    for (const event of events) {
      registerProfileInAllCaches(event);
      profiles.push(event);
    }
  } catch (err) {
    console.error("[User search fallback] error:", err);
  }

  return { events: profiles, attempted, reachable, allBackendsFailed: reachable === 0 };
}

export async function searchUsers(query: string, limit: number = 10): Promise<Event[]> {
  const { events } = await searchUsersWithStatus(query, limit);
  return events;
}

export function getLastBrainstormWotScores(): Map<string, number | null> | null {
  return (searchUsers as any).__lastWotScores || null;
}

export async function fetchUserAuthoredFeed(pubkey: string, limit: number = 50): Promise<{ notes: Event[]; reposts: Event[]; repostOriginals: Event[]; statsLoaded: boolean }> {
  const notes: Event[] = [];
  const reposts: Event[] = [];
  const repostOriginals: Event[] = [];
  const seenIds = new Set<string>();
  let statsLoaded = false;

  try {
    await ensureConnection();
    if (ws && wsReady) {
      const subId = nextSubId();
      const events = await request(subId, {
        cache: ["feed", { pubkey, limit, include_replies: false }],
      }, 12000);

      for (const event of events) {
        if (event.kind === 6 && event.pubkey === pubkey) {
          reposts.push(event);
        } else if (event.kind === 1) {
          eventStore.add(event);
          if (seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          if (event.pubkey === pubkey) {
            notes.push(event);
          } else {
            repostOriginals.push(event);
          }
        } else if (event.kind === 0) {
          registerProfileInAllCaches(event);
        } else if (event.kind === 10000100) {
          const parsed = parseEventStats(event);
          primalStatsCache.update(parsed);
          statsLoaded = true;
        }
      }
    } else {
      console.warn("[Primal] fetchUserAuthoredFeed: WS not ready");
    }
  } catch (err) {
    console.warn("[Primal] fetchUserAuthoredFeed failed:", err);
  }

  if (reposts.length === 0) {
    console.log("[Primal] No reposts from Primal feed API, querying relays for kind 6...");
    try {
      const { pool, DEFAULT_RELAYS } = await import("./nostr");
      const repostEvents = await pool.querySync(DEFAULT_RELAYS, {
        kinds: [6],
        authors: [pubkey],
        limit: 30,
      });
      console.log("[Primal] Relay kind 6 query returned:", repostEvents.length, "events");
      for (const event of repostEvents) {
        if (event.kind === 6) {
          reposts.push(event);
        }
      }
    } catch (err) {
      console.warn("[Primal] Relay kind 6 fallback failed:", err);
    }
  }

  return { notes, reposts, repostOriginals, statsLoaded };
}

export async function fetchUserNotesPaginated(
  pubkey: string,
  until: number,
  limit: number = 50,
): Promise<{ events: Event[]; statsLoaded: boolean; ok: boolean }> {
  const events: Event[] = [];
  const seenIds = new Set<string>();
  let statsLoaded = false;

  try {
    await ensureConnection();
    if (!ws || !wsReady) {
      return { events: [], statsLoaded: false, ok: false };
    }
    const subId = nextSubId();
    const raw = await request(subId, {
      cache: ["feed", { pubkey, limit, until, include_replies: true }],
    }, 8000);

    for (const ev of raw) {
      if (ev.kind === 1 && ev.pubkey === pubkey) {
        if (seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        events.push(ev);
      } else if (ev.kind === 0) {
        registerProfileInAllCaches(ev);
      } else if (ev.kind === 10000100) {
        const parsed = parseEventStats(ev);
        primalStatsCache.update(parsed);
        statsLoaded = true;
      }
    }

    return { events, statsLoaded, ok: true };
  } catch (err) {
    console.warn("[Primal] fetchUserNotesPaginated failed:", err);
    return { events: [], statsLoaded: false, ok: false };
  }
}

export async function fetchExplorePeople(limit: number = 20, userPubkey?: string): Promise<Event[]> {
  await ensureConnection();
  const subId = nextSubId();
  const params: any = { limit };
  if (userPubkey) params.user_pubkey = userPubkey;

  const events = await request(subId, {
    cache: ["explore_people", params],
  });

  const profiles: Event[] = [];
  for (const event of events) {
    if (event.kind === 0) {
      registerProfileInAllCaches(event);
      profiles.push(event);
    }
  }

  return profiles;
}

export async function fetchBulkProfiles(pubkeys: string[]): Promise<Event[]> {
  if (pubkeys.length === 0) return [];
  await ensureConnection();

  const profiles: Event[] = [];
  const seen = new Set<string>();
  const CHUNK = 100;

  const chunks: string[][] = [];
  for (let i = 0; i < pubkeys.length; i += CHUNK) {
    chunks.push(pubkeys.slice(i, i + CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const subId = nextSubId();
      return request(subId, {
        cache: ["user_infos", { pubkeys: chunk }],
      }, 5000);
    })
  );

  for (const events of results) {
    for (const event of events) {
      if (event.kind === 0 && !seen.has(event.pubkey)) {
        seen.add(event.pubkey);
        registerProfileInAllCaches(event);
        profiles.push(event);
      }
    }
  }

  return profiles;
}

export async function fetchFollowersList(pubkey: string, limit: number = 200, offset: number = 0): Promise<{ profiles: Event[]; hasMore: boolean }> {
  await ensureConnection();
  const subId = nextSubId();
  const params: Record<string, unknown> = { pubkey, limit };
  if (offset > 0) params.offset = offset;
  const events = await request(subId, {
    cache: ["user_followers", params],
  }, 8000);

  let rawKind0Count = 0;
  const profiles: Event[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.kind === 0) {
      rawKind0Count++;
      if (!seen.has(event.pubkey)) {
        seen.add(event.pubkey);
        registerProfileInAllCaches(event);
        profiles.push(event);
      }
    }
  }

  return { profiles, hasMore: rawKind0Count >= limit };
}

const STATS_STORAGE_KEY = "nostr_stats_cache";
const STATS_MAX_ENTRIES = 500;
let statsPersistTimer: ReturnType<typeof setTimeout> | null = null;

function loadStatsFromStorage(): Map<string, EventStats> {
  try {
    const raw = sessionStorage.getItem(STATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, EventStats>;
      return new Map(Object.entries(parsed));
    }
  } catch {}
  return new Map();
}

function persistStatsToStorage(cache: Map<string, EventStats>) {
  if (statsPersistTimer) return;
  statsPersistTimer = setTimeout(() => {
    statsPersistTimer = null;
    try {
      const entries = Array.from(cache.entries());
      const trimmed = entries.slice(-STATS_MAX_ENTRIES);
      const obj: Record<string, EventStats> = {};
      for (const [k, v] of trimmed) obj[k] = v;
      sessionStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }, 2000);
}

class PrimalStatsCache {
  private cache: Map<string, EventStats>;
  private listeners = new Map<string, Set<(stats: EventStats) => void>>();
  // "Any stats changed" listeners — used by feed-level sorters (e.g. the
  // custom-feed Hot/Top/Most Zapped sort in Home) that rank many events at
  // once and need to re-sort when a batch of stats lands, without
  // subscribing to every individual event id.
  private anyListeners = new Set<() => void>();

  constructor() {
    this.cache = loadStatsFromStorage();
  }

  get(eventId: string): EventStats | undefined {
    return this.cache.get(eventId);
  }

  set(eventId: string, stats: EventStats) {
    this.cache.set(eventId, stats);
    this.notify(eventId, stats);
    this.notifyAny();
    persistStatsToStorage(this.cache);
  }

  update(stats: Record<string, EventStats>) {
    let changed = false;
    for (const [id, s] of Object.entries(stats)) {
      const existing = this.cache.get(id);
      if (existing) {
        const merged: EventStats = {
          replies: Math.max(existing.replies, s.replies),
          reposts: Math.max(existing.reposts, s.reposts),
          likes: Math.max(existing.likes, s.likes),
          zaps: Math.max(existing.zaps, s.zaps),
          zapAmount: Math.max(existing.zapAmount, s.zapAmount),
        };
        this.cache.set(id, merged);
        this.notify(id, merged);
      } else {
        this.cache.set(id, s);
        this.notify(id, s);
      }
      changed = true;
    }
    if (changed) this.notifyAny();
    persistStatsToStorage(this.cache);
  }

  has(eventId: string): boolean {
    return this.cache.has(eventId);
  }

  /** Subscribe to ANY stats arrival (batched fetches fire this once per batch). */
  subscribeAny(cb: () => void): () => void {
    this.anyListeners.add(cb);
    return () => { this.anyListeners.delete(cb); };
  }

  subscribe(eventId: string, cb: (stats: EventStats) => void): () => void {
    if (!this.listeners.has(eventId)) this.listeners.set(eventId, new Set());
    this.listeners.get(eventId)!.add(cb);
    return () => {
      const set = this.listeners.get(eventId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) this.listeners.delete(eventId);
      }
    };
  }

  private notify(eventId: string, stats: EventStats) {
    const set = this.listeners.get(eventId);
    if (set) set.forEach(cb => cb(stats));
  }

  private notifyAny() {
    this.anyListeners.forEach(cb => { try { cb(); } catch {} });
  }
}

export const primalStatsCache = new PrimalStatsCache();

const LAST_REPLY_CACHE_MAX = 5000;
const LAST_REPLY_CACHE_PRUNE = 3000;
export const lastReplyTimestampCache = new Map<string, number>();

function pruneLastReplyCache() {
  if (lastReplyTimestampCache.size <= LAST_REPLY_CACHE_MAX) return;
  const entries = [...lastReplyTimestampCache.entries()].sort((a, b) => a[1] - b[1]);
  const toRemove = entries.slice(0, entries.length - LAST_REPLY_CACHE_PRUNE);
  for (const [id] of toRemove) lastReplyTimestampCache.delete(id);
}

export function updateLastReplyTimestamp(parentId: string, replyCreatedAt: number) {
  const existing = lastReplyTimestampCache.get(parentId) ?? 0;
  if (replyCreatedAt > existing) {
    lastReplyTimestampCache.set(parentId, replyCreatedAt);
    pruneLastReplyCache();
  }
}

export function getLastReplyTimestamp(eventId: string): number {
  return lastReplyTimestampCache.get(eventId) ?? 0;
}

export function getReplyParentId(event: { tags: string[][] }): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  const replyTag = eTags.find((t) => t[3] === "reply");
  if (replyTag) return replyTag[1];
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) {
    const nonRoot = eTags.filter((t) => t[3] !== "root");
    if (nonRoot.length > 0) return nonRoot[nonRoot.length - 1][1];
    return rootTag[1];
  }
  if (eTags.length === 1) return eTags[0][1];
  return eTags[eTags.length - 1][1];
}

export interface TrendingHashtag {
  hashtag: string;
  posts: number;
  authors: number;
  activity: number[];
}

const TREND_BUCKETS = 8;

const NOSTR_SEED_TAGS = [
  "bitcoin", "nostr", "asknostr", "grownostr", "photography",
  "fitness", "pow", "runstr", "news", "christianity",
  "motivation", "health", "naturestr", "war",
  "zaps", "plebchain", "foodstr", "artstr", "bookstr",
  "coffeechain", "damus", "primal", "zapathon", "memestr",
  "science", "music", "tech", "freedom", "privacy",
  "lightning", "opensource", "devstr", "travel", "gaming",
  "amethyst", "wot", "sports",
];

function extractHashtagsFromPost(post: Event): string[] {
  const tags = new Set<string>();
  for (const tag of post.tags) {
    if (tag[0] === "t" && tag[1]) {
      const ht = tag[1].toLowerCase().trim();
      if (ht && ht.length > 1 && ht.length < 50) tags.add(ht);
    }
  }
  const contentMatches = (post.content || "").match(/#[a-zA-Z]\w{1,48}/g);
  if (contentMatches) {
    for (const m of contentMatches) {
      const ht = m.slice(1).toLowerCase();
      if (ht.length > 1) tags.add(ht);
    }
  }
  return Array.from(tags);
}

export async function fetchTrendingHashtags(limit: number = 40): Promise<TrendingHashtag[]> {
  await ensureConnection();

  const selectors = ["trending_4h", "trending", "mostzapped_4h", "hot"];
  const allPosts: Event[] = [];
  const seenIds = new Set<string>();

  const results = await Promise.allSettled(
    selectors.map(s => fetchTrendingFeed(s, undefined, 100))
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const p of r.value) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          allPosts.push(p);
        }
      }
    }
  }

  console.log(`[TrendingHashtags] ${allPosts.length} unique posts from ${selectors.length} feeds`);

  const now = Math.floor(Date.now() / 1000);
  const windowSecs = 24 * 60 * 60;
  const bucketSize = windowSecs / TREND_BUCKETS;

  const counts = new Map<string, number>();
  const authorSets = new Map<string, Set<string>>();
  const buckets = new Map<string, number[]>();

  for (const post of allPosts) {
    const hashtags = extractHashtagsFromPost(post);
    const age = now - post.created_at;
    const bucketIdx = Math.min(TREND_BUCKETS - 1, Math.max(0, Math.floor(age / bucketSize)));
    const reversedIdx = TREND_BUCKETS - 1 - bucketIdx;
    for (const ht of hashtags) {
      counts.set(ht, (counts.get(ht) || 0) + 1);
      if (!authorSets.has(ht)) authorSets.set(ht, new Set());
      authorSets.get(ht)!.add(post.pubkey);
      if (!buckets.has(ht)) buckets.set(ht, new Array(TREND_BUCKETS).fill(0));
      buckets.get(ht)![reversedIdx]++;
    }
  }

  const shuffled = [...NOSTR_SEED_TAGS].sort(() => Math.random() - 0.5);
  for (const seed of shuffled) {
    const lc = seed.toLowerCase();
    if (!counts.has(lc)) {
      counts.set(lc, 0);
      authorSets.set(lc, new Set());
      buckets.set(lc, new Array(TREND_BUCKETS).fill(0));
    }
  }

  const seedSet = new Set(NOSTR_SEED_TAGS.map(s => s.toLowerCase()));

  console.log(`[TrendingHashtags] ${counts.size} unique hashtags found (${NOSTR_SEED_TAGS.length} seeds)`);

  return Array.from(counts.entries())
    .sort((a, b) => {
      const authA = authorSets.get(a[0])?.size || 0;
      const authB = authorSets.get(b[0])?.size || 0;
      const countA = a[1] + (seedSet.has(a[0]) ? 1 : 0);
      const countB = b[1] + (seedSet.has(b[0]) ? 1 : 0);
      if (authB !== authA) return authB - authA;
      return countB - countA;
    })
    .slice(0, limit)
    .map(([hashtag, postCount]) => ({
      hashtag,
      posts: postCount,
      authors: authorSets.get(hashtag)?.size || 0,
      activity: buckets.get(hashtag) || new Array(TREND_BUCKETS).fill(0),
    }));
}

const followerCountCache = new Map<string, { count: number; ts: number }>();
const FOLLOWER_CACHE_TTL = 10 * 60 * 1000;
let pendingFollowerFetches = new Set<string>();
let followerFetchTimer: ReturnType<typeof setTimeout> | null = null;
const followerFetchListeners: Array<() => void> = [];

export function onFollowerCountUpdate(cb: () => void) {
  followerFetchListeners.push(cb);
  return () => {
    const idx = followerFetchListeners.indexOf(cb);
    if (idx >= 0) followerFetchListeners.splice(idx, 1);
  };
}

export function getCachedFollowerCount(pubkey: string): number | undefined {
  const entry = followerCountCache.get(pubkey);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > FOLLOWER_CACHE_TTL) {
    followerCountCache.delete(pubkey);
    return undefined;
  }
  return entry.count;
}

function classifyZapReceipts(events: Event[], pubkey: string): { sent: Event[]; received: Event[] } {
  const sent: Event[] = [];
  const received: Event[] = [];
  for (const ev of events) {
    if (ev.kind !== 9735) continue;
    const descTag = ev.tags.find((t: string[]) => t[0] === "description");
    if (descTag && descTag[1]) {
      try {
        const desc = JSON.parse(descTag[1]);
        if (desc.pubkey === pubkey) {
          sent.push(ev);
          continue;
        }
      } catch {}
    }
    const pTags = ev.tags.filter((t: string[]) => t[0] === "p");
    if (pTags.some((t: string[]) => t[1] === pubkey)) {
      received.push(ev);
    }
  }
  return { sent, received };
}

function scanRelaysForSentZaps(pubkey: string, timeoutMs: number = 4000): Promise<Event[]> {
  const found: Event[] = [];
  const seen = new Set<string>();

  const addIfSent = (event: Event) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    const descTag = event.tags.find((t: string[]) => t[0] === "description");
    if (descTag && descTag[1]) {
      try {
        const desc = JSON.parse(descTag[1]);
        if (desc.pubkey === pubkey) {
          found.push(event);
        }
      } catch {}
    }
  };

  const scanWithFilter = (filter: any): Promise<void> => {
    return new Promise((resolve) => {
      let sub: { close: () => void } | null = null;
      let done = false;
      const finish = () => { if (done) return; done = true; if (sub) sub.close(); resolve(); };
      const timer = setTimeout(finish, timeoutMs);
      const zapRelays = [
        "wss://relay.primal.net",
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.snort.social",
        "wss://nostr.wine",
      ];
      sub = throttledPoolSubscribe(
        zapRelays,
        filter,
        {
          onevent(event: Event) { addIfSent(event); },
          oneose() { clearTimeout(timer); finish(); },
        }
      );
    });
  };

  return scanWithFilter({ kinds: [9735], "#P": [pubkey], limit: 50 })
    .then(async () => {
      if (found.length > 0) return;
      await scanWithFilter({
        kinds: [9735],
        "#p": [pubkey],
        limit: 100,
        since: Math.floor(Date.now() / 1000) - 365 * 86400,
      });
    })
    .then(() => found);
}

export async function fetchUserZaps(pubkey: string, limit: number = 20): Promise<{ sent: Event[]; received: Event[] }> {
  await ensureConnection();

  const subId = nextSubId();
  const allReceipts = await request(subId, {
    cache: ["user_zaps", { pubkey, limit: Math.max(limit, 100), offset: 0 }],
  }, 8000);

  const { sent, received } = classifyZapReceipts(allReceipts, pubkey);

  if (sent.length > 0) return { sent, received };

  const [relaySentZaps, primalZapRequests] = await Promise.all([
    scanRelaysForSentZaps(pubkey, 4000).catch(() => [] as Event[]),
    (async () => {
      const subId2 = nextSubId();
      return request(subId2, {
        kinds: [9734],
        authors: [pubkey],
        limit,
      }, 4000).catch(() => [] as Event[]);
    })(),
  ]);

  const sentSeen = new Set<string>();
  const combinedSent: Event[] = [];
  for (const e of [...relaySentZaps, ...primalZapRequests]) {
    if (!sentSeen.has(e.id)) {
      sentSeen.add(e.id);
      combinedSent.push(e);
    }
  }

  return { sent: combinedSent, received };
}

export async function fetchZapsSentByUser(pubkey: string, limit: number = 20): Promise<Event[]> {
  const { sent } = await fetchUserZaps(pubkey, limit);
  return sent;
}

export async function fetchContactListHistory(pubkey: string, limit: number = 50): Promise<Event[]> {
  try {
    await ensureConnection();
    const subId = nextSubId();
    const events = await request(subId, {
      kinds: [3],
      authors: [pubkey],
      limit,
    }, 8000);
    return events.filter(e => e.kind === 3);
  } catch {
    return [];
  }
}

export async function fetchMuteListHistory(pubkey: string, limit: number = 50): Promise<Event[]> {
  try {
    await ensureConnection();
    const subId = nextSubId();
    const events = await request(subId, {
      kinds: [10000],
      authors: [pubkey],
      limit,
    }, 8000);
    return events.filter(e => e.kind === 10000);
  } catch {
    return [];
  }
}

export function requestFollowerCounts(pubkeys: string[]) {
  const now = Date.now();
  for (const pk of pubkeys) {
    const cached = followerCountCache.get(pk);
    if (cached && now - cached.ts < FOLLOWER_CACHE_TTL) continue;
    pendingFollowerFetches.add(pk);
  }

  if (pendingFollowerFetches.size > 0 && !followerFetchTimer) {
    followerFetchTimer = setTimeout(() => {
      followerFetchTimer = null;
      flushFollowerFetches();
    }, 300);
  }
}

async function flushFollowerFetches() {
  const batch = Array.from(pendingFollowerFetches).slice(0, 50);
  pendingFollowerFetches = new Set(
    Array.from(pendingFollowerFetches).slice(50)
  );

  if (batch.length === 0) return;

  try {
    await ensureConnection();
    const results = await Promise.allSettled(
      batch.map(async (pubkey) => {
        const subId = nextSubId();
        const events = await request(subId, {
          cache: ["user_profile", { pubkey }],
        }, 6000);
        const stats = parseUserProfileStats(events);
        followerCountCache.set(pubkey, {
          count: stats.followersCount,
          ts: Date.now(),
        });
        for (const event of events) {
          if (event.kind === 0) registerProfileInAllCaches(event);
        }
      })
    );
    followerFetchListeners.forEach((cb) => cb());
  } catch (err) {
    console.warn("[Primal] Batch follower fetch error:", err);
  }

  if (pendingFollowerFetches.size > 0) {
    followerFetchTimer = setTimeout(() => {
      followerFetchTimer = null;
      flushFollowerFetches();
    }, 500);
  }
}
