import type { Event as NostrEvent, Filter } from "nostr-tools";
import { REPORT_HORIZON_SECONDS } from "@/lib/reports-queue";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";
import { pool, publishEvent, publishEventDetailed, subscriptionAuthFor } from "./nostr";
import { summarizePublishRejections } from "./publish-rejection";
import { resolveSessionSigner } from "./session-signer";
import { withReach, canReachAny, relayRefusedUs, type Reached } from "./relay-reach";

// The active session signer, whatever the login method. Lifted into
// lib/session-signer.ts once outpost-relays.ts turned out to have MISSED this
// fix and kept a raw window.nostr — which silently no-opped every community
// publish for anyone without a browser extension. Two copies of a rule is how
// the second one gets forgotten; there is now one.
const resolveSigner = resolveSessionSigner;

export const KIND_GROUP_CHAT = 9;
export const KIND_GROUP_PUT_USER = 9000;
export const KIND_GROUP_REMOVE_USER = 9001;
export const KIND_GROUP_EDIT_METADATA = 9002;
export const KIND_GROUP_DELETE_EVENT = 9005;
export const KIND_GROUP_CREATE = 9007;
export const KIND_GROUP_DELETE = 9008;
export const KIND_GROUP_CREATE_INVITE = 9009;
export const KIND_GROUP_JOIN_REQUEST = 9021;
export const KIND_GROUP_LEAVE_REQUEST = 9022;
export const KIND_GROUP_METADATA = 39000;
export const KIND_GROUP_ADMINS = 39001;
export const KIND_GROUP_MEMBERS = 39002;
export const KIND_GROUP_ROLES = 39003;
export const KIND_SIMPLE_GROUPS_LIST = 10009;

/**
 * How long a one-shot NIP-29 fetch waits for the relay.
 *
 * Was 8s (6s in one place), which is under the ~8-12.5s a real community relay
 * was measured taking to answer (#583). Every fetcher here settles on a timer
 * or an EOSE, so a short timer is itself a way of reporting "nothing" about a
 * relay that was mid-sentence. Kept below subscribeFilters' maxWait so the
 * caller's timer, not a fabricated EOSE, is what ends the wait.
 */
export const NIP29_FETCH_TIMEOUT_MS = 15_000;

export interface GroupMetadata {
  id: string;
  name?: string;
  picture?: string;
  about?: string;
  isPrivate: boolean;
  isRestricted: boolean;
  isHidden: boolean;
  isClosed: boolean;
  /**
   * The relay POSITIVELY said this group is open — an `open` tag, not merely
   * the absence of `closed`.
   *
   * The distinction is the whole point: `!isClosed` conflates "the relay told
   * us anyone may walk in" with "we have no metadata for this group", and only
   * the first of those means there is nothing to admit. Gating an operator
   * surface on `isClosed` turns every un-served group into a confident empty.
   */
  isOpen: boolean;
  /**
   * The relay POSITIVELY said this group is public — a `public` tag, not merely
   * the absence of `private`.
   *
   * Same doctrine as `isOpen` above, on the other axis. NIP-29 says a relay
   * SHOULD carry one of public/private, but "should" is not "did": a group we
   * never fetched metadata for has neither tag, and reading that as public
   * would put "anyone can read what's posted here" on screen on the strength
   * of no evidence at all. The two flags are read together and disagreement
   * (or silence) is reported as unknown, never resolved in either direction.
   */
  isPublic: boolean;
  /**
   * We HOLD this room's kind-39000 — not "some field happens to be set".
   *
   * The difference between a document that says nothing and no document is the
   * one this codebase keeps collapsing. NIP-29's defaults are public and open,
   * and newlay omits default tags entirely, so a room someone opened carries
   * NEITHER `open` nor `closed`. Reading that as "unknown" tells an admin who
   * just opened their room that we cannot tell how people join it.
   *
   * With this flag the default can be read safely: absent tags in metadata we
   * received mean the default; absent metadata means we know nothing. See
   * lib/nip29-door.ts, which is the only place that decision should be made.
   */
  resolved: boolean;
  pinnedMessageId?: string;
  metaUpdatedAt?: number;
}

export interface GroupAdmin {
  pubkey: string;
  roles: string[];
}

export interface GroupRole {
  name: string;
  description?: string;
}

export interface GroupMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  groupId: string;
  replyTo?: string;
  tags: string[][];
}

export interface JoinRequest {
  pubkey: string;
  createdAt: number;
  eventId: string;
  code?: string;
}

export interface SimpleGroupEntry {
  groupId: string;
  relayUrl: string;
  name?: string;
}

/**
 * Whether a relay hosts NIP-29 groups — with the third answer named.
 *
 * "yes" and "no" are not the only outcomes. A relay's NIP-11 document can
 * simply be unreadable: a 502 from its HTTP front end, a CORS refusal, a
 * timeout. That is not evidence of anything about the relay's capabilities,
 * and the two call sites want OPPOSITE things when it happens:
 *
 *   discovery   must not recommend a relay it hasn't confirmed  -> treat as no
 *   an outpost  must not hide rooms the user already has        -> treat as yes
 *      you already added
 *
 * Both are right. Encoding them as two functions each with its own `??`
 * default let them drift apart silently, and one of them was already dead: a
 * `|| []` upstream meant CommsTab's permissive default could never fire, so a
 * relay whose HTTP endpoint blipped was told it doesn't do NIP-29 and its
 * rooms disappeared behind "This outpost doesn't have chat yet".
 */
export type Nip29Support = "yes" | "no" | "unknown";

export function nip29Support(supportedNips?: number[]): Nip29Support {
  // An EMPTY list is unknown, not a denial. No real relay supports zero NIPs —
  // every one of them speaks NIP-01 — so [] is what a failed fetch degrades
  // into, and `|| []` at a call site is precisely how this bug was introduced.
  // Refusing to read [] as a claim means the next `|| []` cannot resurrect it.
  if (!supportedNips || supportedNips.length === 0) return "unknown";
  return supportedNips.includes(29) ? "yes" : "no";
}

/** Strict: only relays we have CONFIRMED host groups. For discovery. */
export function supportsNip29(supportedNips?: number[]): boolean {
  return nip29Support(supportedNips) === "yes";
}

/**
 * Permissive: hide chat only when the relay has actually told us it has none.
 * For a space the user already added, where being wrong means hiding their
 * rooms over a transient fetch failure.
 */
export function mayHostNip29(supportedNips?: number[]): boolean {
  return nip29Support(supportedNips) !== "no";
}

export function parseGroupMetadata(event: NostrEvent): GroupMetadata | null {
  if (event.kind !== KIND_GROUP_METADATA) return null;
  const id = event.tags.find((t) => t[0] === "d")?.[1] || event.tags.find((t) => t[0] === "h")?.[1] || "_";
  const name = event.tags.find((t) => t[0] === "name")?.[1];
  const picture = event.tags.find((t) => t[0] === "picture")?.[1];
  const about = event.tags.find((t) => t[0] === "about")?.[1];
  const tagNames = event.tags.map((t) => t[0]);
  return {
    id,
    name,
    picture,
    about,
    isPrivate: tagNames.includes("private"),
    isRestricted: tagNames.includes("restricted"),
    isHidden: tagNames.includes("hidden"),
    isClosed: tagNames.includes("closed"),
    isOpen: tagNames.includes("open"),
    isPublic: tagNames.includes("public"),
    // Parsed FROM an event, so by construction we hold the metadata.
    resolved: true,
    pinnedMessageId: event.tags.find((t) => t[0] === "pinned")?.[1],
    metaUpdatedAt: event.created_at,
  };
}

export function parseGroupAdmins(event: NostrEvent): GroupAdmin[] {
  if (event.kind !== KIND_GROUP_ADMINS) return [];
  return event.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => ({
      pubkey: t[1],
      roles: t.slice(2),
    }));
}

export function parseGroupMembers(event: NostrEvent): string[] {
  if (event.kind !== KIND_GROUP_MEMBERS) return [];
  return event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

export function parseGroupRoles(event: NostrEvent): GroupRole[] {
  if (event.kind !== KIND_GROUP_ROLES) return [];
  return event.tags
    .filter((t) => t[0] === "role" && t[1])
    .map((t) => ({
      name: t[1],
      description: t[2],
    }));
}

export function parseGroupMessage(event: NostrEvent): GroupMessage | null {
  if (event.kind !== KIND_GROUP_CHAT) return null;
  const groupId = event.tags.find((t) => t[0] === "h")?.[1];
  if (!groupId) return null;
  const replyTo = event.tags.find((t) => t[0] === "e")?.[1];
  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    groupId,
    replyTo,
    tags: event.tags,
  };
}

export function parseSimpleGroupsList(event: NostrEvent): SimpleGroupEntry[] {
  if (event.kind !== KIND_SIMPLE_GROUPS_LIST) return [];
  return event.tags
    .filter((t) => t[0] === "group" && t.length >= 3)
    .map((t) => ({
      groupId: t[1],
      relayUrl: t[2].trim().replace(/\/+$/, ""),
      name: t[3] || undefined,
    }))
    .filter((e) => e.groupId && e.relayUrl);
}

export function buildSimpleGroupsListTags(groups: SimpleGroupEntry[]): string[][] {
  const tags: string[][] = [];
  const relays = new Set<string>();
  for (const g of groups) {
    const tag = g.name
      ? ["group", g.groupId, g.relayUrl, g.name]
      : ["group", g.groupId, g.relayUrl];
    tags.push(tag);
    relays.add(g.relayUrl);
  }
  for (const relay of relays) {
    tags.push(["r", relay]);
  }
  return tags;
}

/**
 * A group fetch, and whether the relay actually answered.
 *
 * `groups: []` alone cannot be read: a relay with no groups and a relay that
 * never replied produce the identical value. This fetch resolves either way —
 * it has no reject path at all — so every caller's `.catch()` was dead code,
 * and a dead relay spent ten seconds arriving at "this outpost has no rooms".
 */
export interface GroupMetadataResult {
  groups: GroupMetadata[];
  /**
   * The relay opened a socket and then REFUSED to serve us — it declined our
   * NIP-42 AUTH. Carries the relay's own words, e.g. "restricted: not a relay
   * member".
   *
   * Observed live against Buzz: socket opened in 453ms, AUTH declined, the
   * subscription returned nothing, and the UI said "No Chat Rooms Found — be
   * the first, create a channel!" about a relay full of rooms. `reached` alone
   * could not catch this, because connecting genuinely SUCCEEDED.
   */
  refusedReason?: string;
  /**
   * The relay sent EOSE — it answered, and an empty list is its real answer.
   * False means the request timed out with no reply, which is not an answer
   * about the relay's contents and must not be rendered as one.
   */
  reached: boolean;
}

export async function fetchGroupMetadataResult(
  relayUrl: string,
  // Generous headroom, not a number tuned to a slow relay. Events stream in as
  // they arrive, so a healthy relay still settles in milliseconds; this only
  // sets how long we are willing to wait before admitting we never got an
  // answer. See NIP29_FETCH_TIMEOUT_MS for why the original sizing figures were
  // withdrawn.
  timeoutMs = 15000,
  opts?: {
    /**
     * Called if the relay answers AFTER we gave up waiting.
     *
     * The timeout decides when the UI stops waiting — not when we stop
     * listening. Whatever made us give up, hanging up on the answer makes it
     * strictly worse: the rooms exist, they are merely late, and closing the
     * subscription guarantees we never see them.
     *
     * (This was built after a relay appeared to take ~27s to answer. That
     * figure was later shown to be an artifact of measuring on a second socket
     * contending with the app's own; the same query is ~87ms through the pool.
     * The mechanism is still worth having — a slow or contended relay is a real
     * condition — but it is insurance, not a fix for a known-slow relay.)
     *
     * So we resolve on time with `reached: false` — an honest "we never got an
     * answer" — and keep the subscription open. If the rooms turn up, the
     * caller gets them and the screen fills in without the user clicking
     * anything. This is a bandage over a slow relay, not a fix for it.
     */
    onLate?: (groups: GroupMetadata[]) => void;
    /** Hard ceiling on the late window, so a silent relay cannot leak a sub. */
    lateWindowMs?: number;
  },
): Promise<GroupMetadataResult> {
  // Reachability is decided by CONNECTING, not by EOSE.
  //
  // EOSE looks like the obvious signal and is not: SimplePool fires `oneose`
  // when a relay FAILS to connect, because across a relay set it means "every
  // relay has either answered or given up". Measured against a relay whose
  // socket errors immediately, the subscription EOSE'd in 143ms with zero
  // events — indistinguishable from a healthy relay that hosts no groups.
  //
  // ensureRelay rejects instead (140ms, "connection failed"), and resolves
  // ~instantly for an already-open socket, so this costs nothing on the happy
  // path.
  try {
    await pool.ensureRelay(relayUrl);
  } catch {
    return { groups: [], reached: false };
  }

  return new Promise((resolve) => {
    const groupMap = new Map<string, { meta: GroupMetadata; ts: number }>();
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The relay's own CLOSED reason, if it gave one. This is the sentence that
    // explains an empty screen, and it was being thrown away: nostr-tools'
    // handleClose calls handleEose FIRST and records the close after, so a
    // `CLOSED auth-required` reaches us as a clean EOSE with zero events and is
    // indistinguishable from "this relay hosts no groups".
    let closeReason: string | undefined;

    // --- late-answer window -------------------------------------------------
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    let lateEmit: ReturnType<typeof setTimeout> | undefined;
    const stopLate = () => {
      if (lateTimer) clearTimeout(lateTimer);
      if (lateEmit) clearTimeout(lateEmit);
      try { sub?.close(); } catch { /* already gone */ }
    };
    /** Arm the ceiling. A relay that never answers must not leak a subscription. */
    const openLate = () => {
      lateTimer = setTimeout(stopLate, opts?.lateWindowMs ?? 60_000);
    };
    /** Coalesce a burst of late events into one call to the caller. */
    const emitLate = () => {
      if (!opts?.onLate || lateEmit) return;
      lateEmit = setTimeout(() => {
        lateEmit = undefined;
        opts.onLate?.([...groupMap.values()].map((v) => v.meta));
      }, 250);
    };

    // Its own function because `oneose` can fire SYNCHRONOUSLY, before
    // subscribeMany returns — neither `sub` nor `timer` exists yet at that
    // point, and referencing them directly throws.
    // `answered` is the whole point: did the RELAY end this, or did we give up?
    const settle = (answered: boolean) => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      // Close on a real answer. On a GIVE-UP, stay subscribed: the relay may
      // still be working, and hanging up guarantees we never see the rooms.
      // openLate() below arms the ceiling that eventually does close it.
      if (answered || !opts?.onLate) sub?.close();
      else openLate();
      const groups = [...groupMap.values()].map((v) => v.meta);
      // A refusal only counts when we came away with nothing. If the relay
      // served groups and then the socket closed, we have a real answer and
      // saying "it turned us away" would be its own false claim.
      const refused =
        groups.length === 0
          ? relayRefusedUs(relayUrl) ??
            (closeReason && /auth-required|restricted|blocked/i.test(closeReason)
              ? closeReason
              : undefined)
          : undefined;
      // Timed out with nothing = we never got an answer, so it is NOT one.
      // Anything we did receive stands on its own; a relay that sent four
      // rooms and then went quiet still told us about four rooms.
      const reached = answered || groups.length > 0;
      resolve({ groups, reached, refusedReason: refused });
    };

    sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_GROUP_METADATA], limit: 100 },
      {
        onevent(e: NostrEvent) {
          const meta = parseGroupMetadata(e);
          if (!meta) return;
          const existing = groupMap.get(meta.id);
          if (!existing || e.created_at > existing.ts) {
            groupMap.set(meta.id, { meta, ts: e.created_at });
          }
          // `closed` means the PROMISE settled, not that we stopped caring.
          if (closed) emitLate();
        },
        // Deferred by one microtask so the close reason, which arrives after
        // the synthetic EOSE, still gets to be part of the answer.
        oneose() {
          if (closed) { emitLate(); stopLate(); return; }
          queueMicrotask(() => settle(true));
        },
        onclose(reason: string) {
          closeReason = reason;
          queueMicrotask(() => settle(true));
        },
        // Lets nostr-tools re-AUTH and re-issue the REQ instead of leaving us
        // with the refusal.
        onauth: subscriptionAuthFor(relayUrl),
        // THE FIX for the reported bug, and it is not a tuning knob.
        //
        // nostr-tools invents an EOSE when the relay has not sent one —
        // `baseEoseTimeout = 4400` — and delivers it through the same `oneose`
        // callback as a real one. So "the relay finished answering" and "we got
        // bored" are the same event to every caller.
        //
        // Measured 2026-08-04 against wss://relayop.communities.buzz.xyz after
        // its operator upgraded it: AUTH accepted at 1794ms, and the relay
        // delivered its four rooms at 12510ms. Our fetch returned at 4401ms —
        // the fabricated EOSE — with zero groups and `reached: true`, and the
        // owner of that community was shown "No Chat Rooms Found — be the
        // first, create a channel!"
        //
        // maxWait pushes the fabricated EOSE past our own timer, so an `oneose`
        // now means the RELAY spoke, and our timer firing means it never did.
        // Without this the distinction above is unobservable.
        maxWait: timeoutMs + 5000,
      } as any,
    );
    if (closed) sub.close();
    timer = setTimeout(() => settle(false), timeoutMs);
  });
}

/** Groups only. Callers that cannot act on unreachability keep this shape. */
export async function fetchGroupMetadata(relayUrl: string): Promise<GroupMetadata[]> {
  return (await fetchGroupMetadataResult(relayUrl)).groups;
}

/**
 * Targeted fetch of a single group's metadata by id. Unlike fetchGroupMetadata
 * (kind 39000, limit 100), this filters on `#d` so it can resolve a channel
 * that wasn't returned in the bulk discovery pass — e.g. a private/hidden
 * channel reached via an invite link. Resolves null if the relay serves no
 * metadata (which is common for non-members of restricted channels).
 */
export async function fetchSingleGroupMetadata(
  relayUrl: string,
  groupId: string,
): Promise<GroupMetadata | null> {
  return new Promise((resolve) => {
    let best: { meta: GroupMetadata; ts: number } | null = null;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      sub.close();
      clearTimeout(timer);
      resolve(best ? best.meta : null);
    };
    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_GROUP_METADATA], "#d": [groupId], limit: 1 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          const meta = parseGroupMetadata(e);
          if (!meta || meta.id !== groupId) return;
          if (!best || e.created_at > best.ts) {
            best = { meta, ts: e.created_at };
          }
        },
        oneose() {
          finish();
        },
      },
    );
    const timer = setTimeout(finish, NIP29_FETCH_TIMEOUT_MS);
  });
}

export async function fetchAllMemberCounts(
  relayUrl: string,
  groupIds?: string[],
): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const counts: Record<string, number> = {};
    const timestamps: Record<string, number> = {};
    let closed = false;

    const filters: Array<Record<string, unknown>> = [];
    if (groupIds && groupIds.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < groupIds.length; i += CHUNK) {
        const chunk = groupIds.slice(i, i + CHUNK);
        filters.push({ kinds: [KIND_GROUP_MEMBERS], "#d": chunk });
        filters.push({ kinds: [KIND_GROUP_MEMBERS], "#h": chunk });
      }
    } else {
      filters.push({ kinds: [KIND_GROUP_MEMBERS] });
    }

    const sub = pool.subscribeMany(
      [relayUrl],
      filters as any,
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          const gid = e.tags.find((t) => t[0] === "d")?.[1] || e.tags.find((t) => t[0] === "h")?.[1];
          if (!gid) return;
          const prevTs = timestamps[gid] || 0;
          if (e.created_at >= prevTs) {
            const memberPubkeys = e.tags.filter((t) => t[0] === "p" && t[1]);
            counts[gid] = memberPubkeys.length;
            timestamps[gid] = e.created_at;
          }
        },
        oneose() {
          if (closed) return;
          closed = true;
          sub.close();
          clearTimeout(timer);
          resolve(counts);
        },
      },
    );
    const timer = setTimeout(() => {
      if (!closed) {
        closed = true;
        sub.close();
        resolve(counts);
      }
    }, 10000);
  });
}

export async function fetchLastActivityBatch(
  relayUrl: string,
  groupIds: string[],
): Promise<Record<string, number>> {
  if (groupIds.length === 0) return {};
  return new Promise((resolve) => {
    const result: Record<string, number> = {};
    let closed = false;
    const filters = groupIds.map((gid) => ({
      kinds: [KIND_GROUP_CHAT],
      "#h": [gid],
      limit: 1,
    }));
    // One filter per group, spread into a single REQ. Passing the array straight
    // to subscribeMany made this silently return nothing for every group.
    const sub = subscribeFilters(relayUrl, filters, {
      onevent(e: NostrEvent) {
        if (closed) return;
        const gid = e.tags.find((t) => t[0] === "h")?.[1];
        if (gid && (!result[gid] || e.created_at > result[gid])) {
          result[gid] = e.created_at;
        }
      },
      oneose() {
        if (closed) return;
        closed = true;
        sub.close();
        clearTimeout(timer);
        resolve(result);
      },
    });
    const timer = setTimeout(() => {
      if (!closed) {
        closed = true;
        sub.close();
        resolve(result);
      }
    }, 8000);
  });
}

/**
 * Subscribe to ONE relay with one OR MORE filters.
 *
 * `pool.subscribeMany(relays, filter, …)` takes a SINGLE filter — the parameter
 * is named `filter`, and it ends up pushed into a per-URL array that the REQ
 * spreads. Hand it an array instead and the frame becomes
 *
 *     ["REQ", id, [ {...}, {...} ]]
 *
 * with an array sitting where a filter object belongs. Relays reject that —
 * tigerbalm answers `invalid: invalid filter: filter is not a JSON object` —
 * and since these fetchers resolve on EOSE or timeout, the rejection surfaced
 * as an empty result rather than an error. Seven fetchers here did it, which is
 * why group admins, members, join requests and reports were ALWAYS empty on
 * every relay: the admission and reports queues could never render a row, and
 * both self-hide when empty, so it looked exactly like "nothing to do."
 *
 * TypeScript was right the whole time. The `as unknown as Parameters<…>[1]`
 * casts that used to sit at two of these call sites were suppressing a true
 * error on the theory that the runtime took an array. It does not.
 *
 * `subscribeMap` is the multi-filter API: it takes {url, filter} pairs, groups
 * them per URL, and spreads them into one REQ. Routed through here so the
 * shape lives in exactly one place and cannot drift back.
 */
function subscribeFilters(
  relayUrl: string,
  filters: Filter[],
  handlers: { onevent(e: NostrEvent): void; oneose(): void; onclose?(reason: string): void },
): { close(): void } {
  return pool.subscribeMap(
    filters.map((filter) => ({ url: relayUrl, filter })),
    // onauth is what lets nostr-tools answer a `CLOSED auth-required` by
    // authenticating and re-issuing the REQ. Without it every NIP-29 fetcher —
    // members, admins, join requests, roles, moderation log — returns empty on
    // an auth-gated relay, and returns it as an answer.
    {
      ...handlers,
      onauth: subscriptionAuthFor(relayUrl),
      // And the other half, which onauth alone does not cover: nostr-tools
      // FABRICATES an EOSE at baseEoseTimeout = 4400ms when the relay has not
      // sent one, through the same `oneose` callback as a real one. Every
      // fetcher below settles on `oneose`, so against a relay that needs longer
      // than 4.4s they all returned empty — members, admins, join requests,
      // roles, moderation log — while the relay was still answering.
      //
      // Deliberately larger than any caller's own timeout, so the fabricated
      // EOSE can never be the thing that ends a fetch: the caller's timer
      // decides, and a real `oneose` means the relay actually spoke. Measured
      // against a relay answering in ~8-12.5s (#583).
      maxWait: 20_000,
    } as any,
  );
}

async function fetchGroupAdminsUnchecked(relayUrl: string, groupId: string): Promise<GroupAdmin[]> {
  return new Promise((resolve) => {
    let admins: GroupAdmin[] = [];
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(admins);
    };
    sub = subscribeFilters(
      relayUrl,
      [{ kinds: [KIND_GROUP_ADMINS], "#d": [groupId], limit: 1 }, { kinds: [KIND_GROUP_ADMINS], "#h": [groupId], limit: 1 }],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          admins = parseGroupAdmins(e);
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * Who administers this group — and did we actually get an answer?
 *
 * `reached: false` must never be read as "this group has no admins". Authority
 * derives from this list: an empty one collapses every capability, hides Manage
 * and Settings, and tells the relay's own operator "No admins defined".
 */
export function fetchGroupAdminsResult(relayUrl: string, groupId: string): Promise<Reached<GroupAdmin[]>> {
  return withReach(relayUrl, [] as GroupAdmin[], () => fetchGroupAdminsUnchecked(relayUrl, groupId));
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchGroupAdmins(relayUrl: string, groupId: string): Promise<GroupAdmin[]> {
  return (await fetchGroupAdminsResult(relayUrl, groupId)).data;
}

/** The groups on one relay that name you an admin, with their admin lists. */
export interface AdministeredGroups {
  groups: GroupMetadata[];
  adminsByGroupId: Map<string, GroupAdmin[]>;
}

/**
 * The groups on this relay that name YOU as an admin.
 *
 * Asked as one direct question — kind 39001 carrying a `p` tag for you —
 * instead of the obvious approach of listing the relay's groups and checking
 * each one. That approach is not merely slower; on a real relay it returns the
 * wrong answer, and does it silently.
 *
 * Measured against wss://groups.0xchat.com on 2026-08-03, signed in as an admin
 * of a closed room with somebody waiting at its door:
 *
 *   {kinds:[39000], limit:100}  -> 1265 events in 1814ms, EVERY one tagged
 *                                  `public` + `open`. Zero closed. Our own
 *                                  room absent.
 *   {kinds:[39001], "#p":[me]}  -> 1 group in 438ms — the room, closed, ours.
 *
 * The bulk listing is a PUBLIC DIRECTORY, and a closed room is precisely the
 * thing a directory does not advertise. So a moderator surface that discovers
 * its groups by enumerating and then filtering to `isClosed` is filtering a set
 * that can never contain its answer. Every reachability check passes — the
 * socket opened, EOSE arrived, 1265 events came back — and the operator is
 * still told nobody is waiting. This is the three-outcome defect one level up
 * from transport: not "we never got to ask", but "we asked the wrong question".
 *
 * The cost difference is the smaller half of the argument and still large: the
 * old shape then walked the listing SEQUENTIALLY fetching admins per group,
 * which on that relay is 1265 round-trips per page open.
 */
async function fetchGroupsIAdministerUnchecked(
  relayUrl: string,
  pubkey: string,
): Promise<AdministeredGroups> {
  const admins = await new Promise<Map<string, { admins: GroupAdmin[]; ts: number }>>((resolve) => {
    const byGroup = new Map<string, { admins: GroupAdmin[]; ts: number }>();
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(byGroup);
    };
    sub = subscribeFilters(relayUrl, [{ kinds: [KIND_GROUP_ADMINS], "#p": [pubkey] }], {
      onevent(e: NostrEvent) {
        if (closed) return;
        const gid = e.tags.find((t) => t[0] === "d")?.[1] || e.tags.find((t) => t[0] === "h")?.[1];
        if (!gid) return;
        const prev = byGroup.get(gid);
        if (!prev || e.created_at > prev.ts) {
          byGroup.set(gid, { admins: parseGroupAdmins(e), ts: e.created_at });
        }
      },
      oneose() { settle(); },
    });
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });

  const ids = [...admins.keys()];
  if (ids.length === 0) return { groups: [], adminsByGroupId: new Map() };

  // Metadata for exactly those ids, in one round-trip. A targeted `#d` resolves
  // a closed room that the bulk listing withholds — verified on 0xchat, where
  // the same room is absent from 1265 directory entries and present here.
  const metaById = await new Promise<Map<string, { meta: GroupMetadata; ts: number }>>((resolve) => {
    const byGroup = new Map<string, { meta: GroupMetadata; ts: number }>();
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(byGroup);
    };
    const filters: Filter[] = [];
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      filters.push({ kinds: [KIND_GROUP_METADATA], "#d": chunk });
      filters.push({ kinds: [KIND_GROUP_METADATA], "#h": chunk });
    }
    sub = subscribeFilters(relayUrl, filters, {
      onevent(e: NostrEvent) {
        if (closed) return;
        const meta = parseGroupMetadata(e);
        if (!meta) return;
        const prev = byGroup.get(meta.id);
        if (!prev || e.created_at > prev.ts) byGroup.set(meta.id, { meta, ts: e.created_at });
      },
      oneose() { settle(); },
    });
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });

  const adminsByGroupId = new Map<string, GroupAdmin[]>();
  const groups: GroupMetadata[] = [];
  for (const id of ids) {
    adminsByGroupId.set(id, admins.get(id)!.admins);
    // A group whose metadata the relay declined to serve is still a group we
    // are an admin of — it keeps its place with everything unknown rather than
    // being dropped, because dropping it is how "we don't know" becomes
    // "nothing here". `isOpen: false` means unknown, and unknown gets asked.
    groups.push(
      metaById.get(id)?.meta ?? {
        id,
        isPrivate: false,
        isRestricted: false,
        isHidden: false,
        isClosed: false,
        isOpen: false,
        isPublic: false,
        resolved: false,
      },
    );
  }
  return { groups, adminsByGroupId };
}

/**
 * The groups you administer here — and did we actually get an answer?
 *
 * `reached: false` must never be read as "you run nothing on this relay": it
 * collapses the whole operator surface, and an admin whose relay was briefly
 * silent would be told their queues are empty.
 */
export function fetchGroupsIAdministerResult(
  relayUrl: string,
  pubkey: string,
): Promise<Reached<AdministeredGroups>> {
  return withReach(
    relayUrl,
    { groups: [], adminsByGroupId: new Map() } as AdministeredGroups,
    () => fetchGroupsIAdministerUnchecked(relayUrl, pubkey),
  );
}

async function fetchGroupMembersUnchecked(relayUrl: string, groupId: string): Promise<string[]> {
  return new Promise((resolve) => {
    let members: string[] = [];
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(members);
    };
    sub = subscribeFilters(
      relayUrl,
      [{ kinds: [KIND_GROUP_MEMBERS], "#d": [groupId], limit: 1 }, { kinds: [KIND_GROUP_MEMBERS], "#h": [groupId], limit: 1 }],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          members = parseGroupMembers(e);
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * Who is in this group — and did we actually get an answer?
 *
 * `reached: false` must never be read as "this group is empty", and above all
 * never as "you are not a member": the composer is gated on finding yourself in
 * this list, so a silent relay locks a real member out of their own room and
 * offers them a Join button.
 */
export function fetchGroupMembersResult(relayUrl: string, groupId: string): Promise<Reached<string[]>> {
  return withReach(relayUrl, [] as string[], () => fetchGroupMembersUnchecked(relayUrl, groupId));
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchGroupMembers(relayUrl: string, groupId: string): Promise<string[]> {
  return (await fetchGroupMembersResult(relayUrl, groupId)).data;
}

/**
 * Reports (kind-1984) filed against people in this group, from this relay.
 *
 * Scoped by `#p` over the member list rather than by group id, because NIP-56
 * has no notion of a group: a report names a person and optionally a message,
 * and nothing obliges the reporter to tag which room it happened in. Asking the
 * relay the group lives on, about the people who are in it, is the closest
 * honest approximation — and it is the same shape nip86.ts already uses to pull
 * moderator-authored reports.
 *
 * Consequence worth stating: a report about a member's activity ELSEWHERE can
 * land here. The queue treats reports as "worth a moderator's eye", not as
 * proof about this room, and the card says which message it names when it names
 * one at all.
 */
/**
 * Resolve reported events by id, so the queue can read their `h` tag.
 *
 * This is what turns "reports naming people who are also members here" into
 * "reports about messages in THIS room". Ids that the relay declines to serve
 * are simply absent from the map — the caller distinguishes absent (unknown)
 * from present-with-no-h (not a group message), and must not treat the two the
 * same.
 */
export async function fetchEventsByIds(
  relayUrl: string,
  ids: string[],
): Promise<Map<string, NostrEvent>> {
  const wanted = [...new Set((ids ?? []).filter(Boolean))].slice(0, 200);
  const found = new Map<string, NostrEvent>();
  if (wanted.length === 0) return found;
  return new Promise((resolve) => {
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      sub.close();
      clearTimeout(timer);
      resolve(found);
    };
    const sub = subscribeFilters(
      relayUrl,
      [{ ids: wanted }],
      {
        onevent(e: NostrEvent) {
          if (!closed) found.set(e.id, e);
        },
        oneose: finish,
      },
    );
    const timer = setTimeout(finish, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * Ids of messages a moderator has already removed from this group.
 *
 * The relay's own kind-9005 log, which is the durable record of what has been
 * handled — it survives a reload, a different device, and a different moderator.
 * Used to stop the reports queue re-raising a report whose message is already
 * gone, where the deletion itself is what makes the message unresolvable.
 *
 * Only the delete kind, not the whole moderation log: this runs once per group
 * on every queue refresh, and the other six kinds are nothing to do with it.
 */
export async function fetchDeletedEventIds(relayUrl: string, groupId: string, limit = 500): Promise<Set<string>> {
  return new Promise((resolve) => {
    const ids = new Set<string>();
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      sub.close();
      clearTimeout(timer);
      resolve(ids);
    };
    const sub = subscribeFilters(
      relayUrl,
      [{ kinds: [KIND_GROUP_DELETE_EVENT], "#h": [groupId], limit }],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          for (const t of e.tags ?? []) if (t[0] === "e" && t[1]) ids.add(t[1]);
        },
        oneose: finish,
      },
    );
    const timer = setTimeout(finish, NIP29_FETCH_TIMEOUT_MS);
  });
}

export async function fetchGroupReports(
  relayUrl: string,
  memberPubkeys: string[],
  limit = 300,
): Promise<NostrEvent[]> {
  const targets = (memberPubkeys ?? []).filter(Boolean).slice(0, 200);
  if (targets.length === 0) return [];
  return new Promise((resolve) => {
    const out: NostrEvent[] = [];
    const seen = new Set<string>();
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      sub.close();
      clearTimeout(timer);
      resolve(out);
    };
    const sub = subscribeFilters(
      relayUrl,
      // since: the queue's 90-day horizon (reports-queue.ts) drops older
      // reports anyway — asking for them just moves dead weight over the wire.
      [{ kinds: [1984], "#p": targets, limit, since: Math.floor(Date.now() / 1000) - REPORT_HORIZON_SECONDS }],
      {
        onevent(e: NostrEvent) {
          if (closed || seen.has(e.id)) return;
          seen.add(e.id);
          out.push(e);
        },
        oneose: finish,
      },
    );
    const timer = setTimeout(finish, NIP29_FETCH_TIMEOUT_MS);
  });
}

async function fetchJoinRequestsUnchecked(relayUrl: string, groupId: string): Promise<JoinRequest[]> {
  return new Promise((resolve) => {
    const requests: JoinRequest[] = [];
    const seen = new Set<string>();
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(requests.sort((a, b) => b.createdAt - a.createdAt));
    };
    sub = subscribeFilters(
      relayUrl,
      [{ kinds: [KIND_GROUP_JOIN_REQUEST], "#h": [groupId], limit: 200 }],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          if (seen.has(e.pubkey)) return;
          seen.add(e.pubkey);
          const code = e.tags.find((t) => t[0] === "code")?.[1];
          requests.push({
            pubkey: e.pubkey,
            createdAt: e.created_at,
            eventId: e.id,
            code,
          });
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * Who is queued at the door — and did we actually get an answer?
 *
 * `reached: false` must never render as "Nobody is waiting.": people stay
 * standing outside a closed room with nothing to tell the moderator otherwise.
 */
export function fetchJoinRequestsResult(relayUrl: string, groupId: string): Promise<Reached<JoinRequest[]>> {
  return withReach(relayUrl, [] as JoinRequest[], () => fetchJoinRequestsUnchecked(relayUrl, groupId));
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchJoinRequests(relayUrl: string, groupId: string): Promise<JoinRequest[]> {
  return (await fetchJoinRequestsResult(relayUrl, groupId)).data;
}

async function fetchGroupRolesUnchecked(relayUrl: string, groupId: string): Promise<GroupRole[]> {
  return new Promise((resolve) => {
    let roles: GroupRole[] = [];
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(roles);
    };
    sub = subscribeFilters(
      relayUrl,
      [{ kinds: [KIND_GROUP_ROLES], "#d": [groupId], limit: 1 }, { kinds: [KIND_GROUP_ROLES], "#h": [groupId], limit: 1 }],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          roles = parseGroupRoles(e);
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * The roles this relay defines for the group — and did we actually get an
 * answer? `reached: false` must never render as "No roles defined by relay":
 * that is a capability claim about the relay, produced by a read that failed.
 */
export function fetchGroupRolesResult(relayUrl: string, groupId: string): Promise<Reached<GroupRole[]>> {
  return withReach(relayUrl, [] as GroupRole[], () => fetchGroupRolesUnchecked(relayUrl, groupId));
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchGroupRoles(relayUrl: string, groupId: string): Promise<GroupRole[]> {
  return (await fetchGroupRolesResult(relayUrl, groupId)).data;
}

export interface GroupMembershipHistory {
  added: Record<string, number>;
  removed: Record<string, number>;
}

export async function fetchGroupMembershipHistory(
  relayUrl: string,
  groupId: string,
  limit = 1000,
): Promise<GroupMembershipHistory> {
  return new Promise((resolve) => {
    const allAdds: Record<string, number[]> = {};
    const allRemoves: Record<string, number[]> = {};
    let closed = false;
    const sub = subscribeFilters(
      relayUrl,
      [
        { kinds: [KIND_GROUP_PUT_USER], "#h": [groupId], limit },
        { kinds: [KIND_GROUP_REMOVE_USER], "#h": [groupId], limit },
      ],
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          for (const tag of e.tags) {
            if (tag[0] !== "p" || !tag[1]) continue;
            const pk = tag[1].toLowerCase();
            if (e.kind === KIND_GROUP_PUT_USER) {
              (allAdds[pk] ||= []).push(e.created_at);
            } else if (e.kind === KIND_GROUP_REMOVE_USER) {
              (allRemoves[pk] ||= []).push(e.created_at);
            }
          }
        },
        oneose() {
          if (closed) return;
          closed = true;
          sub.close();
          clearTimeout(timer);
          resolve(reduce());
        },
      },
    );
    const timer = setTimeout(() => {
      if (!closed) {
        closed = true;
        sub.close();
        resolve(reduce());
      }
    }, 10000);

    function reduce(): GroupMembershipHistory {
      const added: Record<string, number> = {};
      const removed: Record<string, number> = {};
      const allPks = new Set([...Object.keys(allAdds), ...Object.keys(allRemoves)]);
      for (const pk of allPks) {
        const adds = (allAdds[pk] || []).sort((a, b) => a - b);
        const removes = (allRemoves[pk] || []).sort((a, b) => a - b);
        const lastRemove = removes.length > 0 ? removes[removes.length - 1] : 0;
        const lastAdd = adds.length > 0 ? adds[adds.length - 1] : 0;
        if (lastAdd > lastRemove) {
          // Currently a member — find first add after the last remove
          const firstAddAfterRemove = adds.find((t) => t > lastRemove);
          if (firstAddAfterRemove) added[pk] = firstAddAfterRemove;
        }
        if (lastRemove > lastAdd) {
          removed[pk] = lastRemove;
        }
      }
      return { added, removed };
    }
  });
}

async function fetchModerationLogUnchecked(relayUrl: string, groupId: string, limit = 50): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(events.sort((a, b) => b.created_at - a.created_at));
    };
    sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_GROUP_PUT_USER, KIND_GROUP_REMOVE_USER, KIND_GROUP_EDIT_METADATA, KIND_GROUP_DELETE_EVENT, KIND_GROUP_CREATE, KIND_GROUP_DELETE, KIND_GROUP_CREATE_INVITE], "#h": [groupId], limit },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          events.push(e);
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, 10000);
  });
}

/**
 * The group's moderation history — and did we actually get an answer?
 *
 * This one is an AUDIT LOG, so `reached: false` is the difference between "no
 * one has ever been removed here" and "we don't know who was removed here".
 * Never collapse them.
 */
export function fetchModerationLogResult(
  relayUrl: string,
  groupId: string,
  limit = 50,
): Promise<Reached<NostrEvent[]>> {
  return withReach(relayUrl, [] as NostrEvent[], () => fetchModerationLogUnchecked(relayUrl, groupId, limit));
}

/** Bare-value shim. Prefer the Result form anywhere the emptiness is shown. */
export async function fetchModerationLog(relayUrl: string, groupId: string, limit = 50): Promise<NostrEvent[]> {
  return (await fetchModerationLogResult(relayUrl, groupId, limit)).data;
}

function buildPreviousTags(recentEvents: NostrEvent[]): string[][] {
  const sorted = [...recentEvents].sort((a, b) => b.created_at - a.created_at);
  const selected = sorted.slice(0, 3);
  return selected.map((e) => ["previous", e.id]);
}

/**
 * Sign a group-management event and publish it, KEEPING what the relay said.
 *
 * Eight senders carried this exact body with `publishEvent` in the middle, so
 * eight distinct refusals all became the same `false`. On bunk-test a
 * non-admin's kind-9000 comes back
 *
 *     restricted: you are not authorized to moderate group qa-9002-probe-287534
 *
 * — the entire answer, thrown away, and the UI said "Failed to assign role".
 * That cost an afternoon of guessing at a button that was working perfectly.
 * `publish-rejection.ts` was written for precisely this and its docstring says
 * so; it just had two callers instead of ten.
 *
 * One function rather than eight copies, because eight copies of a six-line
 * tail is how the gift-wrap builders drifted apart (PR #29). The two
 * pre-publish strings are lifted verbatim from `sendDeleteEvent` so there is
 * one vocabulary here, not two.
 *
 * NOT used by `sendGroupChat`: that one retries (see its own body), so the
 * rejections worth reporting are the RETRY's, and reporting the first
 * attempt's would surface the stale "not authenticated" that publishEventDetailed
 * already documents as misleading.
 */
async function publishGroupAction(
  relayUrl: string,
  template: { kind: number; created_at: number; tags: string[][]; content: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const signer = resolveSigner();
    if (!signer) return { ok: false, error: "No signer available — sign in again." };
    const signed = await withSignerTimeout(signer.signEvent(template), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return { ok: false, error: "Signing was cancelled or timed out." };
    const { ok, rejections } = await publishEventDetailed(signed, [relayUrl], undefined, true);
    if (ok) return { ok: true };
    return { ok: false, error: summarizePublishRejections(rejections) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : undefined };
  }
}

/**
 * Publish an already-signed event to ONE group relay, surviving the idle
 * socket. After the app sits in a background tab the relay connection may be
 * dropped or de-authenticated; publishing straight into that fails — which is
 * how reactions died with "Couldn't add reaction" while chat sends (which had
 * this dance inline) kept working. Wake the socket so the pool re-runs NIP-42
 * AUTH on a fresh connection, then give a just-reconnected relay one
 * settle-then-retry before answering false.
 *
 * `io` exists for the tests: real callers pass nothing.
 */
export async function publishToGroupRelay(
  relayUrl: string,
  signed: NostrEvent,
  io: {
    ensure?: (url: string) => Promise<unknown>;
    publish?: (ev: NostrEvent, relays: string[]) => Promise<boolean>;
    settleMs?: number;
  } = {},
): Promise<boolean> {
  const ensure = io.ensure ?? ((u: string) => pool.ensureRelay(u));
  const publish = io.publish ?? ((ev: NostrEvent, rs: string[]) => publishEvent(ev, rs, undefined, true));
  const settleMs = io.settleMs ?? 1200;
  try { await ensure(relayUrl); } catch {}
  let ok = await publish(signed, [relayUrl]);
  if (!ok) {
    await new Promise((r) => setTimeout(r, settleMs));
    ok = await publish(signed, [relayUrl]);
  }
  return ok;
}

export async function sendGroupChat(
  relayUrl: string,
  groupId: string,
  content: string,
  recentEvents: NostrEvent[],
  replyToId?: string,
  onSigned?: (event: NostrEvent) => void,
): Promise<boolean> {
  const tags: string[][] = [["h", groupId], ...buildPreviousTags(recentEvents)];
  if (replyToId) {
    tags.push(["e", replyToId, relayUrl, "reply"]);
  }
  const eventTemplate = {
    kind: KIND_GROUP_CHAT,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
  try {
    const signer = resolveSigner();
    if (!signer) return false;
    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return false;
    // Surface the signed event so callers can render it optimistically (with a
    // "sending" tick) before the relay round-trip completes.
    onSigned?.(signed);
    return await publishToGroupRelay(relayUrl, signed);
  } catch {
    return false;
  }
}

export async function sendJoinRequest(relayUrl: string, groupId: string, inviteCode?: string): Promise<{ ok: boolean; error?: string }> {
  const tags: string[][] = [["h", groupId]];
  if (inviteCode) tags.push(["code", inviteCode]);
  const eventTemplate = {
    kind: KIND_GROUP_JOIN_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

export async function sendLeaveRequest(relayUrl: string, groupId: string): Promise<{ ok: boolean; error?: string }> {
  const eventTemplate = {
    kind: KIND_GROUP_LEAVE_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", groupId]],
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

/**
 * Ask the relay to delete a message from a group (NIP-29 kind-9005).
 *
 * Returns { ok, error } rather than a bare boolean, for the reason a live test
 * just demonstrated: the moderation row awaited this, discarded the result, and
 * showed "Message removed" unconditionally. The relay had not removed anything,
 * the report stayed standing, and the row reappeared on the next refetch — a
 * moderator would have believed they had acted.
 *
 * A delete is the most consequential thing this queue can do. It is the LAST
 * place a silent failure belongs.
 */
export async function sendDeleteEvent(relayUrl: string, groupId: string, eventId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const eventTemplate = {
    kind: KIND_GROUP_DELETE_EVENT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", groupId], ["e", eventId]],
    content: reason || "",
  };
  try {
    const signer = resolveSigner();
    if (!signer) return { ok: false, error: "No signer available — sign in again." };
    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return { ok: false, error: "Signing was cancelled or timed out." };
    const { ok, rejections } = await publishEventDetailed(signed, [relayUrl], undefined, true);
    if (ok) return { ok: true };
    return { ok: false, error: summarizePublishRejections(rejections) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : undefined };
  }
}

export async function sendRemoveUser(relayUrl: string, groupId: string, userPubkey: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const eventTemplate = {
    kind: KIND_GROUP_REMOVE_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", groupId], ["p", userPubkey]],
    content: reason || "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

export async function sendPutUser(relayUrl: string, groupId: string, userPubkey: string, roles: string[] = []): Promise<{ ok: boolean; error?: string }> {
  const tags: string[][] = [["h", groupId], ["p", userPubkey, ...roles]];
  const eventTemplate = {
    kind: KIND_GROUP_PUT_USER,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

/**
 * Turn a human name into a usable group id.
 *
 * A group id is an address, not a label — lowercase, no spaces, safe in a URL.
 * The random suffix is what makes "General" creatable on a relay that already
 * has a "general": NIP-29 ids are unique per relay, and without it the second
 * person to name a room something obvious silently collides with the first.
 *
 * Extracted here because CommsTab had this exact expression inline while the
 * relay-ops form had nothing at all — which is how a create button that emits an
 * event no relay can accept shipped in one of the two places.
 */
export function deriveGroupId(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  // A name of only punctuation/emoji slugs to nothing; "group" keeps the id
  // legal rather than emitting a bare "-abc123".
  return `${slug || "group"}-${suffix}`;
}

export async function sendCreateGroup(
  relayUrl: string,
  opts?: { groupId?: string; name?: string; about?: string; isPrivate?: boolean; isClosed?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  // The relay's own rule, enforced before we spend a signature on it:
  //   invalid: a group event must carry an "h" tag
  // The old code pushed `h` only `if (opts?.groupId)`, so an empty id produced a
  // perfectly-signed event that every conforming NIP-29 relay must reject.
  const groupId = opts?.groupId?.trim();
  if (!groupId) return { ok: false, error: "A group needs an ID before it can be created." };

  const tags: string[][] = [["h", groupId]];
  if (opts?.name) tags.push(["name", opts.name]);
  if (opts?.about) tags.push(["about", opts.about]);
  if (opts?.isPrivate) tags.push(["private"]);
  if (opts?.isClosed) tags.push(["closed"]);
  const eventTemplate = {
    kind: KIND_GROUP_CREATE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  try {
    const signer = resolveSigner();
    if (!signer) return { ok: false, error: "No signer available — sign in again." };
    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return { ok: false, error: "Signing was cancelled or timed out." };
    // Detailed variant: creation is exactly the case where the relay's refusal is
    // the whole answer — "open the site in your browser" (relay29 hosts block
    // programmatic creation) is a different problem from a malformed event.
    const { ok, rejections } = await publishEventDetailed(signed, [relayUrl], undefined, true);
    if (ok) return { ok: true };
    return { ok: false, error: summarizePublishRejections(rejections) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : undefined };
  }
}

export async function sendEditMetadata(
  relayUrl: string,
  groupId: string,
  opts: { name?: string; about?: string; picture?: string },
): Promise<{ ok: boolean; error?: string }> {
  const tags: string[][] = [["h", groupId]];
  if (opts.name !== undefined) tags.push(["name", opts.name]);
  if (opts.about !== undefined) tags.push(["about", opts.about]);
  if (opts.picture !== undefined) tags.push(["picture", opts.picture]);
  const eventTemplate = {
    kind: KIND_GROUP_EDIT_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

/**
 * Change who can READ and who can JOIN — kind 9002, door tags only.
 *
 * Separate from `sendEditMetadata` because it is a different decision with a
 * different blast radius: a rename is cosmetic, a door is authority. Sharing
 * one function would mean every name edit silently restated the door, and a
 * stale door value in a form would then reopen a room somebody closed.
 *
 * MEASURED BEFORE BUILDING (2026-08-05, newlay 0.3.6 — see lib/nip29-door.ts):
 *
 *   - 9002 is MERGE. `9002 [name]` changed the name and left `about` intact, so
 *     sending door tags alone cannot wipe the room's identity. That was the
 *     open question this feature was gated on, and it is why the partial edit
 *     below is safe rather than reckless.
 *   - The opposite flag IS removed: `9002 [open]` on a closed room dropped
 *     `closed`. So flipping a door genuinely flips it, rather than accumulating
 *     both and leaving the room in a state nothing can read.
 *   - The relay adds no positive `open`/`public` tag — those are NIP-29
 *     defaults and it omits them. Which is exactly why `resolved` exists.
 *
 * Both axes are sent TOGETHER and always, even when only one changed. NIP-29
 * gives no way to say "leave the other alone", and a caller that omitted the
 * unchanged axis would be relying on merge to preserve it — true on this relay,
 * unmeasured on every other. Sending the full door is the same discipline the
 * replaceable-event rule already demands elsewhere in this repo.
 */
export async function sendEditAccess(
  relayUrl: string,
  groupId: string,
  door: { isPrivate: boolean; isClosed: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const tags: string[][] = [
    ["h", groupId],
    // Positive on BOTH sides. The relay may drop the default-valued one, which
    // is its business; what matters is that we never leave the choice implied.
    [door.isPrivate ? "private" : "public"],
    [door.isClosed ? "closed" : "open"],
  ];
  const eventTemplate = {
    kind: KIND_GROUP_EDIT_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

// Pin (or unpin, messageId=null) a chat message via a minimal 9002 edit carrying
// only the `pinned` tag, so it patches metadata without touching name/visibility.
// Relay-dependent: relays that drop unknown tags will simply not persist the pin.
export async function sendGroupPin(relayUrl: string, groupId: string, messageId: string | null): Promise<{ ok: boolean; error?: string }> {
  const tags: string[][] = [["h", groupId]];
  if (messageId) tags.push(["pinned", messageId]);
  const eventTemplate = {
    kind: KIND_GROUP_EDIT_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

export async function sendCreateInvite(relayUrl: string, groupId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const eventTemplate = {
    kind: KIND_GROUP_CREATE_INVITE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", groupId], ["code", code]],
    content: "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

export async function sendDeleteGroup(relayUrl: string, groupId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const eventTemplate = {
    kind: KIND_GROUP_DELETE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", groupId]],
    content: reason || "",
  };
  return publishGroupAction(relayUrl, eventTemplate);
}

// Shareable deep link to a channel. An optional invite code rides along so
// closed/restricted channels can auto-approve when the invitee taps Join.
// An optional inviterNpub rides along so a brand-new account created from this
// link can auto-follow the person who invited them (and land in the outpost
// with a friend whose trust score is already calculated).
export function buildChannelInviteLink(relayUrl: string, groupId: string, code?: string, inviterNpub?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  let url = `${origin}/outposts/${encodeURIComponent(relayUrl)}?tab=channels&channel=${encodeURIComponent(groupId)}`;
  if (code) url += `&code=${encodeURIComponent(code)}`;
  if (inviterNpub) url += `&inviter=${encodeURIComponent(inviterNpub)}`;
  return url;
}

export async function publishSimpleGroupsList(groups: SimpleGroupEntry[]): Promise<boolean> {
  const tags = buildSimpleGroupsListTags(groups);
  const eventTemplate = {
    kind: KIND_SIMPLE_GROUPS_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  try {
    const signer = resolveSigner();
    if (!signer) return false;
    const signed = await withSignerTimeout(signer.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
    if (!signed) return false;
    return await publishEvent(signed);
  } catch {
    return false;
  }
}

const SIMPLE_GROUPS_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];
const simpleGroupsCacheKey = (pubkey: string) => `relay_outpost_simple_groups_${pubkey}`;

/** Remember that this account HAS joined rooms, durably, so a later empty read
 *  can be recognised as suspicious rather than believed. Never shrinks to zero:
 *  the point is evidence that entries once existed. */
function rememberSimpleGroups(pubkey: string, entries: SimpleGroupEntry[]): void {
  if (entries.length === 0) return;
  try {
    localStorage.setItem(simpleGroupsCacheKey(pubkey), JSON.stringify({ count: entries.length }));
  } catch {}
}

/** True if we have durable evidence this account already joined rooms. */
function hasKnownSimpleGroups(pubkey: string): boolean {
  try {
    const raw = localStorage.getItem(simpleGroupsCacheKey(pubkey));
    return !!raw && (JSON.parse(raw)?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

export interface SimpleGroupsBase {
  entries: SimpleGroupEntry[];
  /** True when we could NOT obtain an authoritative base. The caller MUST abort
   *  rather than publish — republishing from a base we never loaded replaces
   *  the user's entire joined-rooms list with whatever we happen to be holding. */
  blocked: boolean;
}

/**
 * Resolve the authoritative kind-10009 to build an incremental join/leave on.
 *
 * This is the kind-3 follow-list wipe footgun (see lib/follow-list.ts) on a
 * different kind, and it went unguarded: six call sites read the list, add or
 * remove one entry, and publish the result as a REPLACEABLE event. An empty
 * read therefore does not merely display wrong — it publishes a kind-10009
 * that erases every room the user had joined.
 *
 * `fetchSimpleGroupsList` cannot fail: it resolves [] whether the account has
 * no rooms or all three relays were unreachable. Unlike follow-list.ts — which
 * had to INFER "this account has entries" from a durable cache because it had
 * no reachability signal — we can ask directly, so the guard is exact for the
 * offline case and falls back to the durable cache only for the subtler one:
 * relays that answered but had not yet seen this account's list.
 */
export async function loadSimpleGroupsBase(pubkey: string): Promise<SimpleGroupsBase> {
  if (!(await canReachAny(SIMPLE_GROUPS_RELAYS))) return { entries: [], blocked: true };

  const entries = await fetchSimpleGroupsListUnchecked(pubkey);
  if (entries.length > 0) {
    rememberSimpleGroups(pubkey, entries);
    return { entries, blocked: false };
  }

  // Reached, and empty. Genuinely-new accounts land here and must be allowed to
  // create their first list — so only block when we have durable evidence that
  // this account had rooms and the relays simply did not hand them over.
  return { entries: [], blocked: hasKnownSimpleGroups(pubkey) };
}

async function fetchSimpleGroupsListUnchecked(pubkey: string): Promise<SimpleGroupEntry[]> {
  return new Promise((resolve) => {
    let entries: SimpleGroupEntry[] = [];
    let closed = false;
    let sub: { close(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (closed) return;
      closed = true;
      sub?.close();
      if (timer) clearTimeout(timer);
      resolve(entries);
    };
    sub = pool.subscribeMany(
      SIMPLE_GROUPS_RELAYS,
      { kinds: [KIND_SIMPLE_GROUPS_LIST], authors: [pubkey], limit: 1 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          entries = parseSimpleGroupsList(e);
        },
        oneose() { settle(); },
      },
    );
    if (closed) sub.close();
    timer = setTimeout(settle, NIP29_FETCH_TIMEOUT_MS);
  });
}

/**
 * Read-only view of the joined-rooms list, for display.
 *
 * NEVER build a replacement kind-10009 on this — it returns [] for an
 * unreachable relay set and publishing from that wipes the list. Use
 * `loadSimpleGroupsBase` and honour its `blocked` flag.
 */
export async function fetchSimpleGroupsList(pubkey: string): Promise<SimpleGroupEntry[]> {
  const entries = await fetchSimpleGroupsListUnchecked(pubkey);
  rememberSimpleGroups(pubkey, entries);
  return entries;
}

export function getModerationActionName(kind: number): string {
  switch (kind) {
    case KIND_GROUP_PUT_USER: return "Added User";
    case KIND_GROUP_REMOVE_USER: return "Removed User";
    case KIND_GROUP_EDIT_METADATA: return "Edited Metadata";
    case KIND_GROUP_DELETE_EVENT: return "Deleted Event";
    case KIND_GROUP_CREATE: return "Created Group";
    case KIND_GROUP_DELETE: return "Deleted Group";
    case KIND_GROUP_CREATE_INVITE: return "Created Invite";
    default: return `Action ${kind}`;
  }
}

/**
 * The same acts, as a sentence fragment: "<who> <phrase> <whom>".
 *
 * Deliberately NOT `getModerationActionName(kind).toLowerCase()`, which is what
 * the admin drawer used to do. That produced "alice added user bob" — a label
 * carrying its own noun, dropped into a sentence that already supplies one —
 * and it leaked "created group" onto a screen whose whole job is to say "room".
 * A Title Case column header and a fragment of prose are two jobs; one string
 * doing both will be wrong for one of them.
 */
export function getModerationActionPhrase(kind: number): string {
  switch (kind) {
    case KIND_GROUP_PUT_USER: return "added";
    case KIND_GROUP_REMOVE_USER: return "removed";
    case KIND_GROUP_EDIT_METADATA: return "edited this room";
    case KIND_GROUP_DELETE_EVENT: return "deleted a message";
    case KIND_GROUP_CREATE: return "created this room";
    case KIND_GROUP_DELETE: return "deleted this room";
    case KIND_GROUP_CREATE_INVITE: return "made an invite link";
    default: return "made a change";
  }
}
