/**
 * NIP-73 external-URL discussion: read + build + publish kind-1111 comments
 * keyed to a web page's canonical URL.
 *
 * This is the portable, cross-client conversation ABOUT a link. It is stacked
 * beside (never merged into) a page's native thread (e.g. Hacker News) — a
 * Nostr reply here never reaches HN, and an HN comment is never a Nostr note.
 *
 * Two design commitments:
 *  - Relay superset. A discussion comment is published to a SUPERSET of the
 *    author's outbox: their advertised NIP-65 write relays UNIONed with a small,
 *    fixed set of high-overlap public relays (`DISCUSSION_PUBLIC_FLOOR`). The
 *    superset can never be NARROWER than the outbox floor, so a comment is at
 *    least as reachable as any normal post, plus lands on relays other clients
 *    (Amethyst, Damus, …) read — that cross-client reach is the whole point.
 *  - Trust reuse. Read results run through the SAME Open/Balanced/Strict trust
 *    pipeline the For You feed uses (spam-filter + stranger-quality floor +
 *    NIP-13 PoW). In-network authors are always admitted; strangers are gated
 *    but only DEMOTED (surfaced behind a "show filtered" expander), never lost.
 */
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, persistentPoolSubscribe } from "./nostr";
import { clientTags, KIND_COMMENT } from "./nostr-helpers";
import { getAllWriteRelays, withOutboxFloor } from "./outbox";
import { getDiscoverRelayPool } from "./discover-relays";
import { parseSharedPodcast, type SharedPodcast } from "./podcast-share";
import { filterSpamEvents } from "./spam-filter";
import { admitStranger, getDiscoverPresetConfig } from "./discover-quality";
import { effectivePow } from "./nip13-pow";
import type { StrictnessPreset } from "./trust-preset";
import {
  normalizeExternalUrl,
  buildExternalRootTags,
  buildExternalReplyTags,
  extractExternalAnchor,
} from "./external-id";

/**
 * Fixed, high-overlap PUBLIC relays every discussion comment is broadcast to on
 * top of the author's own outbox, so the thread is reachable from other clients
 * regardless of which relays the author happens to advertise. Kept as ONE
 * inspectable named constant on purpose: it is the cross-client reach contract.
 * It is UNIONed with (never substituted for) the outbox floor, so the assembled
 * write set is always a superset of — never narrower than — the outbox floor.
 */
export const DISCUSSION_PUBLIC_FLOOR = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
] as const;

/** Wide public NIP-50 index folded into the READ union for discovery breadth. */
const DISCUSSION_READ_INDEX = "wss://relay.nostr.band";

/** How many relays a single read subscription is capped to (latency guard). */
const READ_RELAY_CAP = 14;

const normRelay = (u: string) => u.replace(/\/+$/, "").toLowerCase();

function unionRelays(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const url of list) {
      const key = normRelay(url);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(url);
      }
    }
  }
  return out;
}

/**
 * The publish superset for a discussion comment: the caller's outbox floor
 * UNIONed with the fixed public floor. Pure and injectable so the "never
 * narrower than the base floor" invariant can be unit-tested without touching
 * the network or relay-list cache.
 */
export function discussionWriteSuperset(baseFloor: readonly string[]): string[] {
  return unionRelays(baseFloor, DISCUSSION_PUBLIC_FLOOR);
}

/**
 * The read union for a discussion: the write superset + a wide public index +
 * the Discover pool, deduped and capped. Pure/injectable for the same reason.
 */
export function discussionReadUnion(
  baseFloor: readonly string[],
  discoverPool: readonly string[],
): string[] {
  return unionRelays(
    discussionWriteSuperset(baseFloor),
    [DISCUSSION_READ_INDEX],
    discoverPool,
  ).slice(0, READ_RELAY_CAP);
}

/** How many extra @-mention inbox relays a single comment fans out to (bound). */
const MENTION_INBOX_CAP = 10;

/**
 * The publish target set for a comment that @-mentions people: the write
 * superset (author outbox ∪ public floor) UNIONed with each mentioned user's
 * NIP-65 inbox/read relays — so the mention actually REACHES them in whatever
 * client they use (the whole point of an outbox-routed mention). The superset
 * is always honored verbatim first, so this can never be NARROWER than the
 * plain write superset; the mention inboxes are additive and capped so a
 * many-mention comment can't fan out without bound. Pure/injectable so the
 * "superset ∪ mention inboxes, never narrower" assembly is unit-testable
 * without touching the network or the relay-list cache.
 */
export function discussionWriteTargets(
  baseFloor: readonly string[],
  mentionInboxRelays: readonly string[],
  extraCap: number = MENTION_INBOX_CAP,
): string[] {
  const superset = discussionWriteSuperset(baseFloor);
  const supersetKeys = new Set(superset.map(normRelay));
  const extras: string[] = [];
  const extraKeys = new Set<string>();
  for (const url of mentionInboxRelays) {
    const key = normRelay(url);
    if (supersetKeys.has(key) || extraKeys.has(key)) continue;
    extras.push(url);
    extraKeys.add(key);
    if (extras.length >= extraCap) break;
  }
  return [...superset, ...extras];
}

export interface EnrichedMentions {
  /** Content with each nostr:npub<pk> upgraded to nostr:nprofile (+hint) when a
   *  relay hint is known — so other clients can resolve AND route the mention. */
  content: string;
  /** One deduped ["p", pubkey, relayHint?] tag per mentioned pubkey. */
  pTags: string[][];
}

/**
 * Fold @-mention pubkeys into a comment the portable, cross-client way (NIP-22
 * p-tags + NIP-27 references):
 *
 *  - build one `["p", pubkey, <relay-hint>]` tag per DISTINCT mentioned pubkey
 *    (the hint is the mentioned user's own read relay, dropped when unknown), and
 *  - upgrade the `nostr:npub…` reference the composer embedded to a
 *    `nostr:nprofile…` carrying that same hint, so a reader (Amethyst, Damus, …)
 *    can locate the profile without already following it.
 *
 * Pure + injectable: the relay-hint lookup is passed in, so no network / cache
 * access happens here and the tag+content shaping is exhaustively testable.
 * `mentionPubkeys` is expected to be the hex pubkeys the composer's typeahead
 * actually picked (from `getMentionTags`); junk entries are skipped.
 */
export function enrichCommentMentions(
  resolvedContent: string,
  mentionPubkeys: readonly string[],
  relayHint: (pubkey: string) => string | undefined,
): EnrichedMentions {
  const seen = new Set<string>();
  const pTags: string[][] = [];
  let content = resolvedContent;
  for (const pk of mentionPubkeys) {
    if (!/^[0-9a-f]{64}$/i.test(pk) || seen.has(pk)) continue;
    seen.add(pk);
    const hint = relayHint(pk);
    pTags.push(hint ? ["p", pk, hint] : ["p", pk]);
    if (hint) {
      try {
        const npub = nip19.npubEncode(pk);
        const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: [hint] });
        content = content.split(`nostr:${npub}`).join(`nostr:${nprofile}`);
      } catch {
        /* leave the npub form — still a valid NIP-27 mention */
      }
    }
  }
  return { content, pTags };
}

/**
 * Fold a comment's tag lists into one set with AT MOST one `p` tag per pubkey.
 * A reply already carries `["p", parentAuthor]`; an @-mention of that same
 * author would otherwise duplicate it. Dedup keeps the FIRST occurrence but
 * upgrades it in place to a variant that carries a relay hint (3rd element)
 * when one arrives later — so the parent-author p-tag inherits the mention's
 * hint. Non-`p` tags pass through untouched, order preserved.
 */
function dedupePubkeyTags(tags: string[][]): string[][] {
  const out: string[][] = [];
  const pIndex = new Map<string, number>();
  for (const tag of tags) {
    if (tag[0] === "p" && typeof tag[1] === "string") {
      const at = pIndex.get(tag[1]);
      if (at === undefined) {
        pIndex.set(tag[1], out.length);
        out.push(tag);
      } else if (tag[2] && !out[at][2]) {
        out[at] = tag;
      }
    } else {
      out.push(tag);
    }
  }
  return out;
}

export interface DiscussionTrustDeps {
  /** Active Open/Balanced/Strict strictness dial (drives the stranger bar). */
  preset: StrictnessPreset;
  /** Followed pubkeys — in-network, always admitted. */
  follows: Set<string>;
  /** The signed-in user's pubkey (also always in-network). */
  selfPubkey?: string | null;
  /** GrapeRank influence lookup. undefined = unscored. */
  scoreGetter?: (pubkey: string) => number | undefined;
  /** Earliest-evidence (unix seconds) lookup, null = unknown. */
  firstSeenGetter?: (pubkey: string) => number | null;
  /** Cached follower-count lookup. undefined = unknown. */
  followerCountGetter?: (pubkey: string) => number | undefined;
  /** Per-event engagement score (computeEngagementScore). */
  engagementScoreGetter?: (event: Event) => number;
  /** Profile lookup (used by the spam floor's bot check). */
  profileGetter?: (pubkey: string) => any;
  /** Flagged-account pubkeys to hide (safety floor). */
  flaggedPubkeys?: Set<string>;
  /** Injected clock (unix seconds) — testability. */
  nowSeconds?: number;
}

export interface DiscussionResult {
  /** Admitted comments (in-network + strangers that cleared the quality bar). */
  comments: Event[];
  /** Demoted comments (strangers that failed the bar) — shown behind expander. */
  filtered: Event[];
  /** Count of demoted comments (drives the "show N filtered" affordance). */
  filteredCount: number;
}

/**
 * Partition kind-1111 comments through the shared trust pipeline.
 *
 * 1. Hard floor (spam-filter): drop muted / spam / reported / keyword-matched /
 *    flagged authors outright — same removals the feed makes. These are NOT
 *    counted as "filtered"; they are noise, not demoted discussion.
 * 2. Stranger-quality floor (admitStranger): partition the survivors into
 *    in-network + earned-signal strangers (admitted) vs cold strangers
 *    (demoted). Nothing here is dropped — the demoted set is returned so the UI
 *    can reveal it on demand.
 *
 * Pure: all network/graph/clock inputs are injected via `deps`.
 */
export function applyDiscussionTrust(
  events: Event[],
  deps: DiscussionTrustDeps,
): DiscussionResult {
  const {
    preset,
    follows,
    selfPubkey,
    scoreGetter,
    firstSeenGetter,
    followerCountGetter,
    engagementScoreGetter,
    profileGetter,
    flaggedPubkeys,
    nowSeconds,
  } = deps;

  // Dedupe by id first (the read union hits overlapping relays).
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // 1. Hard floor — mirror the feed's baseline removals (no readableKinds gate:
  //    these ARE kind-1111 and must survive it).
  const survivors = filterSpamEvents(unique, {
    follows,
    reachDepth: "off",
    profileGetter,
    flaggedPubkeys,
    nowSeconds,
  });

  // 2. Stranger-quality floor.
  const cfg = getDiscoverPresetConfig(preset);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const comments: Event[] = [];
  const filtered: Event[] = [];
  for (const e of survivors) {
    const isInNetwork = follows.has(e.pubkey) || e.pubkey === selfPubkey;
    const admit = admitStranger({
      isInNetwork,
      wotScore: scoreGetter?.(e.pubkey),
      engagementScore: engagementScoreGetter?.(e) ?? 0,
      powDifficulty: effectivePow(e),
      firstSeen: firstSeenGetter?.(e.pubkey) ?? null,
      followerCount: followerCountGetter?.(e.pubkey),
      nowSeconds: now,
      config: cfg,
    });
    (admit ? comments : filtered).push(e);
  }

  // Newest-first within each bucket.
  comments.sort((a, b) => b.created_at - a.created_at);
  filtered.sort((a, b) => b.created_at - a.created_at);

  return { comments, filtered, filteredCount: filtered.length };
}

export interface CommentNotifyDeps extends DiscussionTrustDeps {
  /** Ids of the signed-in user's OWN external comments — the reply-target set. */
  myCommentIds: Set<string>;
}

/**
 * Anti-spam gate for external-discussion alerts. Returns true ONLY when the
 * kind-1111 clears BOTH a RELEVANCE test and a TRUST test:
 *
 *  Relevance — it is one of
 *    (a) a genuine REPLY to one of the user's own comments (an `e` tag
 *        referencing an id in `myCommentIds`), or
 *    (b) a REPLY to one of the user's nostr EVENTS (e.g. a kind-1 note): a
 *        NOSTR-scoped kind-1111 (no external `I`/`i` tag) that `p`-tags the user
 *        and carries a reply `e` tag. This is the kind-1-parity case — as
 *        clients move note-replies to kind-1111, they must still notify like a
 *        kind-1 reply did. On external-URL (NIP-73) discussions this branch does
 *        NOT apply, so a web-link comment that merely p-tags the user still needs
 *        (a) or (c) — keeping public threads from becoming a firehose. or
 *    (c) a pure @-MENTION of the user — it `p`-tags the user AND carries no
 *        reply `e` tag at all (a top-level comment that mentions them). An
 *        external-URL comment that replies to SOMEONE ELSE while p-tagging the
 *        user is NOT surfaced: that keeps the reply/mention split clean.
 *  Trust — its author clears the SAME discussion trust bar the thread itself
 *    uses: in-network (followed / self) is always admitted, an earned-signal
 *    stranger is admitted, but a cold stranger (or a muted / spam / flagged
 *    author) is demoted / dropped and does NOT notify.
 *
 * This is the whole anti-spam design: a stranger or bot cannot manufacture a
 * notification by replying to — or @-mentioning — the user, because the trust
 * bar gates both. Pure — every trust input is injected via `deps`, so the truth
 * table is exhaustively unit-testable.
 */
export function shouldNotifyForComment(
  event: Event,
  deps: CommentNotifyDeps,
): boolean {
  if (event.kind !== KIND_COMMENT) return false;
  // Never notify on the user's own reply/mention (belt-and-suspenders: the notif
  // filter already excludes self, but the pure gate must stay self-consistent).
  if (deps.selfPubkey && event.pubkey === deps.selfPubkey) return false;

  const hasReplyTag = event.tags.some(
    (t) => t[0] === "e" && typeof t[1] === "string" && t[1],
  );
  const pTagsMe =
    !!deps.selfPubkey && event.tags.some((t) => t[0] === "p" && t[1] === deps.selfPubkey);

  // (a) genuine reply to one of MY comments (an e-tag to my comment id) —
  // works for both nostr-scoped and external-URL (NIP-73) discussions.
  const repliesToMyComment = event.tags.some(
    (t) => t[0] === "e" && typeof t[1] === "string" && deps.myCommentIds.has(t[1]),
  );

  // (b) a reply to one of MY nostr EVENTS — e.g. a kind-1 note. As clients move
  // note-replies from kind-1 to kind-1111 (Amethyst/Ditto, NIP-22 §2447), those
  // must still notify the way a kind-1 reply always did. The signal mirrors
  // kind-1: I'm p-tagged AND it's a reply. Scoped to NOSTR events only — an
  // external-URL (NIP-73) comment carries an I/i tag and stays on the strict
  // rule above, so public web-link discussions don't become a notification
  // firehose. The author still has to clear the discussion trust bar below.
  const isExternalUrlComment = event.tags.some(
    (t) => (t[0] === "I" || t[0] === "i") && typeof t[1] === "string" && t[1],
  );
  const repliesToMyNostrEvent = !isExternalUrlComment && hasReplyTag && pTagsMe;

  // (c) pure @-mention of me: p-tags me AND carries no reply e-tag at all.
  const pureMentionOfMe = !hasReplyTag && pTagsMe;

  if (!repliesToMyComment && !repliesToMyNostrEvent && !pureMentionOfMe) return false;

  // Author clears the discussion trust bar — reuse the exact admit pipeline
  // (spam floor + stranger-quality floor) the visible thread uses, so the
  // alerts and the thread agree on who counts as "in".
  return applyDiscussionTrust([event], deps).comments.length > 0;
}

export interface BuildCommentOpts {
  /** Make this a one-level reply to an existing external comment (omit for a
   *  top-level comment on the URL). */
  parent?: Event;
  /** `["p", pubkey, hint?]` mention tags from `enrichCommentMentions`. Deduped
   *  against the reply's parent-author p-tag. */
  mentionTags?: string[][];
  /** `["t", tag]` hashtag tags from `extractHashtags`. */
  hashtagTags?: string[][];
}

/**
 * Build an UNSIGNED kind-1111 comment anchored to `url`. Pass `opts.parent` to
 * make it a one-level reply to an existing external comment; omit it for a
 * top-level comment on the URL. `opts.mentionTags` / `opts.hashtagTags` carry
 * the standard NIP-22/NIP-27 `p`/`t` tags so a mention or hashtag renders and
 * notifies in other clients; the NIP-73 root/reply scope and the client
 * attribution tag are always preserved. Duplicate `p` tags (parent author who
 * is also @-mentioned) are collapsed to one.
 */
export function buildComment(
  url: string,
  text: string,
  opts: BuildCommentOpts = {},
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const { parent, mentionTags = [], hashtagTags = [] } = opts;
  const rootTags = parent
    ? buildExternalReplyTags(url, parent)
    : buildExternalRootTags(url);
  const tags = dedupePubkeyTags([...rootTags, ...mentionTags, ...hashtagTags]);
  return {
    kind: KIND_COMMENT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [...tags, ...clientTags()],
    content: text,
  };
}

/**
 * Read the NIP-73 discussion for `url`: query every kind-1111 anchored to the
 * normalized URL across the read union, then run them through the shared trust
 * pipeline. Returns admitted comments + the demoted set (+ its count).
 */
export async function readDiscussion(
  rawUrl: string,
  opts: DiscussionTrustDeps & { pubkey?: string | null; langs?: string[] },
): Promise<DiscussionResult> {
  let normUrl: string;
  try {
    normUrl = normalizeExternalUrl(rawUrl);
  } catch {
    return { comments: [], filtered: [], filteredCount: 0 };
  }

  const base = opts.pubkey
    ? withOutboxFloor(getAllWriteRelays(opts.pubkey), opts.pubkey)
    : DEFAULT_RELAYS;
  const readRelays = discussionReadUnion(base, getDiscoverRelayPool(opts.langs ?? []));

  let events: Event[] = [];
  try {
    events = (await pool.querySync(
      readRelays,
      { kinds: [KIND_COMMENT], "#I": [normUrl] },
      { maxWait: 4000 },
    )) as Event[];
  } catch {
    events = [];
  }

  // Defensive: only keep comments whose normalized anchor actually matches this
  // URL (a relay could return loosely-matched or unrelated events).
  const anchored = events.filter((e) => extractExternalAnchor(e) === normUrl);

  return applyDiscussionTrust(anchored, opts);
}

// ── Live discussion (fast path): stale-while-revalidate cache + subscription ──
// The one-shot `readDiscussion` above blocks up to 4s across the read union
// before returning anything, which made the Discussion tab feel like it was
// "connecting slow". The live path below instead paints the cached thread
// INSTANTLY (stale) and streams fresh comments in via a live subscription
// (revalidate), so results appear sub-second as they arrive. Trust is applied
// by the consumer over the emitted RAW set — keeping this layer network-only —
// so a strictness/score change re-filters WITHOUT a re-fetch.

/**
 * In-memory thread cache keyed by NORMALIZED anchor. Holds the raw, deduped
 * kind-1111 set (pre-trust) so re-opening a link paints immediately while the
 * live subscription revalidates in the background. Bounded so a long reading
 * session can't grow it without limit (oldest-inserted evicted first).
 */
const discussionCache = new Map<string, Event[]>();
const DISCUSSION_CACHE_MAX = 40;

function discussionCacheKey(rawUrl: string): string | null {
  try {
    return normalizeExternalUrl(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Snapshot of the cached raw events for a URL (keyed by NORMALIZED anchor, so a
 * tracking-decorated / www variant of the same page hits the same entry), or
 * undefined when nothing is cached. Returns a copy — callers can't mutate the
 * stored array.
 */
export function getCachedDiscussion(rawUrl: string): Event[] | undefined {
  const key = discussionCacheKey(rawUrl);
  if (!key) return undefined;
  const hit = discussionCache.get(key);
  return hit ? hit.slice() : undefined;
}

/** Replace the cached raw events for a URL (normalized keying, bounded insert). */
export function cacheDiscussion(rawUrl: string, events: Event[]): void {
  const key = discussionCacheKey(rawUrl);
  if (!key) return;
  if (discussionCache.size >= DISCUSSION_CACHE_MAX && !discussionCache.has(key)) {
    const oldest = discussionCache.keys().next().value;
    if (oldest !== undefined) discussionCache.delete(oldest);
  }
  discussionCache.set(key, events.slice());
}

/** Test-only: drop all cached threads so cases don't leak state into each other. */
export function __clearDiscussionCache(): void {
  discussionCache.clear();
}

/**
 * Pure dedup/merge of two kind-1111 sets by event id, newest-first. The read
 * union hits overlapping relays, so the same comment streams in many times;
 * this folds each new batch into the accumulating thread without duplicates.
 * An id already present wins (a kind-1111 is immutable by id, so re-delivery of
 * the same id is the same event — no reason to churn the reference).
 */
export function mergeDiscussionEvents(existing: Event[], incoming: Event[]): Event[] {
  const byId = new Map<string, Event>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at);
}

export interface DiscussionSubscribeOpts {
  /** Signed-in user's pubkey (drives the outbox-floor relay selection). */
  pubkey?: string | null;
  /** UI languages (folds the matching Discover pool into the read union). */
  langs?: string[];
}

/**
 * Live discussion subscription (the fast path used by the Discussion tab).
 *
 * Emits the accumulating RAW, deduped, anchor-matched kind-1111 set through
 * `onUpdate`, seeded INSTANTLY from the cache (stale-while-revalidate) and then
 * revalidated by a live pool subscription. The consumer runs
 * `applyDiscussionTrust` over each emitted set, so trust stays reactive to the
 * strictness dial / score arrivals without re-subscribing. Emits are coalesced
 * on a short timer so a burst from the relay union collapses into one render.
 *
 * Returns an unsubscribe function. `readDiscussion` is retained for one-shot /
 * count uses (e.g. a badge that just needs a number once).
 */
export function subscribeDiscussion(
  rawUrl: string,
  opts: DiscussionSubscribeOpts,
  onUpdate: (events: Event[]) => void,
): () => void {
  let normUrl: string;
  try {
    normUrl = normalizeExternalUrl(rawUrl);
  } catch {
    // Junk URL: there is no thread to show. Emit once so the consumer can settle
    // out of its skeleton, and hand back a no-op unsub.
    onUpdate([]);
    return () => {};
  }

  let closed = false;
  let acc: Event[] = getCachedDiscussion(normUrl) ?? [];
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    emitTimer = null;
    if (!closed) onUpdate(acc.slice());
  };
  const scheduleEmit = () => {
    if (emitTimer || closed) return;
    emitTimer = setTimeout(emit, 60);
  };

  // Stale-while-revalidate: paint the cached thread immediately (before any
  // relay responds) so a re-open is instant.
  if (acc.length > 0) onUpdate(acc.slice());

  const base = opts.pubkey
    ? withOutboxFloor(getAllWriteRelays(opts.pubkey), opts.pubkey)
    : DEFAULT_RELAYS;
  const readRelays = discussionReadUnion(base, getDiscoverRelayPool(opts.langs ?? []));

  const sub = persistentPoolSubscribe(
    readRelays,
    { kinds: [KIND_COMMENT], "#I": [normUrl] },
    {
      onevent(event: Event) {
        if (closed) return;
        // Defensive anchor re-check (a relay could return a loose match).
        if (extractExternalAnchor(event) !== normUrl) return;
        const before = acc.length;
        acc = mergeDiscussionEvents(acc, [event]);
        if (acc.length !== before) {
          cacheDiscussion(normUrl, acc);
          scheduleEmit();
        }
      },
    },
  );

  return () => {
    closed = true;
    if (emitTimer) clearTimeout(emitTimer);
    try {
      sub.close();
    } catch {
      /* already closed */
    }
  };
}

/**
 * Recover the playable episode behind a shared link's discussion, if any. The
 * "Discuss on Relay Outpost" note is a kind-1 that references the anchor (`i`)
 * and the page + audio (`r` + `imeta`); the reader's deep link only carries the
 * page URL, so this looks the note up and extracts the episode audio from its
 * standard tags. Returns null for a plain article (no audio) or if nothing is
 * found within `timeoutMs`. Resolves on the FIRST audio-bearing note seen.
 */
export function resolveSharedPodcast(
  rawUrl: string,
  opts: { pubkey?: string | null; langs?: string[] } = {},
  timeoutMs = 4000,
): Promise<SharedPodcast | null> {
  let normUrl: string;
  try {
    normUrl = normalizeExternalUrl(rawUrl);
  } catch {
    return Promise.resolve(null);
  }

  const base = opts.pubkey
    ? withOutboxFloor(getAllWriteRelays(opts.pubkey), opts.pubkey)
    : DEFAULT_RELAYS;
  const readRelays = discussionReadUnion(base, getDiscoverRelayPool(opts.langs ?? []));

  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (v: SharedPodcast | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sub.close(); } catch { /* already closed */ }
      resolve(v);
    };
    // The kind-1 share note carries lowercase `i` (NIP-73 anchor) + `r` (page &
    // audio) — query both so a note referencing either is caught.
    const sub = persistentPoolSubscribe(
      readRelays,
      [{ kinds: [1], "#i": [normUrl] }, { kinds: [1], "#r": [normUrl] }],
      {
        onevent(event: Event) {
          const podcast = parseSharedPodcast(event);
          if (podcast) finish(podcast);
        },
      },
    );
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Publish a signed kind-1111 comment to the discussion write superset (outbox
 * floor UNION the public floor), PLUS each @-mentioned user's NIP-65 inbox/read
 * relays (`mentionInboxRelays`) so the mention actually reaches them in whatever
 * client they use — the interop payoff of an outbox-routed mention. The
 * superset is honored verbatim (never narrower); the mention inboxes are
 * additive + capped. `userSelected` is true so the curated set is broadcast as
 * assembled rather than health-trimmed. This is a LOUDLY PUBLIC note.
 */
export async function publishComment(
  signedEvent: Event,
  pubkey: string | null | undefined,
  mentionInboxRelays: readonly string[] = [],
): Promise<boolean> {
  const { publishEvent } = await import("./nostr");
  const base = pubkey
    ? withOutboxFloor(getAllWriteRelays(pubkey), pubkey)
    : DEFAULT_RELAYS;
  const relays = discussionWriteTargets(base, mentionInboxRelays);
  return await publishEvent(signedEvent, relays, undefined, true, false);
}
