/**
 * Concord mute flags — the notification escape valve.
 *
 * Per-community and per-channel mutes, local to this device (localStorage, no
 * protocol events). Muted ⇒ excluded from EVERY attention surface: the
 * community dot on hub cards + nav, the merged Chats-list row's unread state,
 * per-channel dots in the channel switcher, and mention count badges. Mute
 * wins over everything — a mention in a muted channel produces no badge.
 *
 * Consumers re-read the predicates on MUTE_CHANGED_EVENT (or use the hooks).
 * Import-light on purpose (no nostr/relay deps) so pure callers stay testable.
 */
import { useEffect, useState } from "react";
import { READSTATE_CHANGED_EVENT } from "@/lib/dm-read";

const STORAGE_KEY = "ro_concord_mute_v1";
/** Fired on every mute/unmute so dots, badges and counts can recompute. */
export const MUTE_CHANGED_EVENT = "concord-mute-changed";

interface MuteState {
  /** Muted community ids. */
  communities: string[];
  /** Muted channels as `${communityId}|${channelId}`. */
  channels: string[];
  /**
   * When each flag last changed (ms), by entry key (`c:<communityId>`,
   * `ch:<communityId>|<channelId>`), so the latest change wins when your
   * devices sync (read-state-sync). Mutes from before this have none: 0.
   */
  at: Record<string, number>;
}

const COMMUNITY = "c:";
const CHANNEL = "ch:";

function loadState(): MuteState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { communities: [], channels: [], at: {} };
    const parsed = JSON.parse(raw) as Partial<MuteState>;
    const at: Record<string, number> = {};
    if (parsed.at && typeof parsed.at === "object") {
      for (const [k, v] of Object.entries(parsed.at)) if (typeof v === "number") at[k] = v;
    }
    return {
      communities: Array.isArray(parsed.communities) ? parsed.communities.filter((v) => typeof v === "string") : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels.filter((v) => typeof v === "string") : [],
      at,
    };
  } catch {
    return { communities: [], channels: [], at: {} };
  }
}

/** `local`: a change made here, which your other devices should hear about. */
function saveState(state: MuteState, opts?: { local?: boolean }): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  try { window.dispatchEvent(new Event(MUTE_CHANGED_EVENT)); } catch {}
  if (opts?.local) { try { window.dispatchEvent(new Event(READSTATE_CHANGED_EVENT)); } catch {} }
}

/** Each flag's latest state and when it changed: mutes, and unmutes that were ever made. */
export type MuteEntries = Record<string, { muted: boolean; at: number }>;

/** This device's mutes as sync entries (read-state-sync publishes them). */
export function muteEntries(): MuteEntries {
  const s = loadState();
  const out: MuteEntries = {};
  for (const c of s.communities) out[COMMUNITY + c] = { muted: true, at: s.at[COMMUNITY + c] ?? 0 };
  for (const ch of s.channels) out[CHANNEL + ch] = { muted: true, at: s.at[CHANNEL + ch] ?? 0 };
  for (const [key, at] of Object.entries(s.at)) if (!out[key]) out[key] = { muted: false, at };
  return out;
}

/**
 * Take another device's mute changes where they're newer than this device's.
 * Saved without asking to publish again (the change came from there). Returns
 * whether anything changed.
 */
export function applyMuteEntries(remote: MuteEntries | null | undefined): boolean {
  const s = loadState();
  const communities = new Set(s.communities);
  const channels = new Set(s.channels);
  const at = { ...s.at };
  let changed = false;
  for (const [key, entry] of Object.entries(remote ?? {})) {
    if (!entry || typeof entry.at !== "number" || typeof entry.muted !== "boolean") continue;
    const isCommunity = key.startsWith(COMMUNITY);
    if (!isCommunity && !key.startsWith(CHANNEL)) continue;
    const id = key.slice(isCommunity ? COMMUNITY.length : CHANNEL.length);
    if (!id) continue;
    const set = isCommunity ? communities : channels;
    // A mute kept from before times were recorded counts as 0; no flag at all, as never.
    const mine = at[key] ?? (set.has(id) ? 0 : -1);
    if (entry.at <= mine) continue;
    if (entry.muted) set.add(id); else set.delete(id);
    at[key] = entry.at;
    changed = true;
  }
  if (changed) saveState({ communities: [...communities], channels: [...channels], at });
  return changed;
}

/** The `${communityId}|${channelId}` key channel mutes are stored under. */
export function channelMuteKey(communityId: string, channelId: string): string {
  return `${communityId}|${channelId}`;
}

/** Is the whole community muted? */
export function isCommunityMuted(communityId: string): boolean {
  return loadState().communities.includes(communityId);
}

/** Is this specific channel muted (its own flag only — not the community's)? */
export function isChannelMuted(communityId: string, channelId: string): boolean {
  return loadState().channels.includes(channelMuteKey(communityId, channelId));
}

/**
 * Effective mute for a channel: its community's mute OR its own flag.
 * This is the predicate every dot/badge/count surface must consult.
 */
export function isMuted(communityId: string, channelId: string): boolean {
  const s = loadState();
  return s.communities.includes(communityId) || s.channels.includes(channelMuteKey(communityId, channelId));
}

export function setCommunityMuted(communityId: string, muted: boolean): void {
  const s = loadState();
  const has = s.communities.includes(communityId);
  if (muted === has) return;
  saveState({
    ...s,
    communities: muted ? [...s.communities, communityId] : s.communities.filter((c) => c !== communityId),
    at: { ...s.at, [COMMUNITY + communityId]: Date.now() },
  }, { local: true });
}

export function setChannelMuted(communityId: string, channelId: string, muted: boolean): void {
  const s = loadState();
  const key = channelMuteKey(communityId, channelId);
  const has = s.channels.includes(key);
  if (muted === has) return;
  saveState({
    ...s,
    channels: muted ? [...s.channels, key] : s.channels.filter((c) => c !== key),
    at: { ...s.at, [CHANNEL + key]: Date.now() },
  }, { local: true });
}

// ── Reactive views ───────────────────────────────────────────────────────────

/** Reactive community-level mute flag. */
export function useCommunityMuted(communityId: string): boolean {
  const [muted, setMuted] = useState(() => isCommunityMuted(communityId));
  useEffect(() => {
    const update = () => setMuted(isCommunityMuted(communityId));
    update();
    window.addEventListener(MUTE_CHANGED_EVENT, update);
    return () => window.removeEventListener(MUTE_CHANGED_EVENT, update);
  }, [communityId]);
  return muted;
}

/** Reactive set of a community's muted channel ids (channel-level flags only). */
export function useMutedChannels(communityId: string): Set<string> {
  const read = () => {
    const prefix = `${communityId}|`;
    return new Set(
      loadState().channels
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    );
  };
  const [muted, setMuted] = useState<Set<string>>(read);
  useEffect(() => {
    const update = () => setMuted(read());
    update();
    window.addEventListener(MUTE_CHANGED_EVENT, update);
    return () => window.removeEventListener(MUTE_CHANGED_EVENT, update);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read is stable per communityId
  }, [communityId]);
  return muted;
}
