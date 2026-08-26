/**
 * Tier-2 of the Concord notification model: per-channel MENTION counts.
 *
 * Three tiers (Discord/Slack model, calm-brand tuned):
 *   1. plain activity   → a dot, never a number
 *   2. mention/reply-to-you → a small violet count badge
 *   3. muted            → nothing at all (concord-mute wins over everything)
 *
 * This module is the mention LEDGER: a localStorage-backed map of
 * `${communityId}|${channelId}` → [{id, t}] mention entries, written by the
 * background scanner (concord-mention-scan.ts) and pruned automatically the
 * moment a channel's read mark advances past an entry's timestamp. Counts are
 * always served read-filtered AND mute-filtered.
 *
 * Replies-to-you need no special casing: Concord reply rumors p-tag the parent
 * author (buildReplyRumor), so a reply to me carries my pubkey in its p-tags —
 * exactly what rumorMentionsMe checks.
 *
 * Import-light on purpose (no nostr/relay deps) so the pure parts unit-test in
 * the node environment. All state is local-device; cross-device mention sync
 * (e.g. NIP-78) is a possible follow-up, deliberately out of scope here.
 */
import { useEffect, useState } from "react";
import { readChannelLastRead } from "./concord-channel-unread";
import { isMuted, MUTE_CHANGED_EVENT } from "./concord-mute";

const STORAGE_KEY = "ro_concord_mentions_v1";
/** Newest N mention entries kept per channel (display caps far below this). */
export const MENTION_CAP_PER_CHANNEL = 99;
/** Fired whenever the ledger changes (new mention recorded / entries pruned). */
export const MENTIONS_CHANGED_EVENT = "concord-mentions-changed";
// Canonical event names owned by concord-unread.ts / ConcordChat — mirrored as
// literals so this module stays free of that heavier import graph.
const UNREAD_CHANGED_EVENT = "concord-unread-changed";
const READ_EVENT = "concord-read";

export interface MentionEntry {
  /** Rumor id — the dedupe key. */
  id: string;
  /** Message time, ms since epoch (effectiveTime of the rumor). */
  t: number;
}

/** `${communityId}|${channelId}` → mention entries, ascending by t. */
export type MentionLedger = Record<string, MentionEntry[]>;

/** The ledger key for one channel. */
export function mentionKey(communityId: string, channelId: string): string {
  return `${communityId}|${channelId}`;
}

/** Split a ledger key back into [communityId, channelId]. */
export function splitMentionKey(key: string): [string, string] {
  const i = key.indexOf("|");
  return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

// ── Pure core ────────────────────────────────────────────────────────────────

/** Does this rumor mention me? Any p-tag = my pubkey, and I'm not the author
 *  (self-mentions never notify). Covers replies-to-me too — reply rumors
 *  p-tag the parent author. */
export function rumorMentionsMe(
  tags: string[][],
  myPubkey: string,
  authorPubkey: string,
): boolean {
  if (!myPubkey || authorPubkey === myPubkey) return false;
  return tags.some((t) => t[0] === "p" && t[1] === myPubkey);
}

/** Add one entry to a channel's list: dedupe by id, keep ascending by t, and
 *  cap at the NEWEST `cap` entries. Returns the same array when unchanged. */
export function addMentionEntry(
  list: MentionEntry[],
  entry: MentionEntry,
  cap: number = MENTION_CAP_PER_CHANNEL,
): MentionEntry[] {
  if (!entry.id || !entry.t) return list;
  if (list.some((e) => e.id === entry.id)) return list;
  const next = [...list, entry].sort((a, b) => a.t - b.t);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Drop every entry the read mark has caught up with (t <= lastRead). */
export function pruneMentionEntries(list: MentionEntry[], lastRead: number): MentionEntry[] {
  const kept = list.filter((e) => e.t > lastRead);
  return kept.length === list.length ? list : kept;
}

/**
 * Per-community mention totals from a per-channel count map.
 */
export function communityMentionTotals(
  countsByChannel: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, n] of countsByChannel) {
    if (!n) continue;
    const [cid] = splitMentionKey(key);
    out.set(cid, (out.get(cid) ?? 0) + n);
  }
  return out;
}

/**
 * The Concord contribution to the numeric Chats-tab badge. Calm rule: numbers
 * come from MENTIONS; plain activity only ever contributes presence. So a
 * community with mentions contributes its mention count, and a community with
 * mere unread activity contributes 1 (it is one conversation wanting a look —
 * the pre-existing behavior), never both.
 */
export function concordChatsBadgeCount(
  unreadCommunities: ReadonlySet<string>,
  countsByChannel: ReadonlyMap<string, number>,
): number {
  const perCommunity = communityMentionTotals(countsByChannel);
  let total = 0;
  const counted = new Set<string>();
  for (const [cid, n] of perCommunity) {
    total += n;
    counted.add(cid);
  }
  for (const cid of unreadCommunities) {
    if (!counted.has(cid)) total += 1;
  }
  return total;
}

/**
 * Which channel should tapping an unread group open? Mention-bearing channels
 * first (in the community's channel-list order), then plain-unread channels
 * (same order), else undefined (caller falls back to the default channel).
 */
export function pickFirstUnreadChannel(
  channelIds: readonly string[],
  unreadChannelIds: ReadonlySet<string>,
  mentionCountFor: (channelId: string) => number,
): string | undefined {
  for (const id of channelIds) {
    if (mentionCountFor(id) > 0) return id;
  }
  for (const id of channelIds) {
    if (unreadChannelIds.has(id)) return id;
  }
  return undefined;
}

// ── localStorage-backed ledger ───────────────────────────────────────────────

function loadLedger(): MentionLedger {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MentionLedger;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: MentionLedger = {};
    for (const [key, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      out[key] = list.filter((e) => e && typeof e.id === "string" && typeof e.t === "number");
    }
    return out;
  } catch {
    return {};
  }
}

function saveLedger(ledger: MentionLedger, opts?: { silent?: boolean }): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); } catch {}
  // silent: prune-persists happen INSIDE getMentionCounts, which listeners call
  // on the very events that trigger pruning — re-dispatching there would only
  // echo. New mentions always announce.
  if (opts?.silent) return;
  try { window.dispatchEvent(new Event(MENTIONS_CHANGED_EVENT)); } catch {}
}

/**
 * Record one mention. No-ops when the entry is already known or the channel's
 * read mark has already passed it (you saw it — it never becomes a badge).
 */
export function recordMention(
  communityId: string,
  channelId: string,
  rumorId: string,
  t: number,
): void {
  if (t <= readChannelLastRead(communityId, channelId)) return;
  const ledger = loadLedger();
  const key = mentionKey(communityId, channelId);
  const before = ledger[key] ?? [];
  const after = addMentionEntry(before, { id: rumorId, t });
  if (after === before) return;
  ledger[key] = after;
  saveLedger(ledger);
}

/**
 * Current mention counts per channel key, read-pruned (entries the read mark
 * caught up with vanish) and mute-filtered (muted channel or community ⇒ 0).
 * Persists any pruning back so the ledger can't grow stale entries.
 */
export function getMentionCounts(): Map<string, number> {
  const ledger = loadLedger();
  const out = new Map<string, number>();
  let changed = false;
  for (const [key, list] of Object.entries(ledger)) {
    const [cid, chid] = splitMentionKey(key);
    const pruned = pruneMentionEntries(list, readChannelLastRead(cid, chid));
    if (pruned !== list) {
      changed = true;
      if (pruned.length === 0) delete ledger[key];
      else ledger[key] = pruned;
    }
    if (pruned.length > 0 && !isMuted(cid, chid)) out.set(key, pruned.length);
  }
  if (changed) saveLedger(ledger, { silent: true });
  return out;
}

// ── Reactive view ────────────────────────────────────────────────────────────

/**
 * Reactive per-channel mention counts (read-pruned + mute-filtered), keyed
 * `${communityId}|${channelId}`. Refreshes when the ledger changes, a read
 * mark advances, mute flags flip, or new wraps move the activity clock.
 */
export function useConcordMentionCounts(): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    const update = () => setCounts(getMentionCounts());
    update();
    window.addEventListener(MENTIONS_CHANGED_EVENT, update);
    window.addEventListener(READ_EVENT, update);
    window.addEventListener(MUTE_CHANGED_EVENT, update);
    window.addEventListener(UNREAD_CHANGED_EVENT, update);
    return () => {
      window.removeEventListener(MENTIONS_CHANGED_EVENT, update);
      window.removeEventListener(READ_EVENT, update);
      window.removeEventListener(MUTE_CHANGED_EVENT, update);
      window.removeEventListener(UNREAD_CHANGED_EVENT, update);
    };
  }, []);
  return counts;
}
