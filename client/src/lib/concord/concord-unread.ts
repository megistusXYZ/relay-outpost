/**
 * Metadata-only unread signal for encrypted outposts: one shared subscription
 * over every joined community's channel-plane pubkeys (outer 1059s — never
 * decrypted), compared against the per-channel last-read marks ConcordChat
 * already persists (ro_concord_read_<community>_<channel>, ms). Any wrap newer
 * than the mark ⇒ that outpost shows an unread dot on the hub + nav.
 *
 * Module singleton so hub cards, the bottom nav, and the outpost page can all
 * consume it without double-subscribing; consumers use useConcordUnread().
 */
import { useEffect, useState } from "react";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { getCommunities } from "./concord-keys";
import { channelPlaneKey } from "./concord-stream";
import { registerPlaneAuth } from "./concord-plane-auth";
import { isConcordEnabled } from "./concord-prefs";
import { seedGroupActivity } from "./concord-activity";
import { readChannelLastRead } from "./concord-channel-unread";
import { isMuted, MUTE_CHANGED_EVENT } from "./concord-mute";

const KIND_STREAM_WRAP = 1059;
/** Fired whenever the wrap clock / unread set moves — also consumed by the per-channel dots in ConcordChat. */
export const CHANGED_EVENT = "concord-unread-changed";
/** ConcordChat dispatches this (detail: communityId) whenever it persists a read mark. */
export const READ_EVENT = "concord-read";

let watcherOwner: string | null = null;
let planeIndex = new Map<string, { communityId: string; channelKey: string }>();
let sub: { close: () => void } | null = null;
const unread = new Set<string>();
const latestByChannel = new Map<string, number>(); // channelKey → newest wrap t (ms)
const lastActivity = new Map<string, number>(); // communityId → newest activity (ms)

const lastRead = readChannelLastRead;

/**
 * Metadata wrap clock for one community: channelId → newest outer-wrap time
 * (ms) seen by the watcher. Lets the per-channel dots notice activity in
 * channels whose messages were never decrypted (only the active channel's
 * stream decrypts) — still zero decrypt work.
 */
export function getChannelWrapTimes(communityId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [chKey, t] of latestByChannel) {
    const [, cid, chid] = chKey.split("|"); // channelKey = pk|community|channel
    if (cid !== communityId) continue;
    if (t > (out.get(chid) ?? 0)) out.set(chid, t);
  }
  return out;
}

// ── Per-community last-activity clock (drives the merged chat list's recency
// sort). Fed by the same metadata-only wrap stream as the unread dot, floored
// by read marks + addedAt on watcher start (seedGroupActivity), and persisted
// so a reload doesn't reset quiet groups to 0.
function readPersistedActivity(communityId: string): number {
  try { return Number(localStorage.getItem(`ro_concord_activity_${communityId}`)) || 0; } catch { return 0; }
}

/** Raise (never lower) a community's activity clock. Returns true when it moved. */
function bumpActivity(communityId: string, t: number): boolean {
  if (!t || t <= (lastActivity.get(communityId) ?? 0)) return false;
  lastActivity.set(communityId, t);
  try { localStorage.setItem(`ro_concord_activity_${communityId}`, String(t)); } catch {}
  return true;
}

/** Newest known activity (ms) for a community — 0 when unknown. */
export function getConcordLastActivity(communityId: string): number {
  return lastActivity.get(communityId) ?? readPersistedActivity(communityId);
}

/** READ path: a just-read chat is at least as recent as its newest read mark. */
function noteRead(communityId: string) {
  let latest = 0;
  for (const { communityId: cid, channelKey } of planeIndex.values()) {
    if (cid !== communityId) continue;
    const [, , chid] = channelKey.split("|"); // channelKey = pk|community|channel
    latest = Math.max(latest, lastRead(cid, chid));
  }
  if (bumpActivity(communityId, latest)) emit();
}

function emit() { window.dispatchEvent(new Event(CHANGED_EVENT)); }

/** Recompute one community's dot from the latest seen wraps vs read marks.
 *  Muted channels (and whole muted communities, via isMuted's OR) never light
 *  the dot — mute wins over everything. */
function recompute(communityId: string) {
  let has = false;
  for (const [chKey, t] of latestByChannel) {
    const [, cid, chid] = chKey.split("|"); // channelKey = pk|community|channel
    if (cid !== communityId) continue;
    if (isMuted(cid, chid)) continue;
    if (t > lastRead(cid, chid)) { has = true; break; }
  }
  const before = unread.has(communityId);
  if (has) unread.add(communityId); else unread.delete(communityId);
  if (before !== has) emit();
}

// Mute toggles change what counts as unread without any new wraps arriving —
// recompute every known community when the flags move. Registered once.
let muteListenerArmed = false;
function armMuteListener() {
  if (muteListenerArmed || typeof window === "undefined") return;
  muteListenerArmed = true;
  window.addEventListener(MUTE_CHANGED_EVENT, () => {
    const cids = new Set<string>();
    for (const { communityId } of planeIndex.values()) cids.add(communityId);
    for (const cid of cids) recompute(cid);
    emit();
  });
}

/**
 * Start (or refresh) the watcher for `pubkey`. Safe to call from several
 * mounts — it only resubscribes when the community/channel set changed.
 */
export async function ensureConcordUnreadWatcher(pubkey: string | null | undefined): Promise<void> {
  if (!pubkey || !isConcordEnabled()) return;
  armMuteListener();
  const communities = await getCommunities(pubkey).catch(() => []);
  const nextIndex = new Map<string, { communityId: string; channelKey: string }>();
  for (const c of communities) {
    const planes = [];
    for (const ch of c.channels) {
      try {
        const plane = channelPlaneKey(c, ch);
        nextIndex.set(plane.pk, { communityId: c.community_id, channelKey: `${plane.pk}|${c.community_id}|${ch.id}` });
        planes.push(plane);
      } catch {}
    }
    // Armada-flavored relays NIP-42-gate wrap reads by their filter authors —
    // the metadata-only unread REQ must authenticate AS the channel planes too.
    registerPlaneAuth(c.relays, planes);
  }
  // Seed the activity clocks BEFORE the resubscribe short-circuit so every
  // known community has a floor even when the subscription is already live.
  let activityMoved = false;
  for (const c of communities) {
    const marks = c.channels.map((ch) => lastRead(c.community_id, ch.id));
    const seeded = seedGroupActivity(readPersistedActivity(c.community_id), marks, c.addedAt);
    if (bumpActivity(c.community_id, seeded)) activityMoved = true;
  }
  if (activityMoved) emit();

  const same = watcherOwner === pubkey && nextIndex.size === planeIndex.size &&
    [...nextIndex.keys()].every((k) => planeIndex.has(k));
  if (same) return;

  sub?.close(); sub = null;
  watcherOwner = pubkey;
  planeIndex = nextIndex;
  latestByChannel.clear();
  const authors = [...planeIndex.keys()];
  if (authors.length === 0) { if (unread.size) { unread.clear(); emit(); } return; }

  // since: the oldest read mark (seconds) so relays don't replay deep history.
  let minRead = Infinity;
  for (const { channelKey } of planeIndex.values()) {
    const [, cid, chid] = channelKey.split("|");
    minRead = Math.min(minRead, lastRead(cid, chid));
  }
  const relays = [...new Set(communities.flatMap((c) => c.relays))];
  const since = minRead > 0 && Number.isFinite(minRead) ? Math.floor(minRead / 1000) : Math.floor(Date.now() / 1000) - 24 * 3600;

  sub = persistentPoolSubscribe(relays, { kinds: [KIND_STREAM_WRAP], authors, since }, {
    onevent: (e: { pubkey: string; created_at: number }) => {
      const entry = planeIndex.get(e.pubkey);
      if (!entry) return;
      const t = e.created_at * 1000;
      const prev = latestByChannel.get(entry.channelKey) ?? 0;
      if (t > prev) latestByChannel.set(entry.channelKey, t);
      if (bumpActivity(entry.communityId, t)) emit();
      recompute(entry.communityId);
    },
  });
}

/** Reactive view of the unread outposts. */
export function useConcordUnread(): Set<string> {
  const [snapshot, setSnapshot] = useState<Set<string>>(() => new Set(unread));
  useEffect(() => {
    const update = () => setSnapshot(new Set(unread));
    const onRead = (ev: globalThis.Event) => {
      const cid = (ev as CustomEvent<string>).detail;
      if (cid) { recompute(cid); noteRead(cid); }
      update();
    };
    window.addEventListener(CHANGED_EVENT, update);
    window.addEventListener(READ_EVENT, onRead);
    return () => {
      window.removeEventListener(CHANGED_EVENT, update);
      window.removeEventListener(READ_EVENT, onRead);
    };
  }, []);
  return snapshot;
}

/** Reactive view of the per-community activity clocks (ms since epoch). */
export function useConcordActivity(): Map<string, number> {
  const [snapshot, setSnapshot] = useState<Map<string, number>>(() => new Map(lastActivity));
  useEffect(() => {
    const update = () => setSnapshot(new Map(lastActivity));
    const onRead = (ev: globalThis.Event) => {
      const cid = (ev as CustomEvent<string>).detail;
      if (cid) noteRead(cid); // idempotent — bumpActivity only ever raises
      update();
    };
    window.addEventListener(CHANGED_EVENT, update);
    window.addEventListener(READ_EVENT, onRead);
    return () => {
      window.removeEventListener(CHANGED_EVENT, update);
      window.removeEventListener(READ_EVENT, onRead);
    };
  }, []);
  return snapshot;
}
