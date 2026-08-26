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

const STORAGE_KEY = "ro_concord_mute_v1";
/** Fired on every mute/unmute so dots, badges and counts can recompute. */
export const MUTE_CHANGED_EVENT = "concord-mute-changed";

interface MuteState {
  /** Muted community ids. */
  communities: string[];
  /** Muted channels as `${communityId}|${channelId}`. */
  channels: string[];
}

function loadState(): MuteState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { communities: [], channels: [] };
    const parsed = JSON.parse(raw) as Partial<MuteState>;
    return {
      communities: Array.isArray(parsed.communities) ? parsed.communities.filter((v) => typeof v === "string") : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels.filter((v) => typeof v === "string") : [],
    };
  } catch {
    return { communities: [], channels: [] };
  }
}

function saveState(state: MuteState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  try { window.dispatchEvent(new Event(MUTE_CHANGED_EVENT)); } catch {}
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
  });
}

export function setChannelMuted(communityId: string, channelId: string, muted: boolean): void {
  const s = loadState();
  const key = channelMuteKey(communityId, channelId);
  const has = s.channels.includes(key);
  if (muted === has) return;
  saveState({
    ...s,
    channels: muted ? [...s.channels, key] : s.channels.filter((c) => c !== key),
  });
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
