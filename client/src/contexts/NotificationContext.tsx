import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Event } from "nostr-tools";
import { eventStore, FAST_RELAYS, fetchProfiles, throttledPoolSubscribe, persistentPoolSubscribe } from "@/lib/nostr";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { unwrapGiftWrap, seedProcessedWraps, KIND_DIRECT_INVITE_RUMOR } from "@/lib/gift-wrap";
import { stashDirectInviteRumor } from "@/lib/concord/concord-invites";
import { toast } from "@/hooks/use-toast";
import * as dmCache from "@/lib/dm-cache";
import { readDmLastRead, READSTATE_CHANGED_EVENT, READSTATE_HYDRATED_EVENT } from "@/lib/dm-read";
import { getCachedNotifications, cacheNotifications } from "@/lib/indexeddb-cache";
import { isMutedPubkey } from "@/lib/spam-filter";
import { readAcceptedJoins } from "@/lib/join-requests";
import { shouldNotifyForComment, DISCUSSION_PUBLIC_FLOOR } from "@/lib/external-comments";
import { KIND_COMMENT } from "@/lib/nostr-helpers";
import { detectPreset, readReachDepth } from "@/lib/trust-preset";
import { readExcludedTiers } from "@/lib/trust-filter";
import {
  subscribeMyTickets, subscribePrivateFeedback, hydrateIssues, hydratePrivateTickets,
  isIssueUnread, markIssuesRead, markIssueRead, recipientFromIssue, type FeedbackIssue,
} from "@/lib/nip34-feedback";
import type { UnwrappedRumor } from "@/lib/dm";
import { getMyDMReceiveRelays, getMyNotificationRelays, getOwnDMInboxRelays } from "@/lib/outbox";
import { setOwnDMInboxProvider } from "@/lib/nip42-auth";
import { computeNotificationRead } from "@/lib/notification-read";

interface NotificationItem {
  id: string;
  event: Event;
  type: "reply" | "mention" | "reaction" | "repost" | "zap" | "follow" | "ticket" | "accepted";
  fromPubkey: string;
  timestamp: number;
  read: boolean;
}

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  unreadDmCount: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearAll: () => void;
  lastSeenTimestamp: number;
  loading: boolean;
  updateLastSeen: () => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  unreadDmCount: 0,
  markAllRead: () => {},
  markRead: () => {},
  clearAll: () => {},
  lastSeenTimestamp: 0,
  loading: false,
  updateLastSeen: () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

const NOTIF_PREFIX = "nostr_notif_";
const MAX_NOTIFICATIONS = 200;
const MAX_SEEN_IDS = 2000;
const MAX_READ_IDS = 1000;
const MAX_KNOWN_FOLLOWERS = 500;
const FAST_LOOKBACK = 6 * 60 * 60;
const MAX_BACKFILL = 30 * 24 * 60 * 60;
const NOTIF_RELAY_COUNT = 3; // profile-fetch fan-out only (FAST_RELAYS head)

const KIND_GIFT_WRAP = 1059;

function pubkeySlug(pubkey: string): string {
  return pubkey.slice(0, 16);
}

function getReadIds(pubkey: string | null): Set<string> {
  if (!pubkey) return new Set();
  try {
    const stored = localStorage.getItem(`${NOTIF_PREFIX}read_${pubkeySlug(pubkey)}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>, pubkey: string | null) {
  if (!pubkey) return;
  try {
    const arr = Array.from(ids).slice(-MAX_READ_IDS);
    localStorage.setItem(`${NOTIF_PREFIX}read_${pubkeySlug(pubkey)}`, JSON.stringify(arr));
  } catch {}
}

function getLastSeenTimestamp(pubkey: string | null): number {
  if (!pubkey) return 0;
  try {
    const stored = localStorage.getItem(`${NOTIF_PREFIX}lastseen_${pubkeySlug(pubkey)}`);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

function saveLastSeenTimestamp(ts: number, pubkey: string | null) {
  if (!pubkey) return;
  try {
    const key = `${NOTIF_PREFIX}lastseen_${pubkeySlug(pubkey)}`;
    // Monotonic (belt-and-suspenders, mirrors the dm-read setter): last-seen
    // only ever advances, so a stale write can never un-see a notification.
    const cur = parseInt(localStorage.getItem(key) || "0", 10) || 0;
    if (ts <= cur) return;
    localStorage.setItem(key, String(ts));
    // Signal the cross-device read-state sync to schedule a debounced publish.
    try { window.dispatchEvent(new CustomEvent(READSTATE_CHANGED_EVENT)); } catch {}
  } catch {}
}

function getSeenIds(pubkey: string | null): Set<string> {
  if (!pubkey) return new Set();
  try {
    const stored = localStorage.getItem(`${NOTIF_PREFIX}seen_${pubkeySlug(pubkey)}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>, pubkey: string | null) {
  if (!pubkey) return;
  try {
    const arr = Array.from(ids).slice(-MAX_SEEN_IDS);
    localStorage.setItem(`${NOTIF_PREFIX}seen_${pubkeySlug(pubkey)}`, JSON.stringify(arr));
  } catch {}
}

function getKnownFollowers(pubkey: string | null): Set<string> {
  if (!pubkey) return new Set();
  try {
    const stored = localStorage.getItem(`${NOTIF_PREFIX}followers_${pubkeySlug(pubkey)}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveKnownFollowers(followers: Set<string>, pubkey: string | null) {
  if (!pubkey) return;
  try {
    const arr = Array.from(followers).slice(-MAX_KNOWN_FOLLOWERS);
    localStorage.setItem(`${NOTIF_PREFIX}followers_${pubkeySlug(pubkey)}`, JSON.stringify(arr));
  } catch {}
}

function classifyEvent(event: Event, myPubkey: string): NotificationItem["type"] | null {
  if (event.pubkey === myPubkey) return null;

  switch (event.kind) {
    case 1: {
      const hasETags = event.tags.some(t => t[0] === "e");
      if (hasETags) return "reply";
      return "mention";
    }
    case 6: return "repost";
    case 7: return "reaction";
    case 9735: return "zap";
    case 3: {
      const followsMe = event.tags.some(t => t[0] === "p" && t[1] === myPubkey);
      return followsMe ? "follow" : null;
    }
    case 1111: {
      // External-discussion comment (NIP-22/73). A reply carries an `e` tag
      // (points at a parent comment) → "reply"; a top-level comment that only
      // @-mentions the user has none → "mention". Whether it ACTUALLY notifies
      // is decided by shouldNotifyForComment in addNotification (reply-to-my-
      // comment OR trusted @-mention + trust bar).
      const hasReplyTag = event.tags.some(t => t[0] === "e" && t[1]);
      return hasReplyTag ? "reply" : "mention";
    }
    default: return null;
  }
}

function dedupKey(n: NotificationItem): string {
  // Follows are deduped per-person (each follow-list edit is a fresh event id);
  // everything else is deduped by its own event id.
  return n.type === "follow" ? `follow_${n.fromPubkey}` : n.id;
}

// Merge persisted (seeded-from-cache) history with the in-memory list. Current
// entries win over seeded ones so the freshest read-state/data is preserved.
// Newest first, capped to the in-memory ceiling.
function mergeNotifications(current: NotificationItem[], seeded: NotificationItem[]): NotificationItem[] {
  const byKey = new Map<string, NotificationItem>();
  for (const n of seeded) byKey.set(dedupKey(n), n);
  for (const n of current) byKey.set(dedupKey(n), n);
  return Array.from(byKey.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_NOTIFICATIONS);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, signer, follows } = useNostrAuth();
  const { requestScoresBulk, scores, flaggedPubkeys } = useGrapeRankScores();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Total unread DMs = conversations whose latest message is newer than our last-read
  // marker for that peer. Drives the Messages nav badge (footer + sidebar). Recomputes
  // on new DMs (`dm-cache-updated`) and when a thread is read/sent (`dm-read-updated`).
  const [unreadDmCount, setUnreadDmCount] = useState(0);
  // Reactive mirror of lastSeenRef. Drives the badge ("have you seen the list")
  // so opening the page zeroes it instantly — decoupled from per-item `read`
  // ("have you read this item"), which keeps the in-list highlight.
  const [lastSeen, setLastSeen] = useState(0);
  const readIdsRef = useRef<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const followPubkeysRef = useRef(new Set<string>());
  const subRef = useRef<{ close: () => void } | null>(null);
  const profileBatchRef = useRef(new Set<string>());
  const profileFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenRef = useRef(0);
  const pubkeyRef = useRef<string | null>(null);
  const signerRef = useRef<any>(null);
  // Reply-alert (kind-1111) anti-spam gate inputs, mirrored into refs so
  // addNotification stays a stable callback while reading live trust values.
  const myCommentIdsRef = useRef<Set<string>>(new Set());
  const followsRef = useRef<Set<string>>(new Set());
  const scoresRef = useRef<Map<string, number> | null>(null);
  const flaggedRef = useRef<Set<string> | null>(null);
  // Support tickets are a SEPARATE slice from the relay-driven notifications:
  // they're merged in only at the context boundary, and their read-state lives
  // in the per-thread feedback store (isIssueUnread), never the relay read-ids.
  const [ticketEvents, setTicketEvents] = useState<Event[]>([]);
  const [ticketRumors, setTicketRumors] = useState<UnwrappedRumor[]>([]);
  const [feedbackReadVersion, setFeedbackReadVersion] = useState(0);
  const shownTicketIssuesRef = useRef<FeedbackIssue[]>([]);

  useEffect(() => {
    pubkeyRef.current = pubkey ?? null;
    // Hydrate the decrypt-once ledger so background DM processing here never
    // re-sends an already-seen gift wrap to the signer.
    if (pubkey) seedProcessedWraps(pubkey);
  }, [pubkey]);

  useEffect(() => {
    signerRef.current = signer ?? null;
  }, [signer]);

  const requestScoresBulkRef = useRef(requestScoresBulk);
  requestScoresBulkRef.current = requestScoresBulk;
  // Keep the trust-gate lookups live (assigned during render, like the ref above).
  scoresRef.current = scores;
  flaggedRef.current = flaggedPubkeys;
  useEffect(() => { followsRef.current = new Set(follows); }, [follows]);

  const flushProfiles = useCallback(() => {
    if (profileBatchRef.current.size === 0) return;
    const pubkeys = Array.from(profileBatchRef.current);
    profileBatchRef.current.clear();
    fetchProfiles(pubkeys, FAST_RELAYS.slice(0, NOTIF_RELAY_COUNT));
    // Score hydration goes through the shared pipeline: it batch-prewarms the
    // global wot_rank as provisional AND refines per-observer. Injecting raw
    // global batch results here used to mark them authoritative (and wrote -1
    // "No data" markers for misses), blocking per-observer resolution.
    requestScoresBulkRef.current(pubkeys);
  }, []);

  const queueProfileFetch = useCallback((pk: string) => {
    profileBatchRef.current.add(pk);
    if (profileFlushTimerRef.current) clearTimeout(profileFlushTimerRef.current);
    profileFlushTimerRef.current = setTimeout(flushProfiles, 300);
  }, [flushProfiles]);

  const addNotification = useCallback((event: Event) => {
    const currentPubkey = pubkeyRef.current;
    if (!currentPubkey) return;

    const alreadySeen = seenIdsRef.current.has(event.id);

    const type = classifyEvent(event, currentPubkey);
    if (!type) return;

    // External-discussion reply alerts are trust-gated AT SOURCE (anti-spam): a
    // kind-1111 only notifies if it genuinely replies to one of MY comments AND
    // its author clears the discussion trust bar. A bare p-tag, a reply to
    // someone else's comment, or a cold stranger is dropped here — before it
    // ever becomes a notification.
    if (event.kind === KIND_COMMENT && !shouldNotifyForComment(event, {
      myCommentIds: myCommentIdsRef.current,
      preset: detectPreset(readReachDepth(), readExcludedTiers()),
      follows: followsRef.current,
      selfPubkey: currentPubkey,
      scoreGetter: (pk) => scoresRef.current?.get(pk),
      flaggedPubkeys: flaggedRef.current ?? undefined,
    })) {
      return;
    }

    if (!alreadySeen) {
      seenIdsRef.current.add(event.id);
      saveSeenIds(seenIdsRef.current, currentPubkey);
      queueProfileFetch(event.pubkey);
    }

    // Id-based unread: a FIRST-TIME arrival is never auto-read by the created_at
    // ≤ lastSeen rule (only historical/already-seen events are), so a mention
    // authored days ago but reaching us now stays unread + badges, instead of
    // showing up silently pre-read ("notifications a few days behind").
    const isRead = computeNotificationRead(event.id, event.created_at, {
      readIds: readIdsRef.current, alreadySeen, lastSeen: lastSeenRef.current,
    });

    let senderPubkey = event.pubkey;
    if (type === "zap") {
      const descTag = event.tags.find((t: string[]) => t[0] === "description");
      if (descTag?.[1]) {
        try {
          const zapReq = JSON.parse(descTag[1]);
          if (zapReq.pubkey && typeof zapReq.pubkey === "string" && /^[0-9a-f]{64}$/i.test(zapReq.pubkey)) {
            senderPubkey = zapReq.pubkey;
            queueProfileFetch(senderPubkey);
          }
        } catch {}
      }
    }

    const item: NotificationItem = {
      id: event.id,
      event,
      type,
      fromPubkey: senderPubkey,
      timestamp: event.created_at,
      read: isRead,
    };

    if (type === "follow") {
      const alreadyKnownFollower = followPubkeysRef.current.has(event.pubkey);
      if (alreadyKnownFollower) {
        item.read = true;
        setNotifications(prev => {
          // Already collapsed + read on the first pass: a replayed follow-back
          // must be a no-op, not another full-array rebuild (returning `prev`
          // makes React skip the re-render + downstream memo recompute).
          const existing = prev.find(n => n.type === "follow" && n.fromPubkey === event.pubkey);
          if (existing && existing.read) return prev;
          const filtered = prev.filter(n => !(n.type === "follow" && n.fromPubkey === event.pubkey));
          const updated = [item, ...filtered];
          return updated.slice(0, MAX_NOTIFICATIONS);
        });
        return;
      }
      followPubkeysRef.current.add(event.pubkey);
      saveKnownFollowers(followPubkeysRef.current, pubkeyRef.current);
    }

    setNotifications(prev => {
      // The background tails are resilient/persistent, so each reopen REPLAYS
      // stored events. When a replayed event is already in the list with the
      // same read-state, bail out with the same reference — otherwise every
      // replay fired a full 200-element rebuild + re-sort/re-count on every
      // consumer, the render half of the receiver storm.
      const existing = prev.find(n => n.id === event.id);
      if (existing && existing.read === item.read) return prev;
      const updated = [item, ...prev.filter(n => n.id !== event.id)];
      return updated.slice(0, MAX_NOTIFICATIONS);
    });
  }, [queueProfileFetch]);

  // DM-cache writes from the notification path are buffered and flushed together:
  // a cold-load backfill of N wraps becomes a few batched IDB writes + ONE
  // "dm-cache-updated" event, instead of N writes + N events (which previously
  // stormed Messages.loadConversations on mobile/PWA cold load).
  const dmBufferRef = useRef<{
    msgs: Map<string, any[]>;
    convo: Map<string, { lastMessage: string; lastTimestamp: number }>;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ msgs: new Map(), convo: new Map(), timer: null });

  const flushDmBuffer = useCallback(async () => {
    const owner = pubkeyRef.current;
    const buf = dmBufferRef.current;
    const msgs = buf.msgs;
    const convo = buf.convo;
    buf.msgs = new Map();
    buf.convo = new Map();
    buf.timer = null;
    if (!owner || msgs.size === 0) return;
    const peers: string[] = [];
    try {
      for (const [peer, list] of msgs) {
        peers.push(peer);
        await dmCache.putMessages(owner, peer, list); // batched write per peer
      }
      // One preview write per peer. Messages.loadConversations is the source of
      // truth for the list, so a transient/out-of-order preview self-corrects.
      for (const [peer, c] of convo) {
        await dmCache.putConversation(owner, { ownerPubkey: owner, peerPubkey: peer, lastMessage: c.lastMessage, lastTimestamp: c.lastTimestamp });
      }
    } catch (err) {
      console.warn("[DM] Failed to flush notification DM cache:", (err as Error)?.message);
    }
    if (peers.length) {
      try { window.dispatchEvent(new CustomEvent("dm-cache-updated", { detail: { peers } })); } catch {}
    }
  }, []);

  // By design: decrypted DMs are persisted to `dmCache` (not the applesauce
  // `eventStore`). Encrypted kind-1059 wraps have no reactive model, and the
  // decrypt-once ledger handles dedup — so DMs intentionally bypass the store.
  const handleGiftWrap = useCallback(async (wrapEvent: Event) => {
    const currentPubkey = pubkeyRef.current;
    const currentSigner = signerRef.current;
    if (!currentPubkey || !currentSigner) return;

    const notifId = `dm_${wrapEvent.id}`;
    if (seenIdsRef.current.has(notifId)) return;

    const unwrapped = await unwrapGiftWrap(currentSigner, currentPubkey, wrapEvent);
    if (!unwrapped) return;

    // Concord direct invite (3313) riding the DM pipe: stash it as a pending
    // invite + notify — it is NOT a DM and must not enter the DM cache.
    if (unwrapped.rumorKind === KIND_DIRECT_INVITE_RUMOR) {
      // Branch refactor (shared stash helper) + main's "Private chat" wording.
      const stashed = stashDirectInviteRumor(currentPubkey, unwrapped);
      if (stashed?.isNew) toast({ title: "Private chat invite", description: `You've been invited to ${stashed.bundle.name ?? "a private chat"} — see Outposts.` });
      return;
    }

    // unwrapGiftWrap marks this wrap "processed" in the shared decrypt-once ledger,
    // so the Messages page will SKIP re-decrypting it — we must persist it here or
    // the message never appears. Buffer it; flushDmBuffer batches the writes and
    // fires a single coalesced "dm-cache-updated" (avoids the per-wrap storm).
    const peerPubkey = unwrapped.senderPubkey === currentPubkey
      ? unwrapped.recipientPubkey
      : unwrapped.senderPubkey;
    if (peerPubkey) {
      const buf = dmBufferRef.current;
      const list = buf.msgs.get(peerPubkey) ?? [];
      list.push({
        id: unwrapped.rumorId,
        ownerPubkey: currentPubkey,
        peerPubkey,
        content: unwrapped.content,
        from: unwrapped.senderPubkey,
        timestamp: unwrapped.timestamp,
        encryption: "nip17",
        ...(unwrapped.fileMetadata ? { fileMetadata: unwrapped.fileMetadata } : {}),
      });
      buf.msgs.set(peerPubkey, list);
      const prev = buf.convo.get(peerPubkey);
      if (!prev || unwrapped.timestamp >= prev.lastTimestamp) {
        buf.convo.set(peerPubkey, { lastMessage: unwrapped.content, lastTimestamp: unwrapped.timestamp });
      }
      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(() => { void flushDmBuffer(); }, 400);
    }

    // DMs surface ONLY in the Chats tab (its own unread badge / dm-cache) — they
    // are intentionally NOT notifications. Mark the wrap seen so a repeat
    // delivery (history + live) short-circuits at the guard above before
    // re-decrypting.
    seenIdsRef.current.add(notifId);
    saveSeenIds(seenIdsRef.current, currentPubkey);
  }, [flushDmBuffer]);

  useEffect(() => {
    if (!pubkey) {
      setNotifications([]);
      seenIdsRef.current.clear();
      followPubkeysRef.current.clear();
      if (subRef.current) {
        subRef.current.close();
        subRef.current = null;
      }
      return;
    }

    seenIdsRef.current = getSeenIds(pubkey);
    followPubkeysRef.current = getKnownFollowers(pubkey);
    readIdsRef.current = getReadIds(pubkey);
    lastSeenRef.current = getLastSeenTimestamp(pubkey);
    setLastSeen(lastSeenRef.current);

    // Seed durable history from IndexedDB so it survives reloads and relay gaps.
    // Live relay events merge on top; read-state is recomputed against the
    // current read-ids / last-seen so a marked-read item stays read.
    const seedPubkey = pubkey;
    getCachedNotifications(pubkeySlug(seedPubkey)).then((cached) => {
      if (!cached || cached.length === 0) return;
      if (pubkeyRef.current !== seedPubkey) return;
      const seeded: NotificationItem[] = cached
        // Drop legacy DM notifications cached before DMs moved to the Chats tab.
        .filter((n: { type?: string }) => n.type !== "dm")
        .map((n: NotificationItem) => {
          // Cache-seeded items are historical by definition (alreadySeen: true),
          // so the timestamp fallback applies — keeps existing read-state stable.
          const isRead = computeNotificationRead(n.id, n.timestamp, {
            readIds: readIdsRef.current, alreadySeen: true, lastSeen: lastSeenRef.current,
          });
          return { ...n, read: isRead };
        });
      for (const n of seeded) {
        seenIdsRef.current.add(n.id);
        if (n.type === "follow") followPubkeysRef.current.add(n.fromPubkey);
        if (n.event) {
          try { eventStore.add(n.event); } catch {}
        }
        queueProfileFetch(n.fromPubkey);
      }
      setNotifications((prev) => mergeNotifications(prev, seeded));
    }).catch(() => {});

    const now = Math.floor(Date.now() / 1000);
    // Subscribe on the user's OWN inbox (NIP-65 read relays) ∪ a popular
    // fallback, not a fixed 3-relay set — an outbox-model mention/reaction lands
    // on the recipient's read relays, so a hardcoded set silently misses it.
    const notifRelays = getMyNotificationRelays(pubkey);

    const fastSince = now - FAST_LOOKBACK;
    const backfillSince = now - MAX_BACKFILL;

    const filter = { kinds: [1, 6, 7, 9735, 3, KIND_COMMENT], "#p": [pubkey] };
    const subs: { close: () => void }[] = [];
    setLoading(true);
    let fastDone = false;
    let backfillDone = backfillSince >= fastSince;

    const checkDone = () => {
      if (fastDone && backfillDone) setLoading(false);
    };

    const fastSub = throttledPoolSubscribe(notifRelays, {
      ...filter,
      since: fastSince,
    }, {
      onevent(event: Event) {
        eventStore.add(event);
        addNotification(event);
      },
      oneose() {
        fastSub.close();
        flushProfiles();
        fastDone = true;
        checkDone();
      },
    });
    subs.push(fastSub);

    if (backfillSince < fastSince) {
      const backfillTimer = setTimeout(() => {
        const backfillSub = throttledPoolSubscribe(notifRelays, {
          ...filter,
          since: backfillSince,
          until: fastSince,
        }, {
          onevent(event: Event) {
            eventStore.add(event);
            addNotification(event);
          },
          oneose() {
            backfillSub.close();
            flushProfiles();
            backfillDone = true;
            checkDone();
          },
        });
        subs.push(backfillSub);
      }, 500);

      const cleanupBackfill = () => clearTimeout(backfillTimer);
      subs.push({ close: cleanupBackfill });
    }

    // Live tail — RESILIENT (self-heals on socket death with backoff) so a
    // long-lived PWA session doesn't go silently deaf and only catch up on the
    // next hard reload. Replaces the old raw pool.subscribeMany-per-relay loop
    // that had no reconnect wrapper of its own.
    const liveSub = persistentPoolSubscribe(notifRelays, { ...filter, since: now }, {
      onevent(event: Event) {
        eventStore.add(event);
        addNotification(event);
      },
    });
    subs.push(liveSub);
    subRef.current = liveSub;

    return () => {
      subs.forEach(s => { try { s.close(); } catch {} });
      subRef.current = null;
      if (profileFlushTimerRef.current) {
        clearTimeout(profileFlushTimerRef.current);
      }
    };
  }, [pubkey, addNotification, flushProfiles]);

  // Track the ids of the user's OWN external-discussion comments (kind-1111) so
  // the reply-alert gate can tell a genuine reply-to-my-comment from a bare
  // p-tag. Read from the discussion public floor (where every comment is
  // guaranteed to land — FAST_RELAYS misses nos.lol/primal). Cheap: the user
  // authors few external comments.
  useEffect(() => {
    if (!pubkey) { myCommentIdsRef.current = new Set(); return; }
    myCommentIdsRef.current = new Set();
    const sub = persistentPoolSubscribe(
      [...DISCUSSION_PUBLIC_FLOOR],
      { kinds: [KIND_COMMENT], authors: [pubkey] },
      { onevent(event: Event) { myCommentIdsRef.current.add(event.id); } },
    );
    return () => { try { sub.close(); } catch {} };
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !signer) return;

    // Arm scoped receive-AUTH for our own inbox relays so we can read auth-gated
    // mailboxes (auth.nostr1.com, …). This publishes NOTHING — it only lets the
    // socket prove our identity to a relay we ourselves chose as our inbox.
    //
    // We deliberately do NOT advertise (publish) our kind-10050 here on bare
    // app-open. Silently minting a DM-inbox event for someone who never touched
    // DMs is the "why does this app publish for me unprompted? sus" behavior the
    // Nostr community (rightly) calls out. Advertising is tied to actually
    // ENGAGING with DMs instead — Messages.tsx calls ensureOwnDMRelayList when
    // Chats opens. (And even without a 10050, the background receiver already
    // subscribes to our read/write/fallback relays, where a sender's fallback-
    // routed wrap lands — so receipt isn't lost.) ensureOwnDMRelayList itself
    // NEVER overwrites an existing list — it only creates one when confirmed-empty.
    setOwnDMInboxProvider(() => getOwnDMInboxRelays(pubkey));

    const now = Math.floor(Date.now() / 1000);
    const dmSince = now - MAX_BACKFILL;
    const dmSubs: { close: () => void }[] = [];

    // Receive on the user's OWN advertised inbox (kind-10050) ∪ read/write/
    // fallback — the SAME set the Chats page uses — so a wrap another client
    // (Amethyst) delivers to the advertised inbox is heard even when Chats is
    // closed. The old static DM_RELAYS ignored the 10050, so background receipt
    // silently missed anything routed to a personal/inbox relay outside that 5.
    const dmReceiveRelays = getMyDMReceiveRelays(pubkey);

    const dmFilter = { kinds: [KIND_GIFT_WRAP], "#p": [pubkey], since: dmSince };

    // The 30-day backfill is a ONE-SHOT: it EOSEs and closes. It must NOT be a
    // persistent/self-healing tail — as one, every socket reopen (a flapping
    // relay, a resumed mobile tab) re-requested the entire 30-day gift-wrap
    // window from all ~12 receive relays again, and a `since`-based tail always
    // replays on reopen so the resilient backoff never escalated → a sustained
    // replay + re-render storm that could exhaust the tab (and take the whole
    // browser down). Ongoing delivery is the live tail below; catch-up-after-gap
    // is the focus/online effect. So this only needs to run once per mount.
    const historySub = throttledPoolSubscribe(dmReceiveRelays, dmFilter, {
      onevent(event: Event) {
        handleGiftWrap(event);
      },
      oneose() {
        try { historySub.close(); } catch {}
        flushProfiles();
      },
    });
    dmSubs.push(historySub);

    // Live tail — RESILIENT (was a raw pool.subscribeMany-per-relay loop with no
    // reconnect, so background DM receipt went deaf on socket drop).
    const liveSub = persistentPoolSubscribe(dmReceiveRelays, { kinds: [KIND_GIFT_WRAP], "#p": [pubkey], since: now }, {
      onevent(event: Event) {
        handleGiftWrap(event);
      },
    });
    dmSubs.push(liveSub);

    return () => {
      dmSubs.forEach(s => { try { s.close(); } catch {} });
    };
  }, [pubkey, signer, handleGiftWrap, flushProfiles]);

  // Focus/online catch-up: the live tails self-heal on socket death, but a
  // socket that died while the tab was backgrounded (mobile PWA suspend, NAT
  // idle, relay restart) can miss events in the gap. On regaining focus/online,
  // run ONE bounded catch-up pass for both notifications and DMs so the user is
  // current immediately — not on the next hard reload. Debounced so rapid
  // focus/blur can't storm the relays. Relays are recomputed each run, so this
  // also picks up the user's NIP-65/10050 lists once they've hydrated.
  useEffect(() => {
    if (!pubkey) return;
    let lastRun = 0;
    const CATCHUP_MIN_GAP = 20_000;        // ms — at most one catch-up per 20s
    const NOTIF_CATCHUP = 24 * 60 * 60;    // look back 24h for notifications
    const DM_CATCHUP = 3 * 24 * 60 * 60;   // 3d for DMs (covers NIP-17 2d back-date)
    const runCatchUp = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const nowMs = Date.now();
      if (nowMs - lastRun < CATCHUP_MIN_GAP) return;
      lastRun = nowMs;
      const now = Math.floor(nowMs / 1000);
      const nSub = throttledPoolSubscribe(getMyNotificationRelays(pubkey), {
        kinds: [1, 6, 7, 9735, 3, KIND_COMMENT], "#p": [pubkey], since: now - NOTIF_CATCHUP,
      }, {
        onevent(event: Event) { eventStore.add(event); addNotification(event); },
        oneose() { try { nSub.close(); } catch {} flushProfiles(); },
      });
      if (signer) {
        const dSub = throttledPoolSubscribe(getMyDMReceiveRelays(pubkey), {
          kinds: [KIND_GIFT_WRAP], "#p": [pubkey], since: now - DM_CATCHUP,
        }, {
          onevent(event: Event) { handleGiftWrap(event); },
          oneose() { try { dSub.close(); } catch {} },
        });
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") runCatchUp(); };
    window.addEventListener("online", runCatchUp);
    window.addEventListener("focus", runCatchUp);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", runCatchUp);
      window.removeEventListener("focus", runCatchUp);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pubkey, signer, addNotification, handleGiftWrap, flushProfiles]);

  // Flush the decrypted-DM write buffer when the tab backgrounds/closes. A wrap
  // is retired in the decrypt-once ledger the moment it decrypts, but its cache
  // write is buffered ~400ms — so a tab suspended (mobile PWA) or closed inside
  // that window left the message in the processed-ledger yet never persisted →
  // permanently invisible next session. Flushing on hide closes that window for
  // the common background-the-app case (best-effort on hard close).
  useEffect(() => {
    const flushOnHide = () => { if (document.visibilityState === "hidden") void flushDmBuffer(); };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnHide);
    };
  }, [flushDmBuffer]);

  // Support tickets → notifications. Reuse the same subscriptions MyTickets uses
  // (public NIP-34 issues + replies, and private gift-wrapped feedback), so an
  // operator reply surfaces in the bell. These feed `ticketItems` (a derived
  // slice), never the relay-driven `notifications` state.
  useEffect(() => {
    if (!pubkey) { setTicketEvents([]); return; }
    const sub = subscribeMyTickets(pubkey, setTicketEvents);
    return () => sub.close();
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !signer) { setTicketRumors([]); return; }
    const sub = subscribePrivateFeedback(signer, pubkey, setTicketRumors);
    return () => sub.close();
  }, [pubkey, signer]);

  // Opening a ticket dispatches this — recompute ticket read-state from the
  // per-thread last-read store so the bell clears for that ticket.
  useEffect(() => {
    const onRead = () => setFeedbackReadVersion(v => v + 1);
    window.addEventListener("relay-outpost:feedback-read", onRead);
    return () => window.removeEventListener("relay-outpost:feedback-read", onRead);
  }, []);

  // Persist the merged list back to IndexedDB (debounced) so history — and its
  // read-state — is remembered next session even if the relays have dropped it.
  useEffect(() => {
    const pk = pubkeyRef.current;
    if (!pk || notifications.length === 0) return;
    const timer = setTimeout(() => {
      cacheNotifications(pubkeySlug(pk), notifications);
    }, 1200);
    return () => clearTimeout(timer);
  }, [notifications]);

  // Tickets worth a notification: have an operator reply, aren't closed, and the
  // newest message isn't the user's own. One row per ticket. feedbackReadVersion
  // forces a recompute (and a fresh isIssueUnread read) after markIssueRead.
  const shownTicketIssues = useMemo(() => {
    void feedbackReadVersion;
    if (!pubkey) return [] as FeedbackIssue[];
    const issues = [...hydrateIssues(ticketEvents), ...hydratePrivateTickets(ticketRumors)];
    return issues.filter((issue) => {
      if (issue.status === "closed") return false;
      if (issue.comments.length === 0) return false;
      const latest = issue.comments.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      return latest.pubkey !== pubkey;
    });
  }, [pubkey, ticketEvents, ticketRumors, feedbackReadVersion]);

  useEffect(() => { shownTicketIssuesRef.current = shownTicketIssues; }, [shownTicketIssues]);

  // Community acceptances ("you're in") — a local slice like tickets: derived
  // from the join-request store, re-read when it changes. The synthetic event
  // carries the relay url in its tags so the row can open the community.
  const [acceptedVersion, setAcceptedVersion] = useState(0);
  useEffect(() => {
    const bump = () => setAcceptedVersion((v) => v + 1);
    window.addEventListener("relay-outpost:join-accepted", bump);
    return () => window.removeEventListener("relay-outpost:join-accepted", bump);
  }, []);

  const acceptedItems = useMemo<NotificationItem[]>(() => {
    if (!pubkey) return [];
    void acceptedVersion;
    return readAcceptedJoins(pubkey).map((a) => ({
      id: `accepted_${a.relayUrl}|${a.groupId}`,
      event: {
        id: `accepted_${a.relayUrl}`, kind: 9002, pubkey: "", created_at: a.acceptedAt,
        content: a.name, tags: [["r", a.relayUrl], ["h", a.groupId]], sig: "",
      } as unknown as Event,
      type: "accepted",
      fromPubkey: "",
      timestamp: a.acceptedAt,
      read: a.seen,
    }));
  }, [pubkey, acceptedVersion]);

  const ticketItems = useMemo<NotificationItem[]>(
    () => shownTicketIssues.map((issue) => {
      const recipient = recipientFromIssue(issue.event);
      return {
        id: `ticket_${issue.event.id}`,
        event: issue.event as unknown as Event,
        type: "ticket",
        fromPubkey: recipient.operatorPubkey || issue.reporter,
        timestamp: issue.latestActivityAt,
        read: !isIssueUnread(issue),
      };
    }),
    [shownTicketIssues],
  );

  // Merge the ticket slice into the exposed list only here — the raw
  // `notifications` state (and its IndexedDB cache) stays ticket-free.
  const mergedNotifications = useMemo(
    () => (ticketItems.length === 0 && acceptedItems.length === 0
      ? notifications
      : [...notifications, ...ticketItems, ...acceptedItems].sort((a, b) => b.timestamp - a.timestamp)),
    [notifications, ticketItems, acceptedItems],
  );

  // Badge counts UNREAD items (id-based, per-item `read`), not "newer than the
  // last open". Opening the Notifications page marks the shown items read (see
  // markAllRead), which clears the badge — but a LATE-arriving old mention now
  // badges when it lands, instead of being silently pre-read because its
  // created_at predates lastSeen (the "days behind" bug). Exclude muted authors
  // so the badge can't say "1" while the page (which hides muted) renders
  // nothing. Ticket unreads are added on top.
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read && !(n.fromPubkey && isMutedPubkey(n.fromPubkey))).length
      + ticketItems.filter(t => !t.read).length,
    [notifications, ticketItems],
  );

  const markAllRead = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    const newReadIds = new Set(readIdsRef.current);
    notifications.forEach(n => newReadIds.add(n.id));
    readIdsRef.current = newReadIds;
    saveReadIds(newReadIds, pubkeyRef.current);
    lastSeenRef.current = now;
    setLastSeen(now);
    saveLastSeenTimestamp(now, pubkeyRef.current);
    if (shownTicketIssuesRef.current.length > 0) markIssuesRead(shownTicketIssuesRef.current);
  }, [notifications]);

  const markRead = useCallback((id: string) => {
    // Ticket rows are read-tracked per-thread, not via the relay read-ids.
    if (id.startsWith("ticket_")) {
      markIssueRead(id.slice("ticket_".length));
      return;
    }
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    readIdsRef.current.add(id);
    saveReadIds(readIdsRef.current, pubkeyRef.current);
  }, []);

  const clearAll = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    const newReadIds = new Set(readIdsRef.current);
    notifications.forEach(n => newReadIds.add(n.id));
    readIdsRef.current = newReadIds;
    saveReadIds(newReadIds, pubkeyRef.current);
    lastSeenRef.current = now;
    setLastSeen(now);
    saveLastSeenTimestamp(now, pubkeyRef.current);
    if (shownTicketIssuesRef.current.length > 0) markIssuesRead(shownTicketIssuesRef.current);
  }, [notifications]);

  const updateLastSeen = useCallback(() => {
    // Advances the monotonic last-seen cursor (used by the cache-seed path to
    // treat already-viewed OLD history as read next session, and by cross-device
    // sync). Does NOT mark items read: the badge is now id-based (per-item
    // `read`), and unread notifications stay in the page's "New" section until
    // the user reads them or hits "Mark all read" — so opening the page no longer
    // silently clears everything, and a late-arriving old mention keeps badging.
    const now = Math.floor(Date.now() / 1000);
    lastSeenRef.current = now;
    setLastSeen(now);
    saveLastSeenTimestamp(now, pubkeyRef.current);
  }, []);

  useEffect(() => {
    if (!pubkey) { setUnreadDmCount(0); return; }
    let cancelled = false;
    const recompute = async () => {
      try {
        const convos = await dmCache.getConversationList(pubkey);
        if (cancelled) return;
        setUnreadDmCount(convos.filter(c => c.lastTimestamp > readDmLastRead(c.peerPubkey)).length);
      } catch { /* ignore */ }
    };
    recompute();
    window.addEventListener("dm-cache-updated", recompute);
    window.addEventListener("dm-read-updated", recompute);
    return () => {
      cancelled = true;
      window.removeEventListener("dm-cache-updated", recompute);
      window.removeEventListener("dm-read-updated", recompute);
    };
  }, [pubkey]);

  // Cross-device hydration: read-state-sync raised markers directly in
  // localStorage (another device read something). Re-read lastSeen into React
  // state — RAISE ONLY, mirroring the monotonic floor — so the notification
  // badge clears here without a reload. (The unread-DM count is refreshed by
  // the dm-read-updated event hydration also fires.)
  useEffect(() => {
    if (!pubkey) return;
    const onHydrated = () => {
      const stored = getLastSeenTimestamp(pubkey);
      if (stored > lastSeenRef.current) {
        lastSeenRef.current = stored;
        setLastSeen(stored);
      }
    };
    window.addEventListener(READSTATE_HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(READSTATE_HYDRATED_EVENT, onHydrated);
  }, [pubkey]);

  const contextValue = useMemo(() => ({
    notifications: mergedNotifications, unreadCount, unreadDmCount, markAllRead, markRead, clearAll, lastSeenTimestamp: lastSeen, loading, updateLastSeen,
  }), [mergedNotifications, unreadCount, unreadDmCount, markAllRead, markRead, clearAll, lastSeen, loading, updateLastSeen]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}
