/**
 * "Public Nostr" — whether this account sees the global public feed at all.
 *
 * Decision 4 of the IA plan: OFF for new accounts, PRESERVED for existing ones.
 * New installs get the clean story — Chats, the people you actually know, a
 * community you were invited to. Anyone already using this as a Nostr client
 * loses nothing. The reduction shouldn't tax the people who already showed up.
 *
 * THE DEFAULT IS THE WHOLE FEATURE. Every account that predates this flag has
 * no stored value, so **unset must mean ON**. Backwards, and the feed silently
 * vanishes for every existing user — the same shape as the kind-3 follow-list
 * wipe, where an absent state got read as an intentional one. So this reads
 * exactly like `isDiscoverV2`: only a literal "0" turns it off, everything else
 * (including corrupt or half-written values) fails OPEN.
 *
 * STORED PER ACCOUNT, never device-wide. Signing up for a second account in a
 * browser that already has one must not write over the first account's state:
 * that would strip an existing user's feed as a side effect of an unrelated
 * action. Keying by pubkey removes the clobber entirely.
 *
 * The local value is a cache. `PortableSettings` (lib/nip78-settings.ts) is
 * what carries the choice between devices; without that, signing in fresh
 * elsewhere reads "unset" and gets the feed — which is the safe direction to be
 * wrong in, but is still wrong, so the sync matters.
 */
import { useSyncExternalStore } from "react";

/** The one value that means off. Anything else is on. */
export const PUBLIC_NOSTR_OFF = "0";
const KEY_PREFIX = "ro_public_nostr:";
const CHANGED = "public-nostr-changed";

/**
 * Pure rule, so the grandfathering default is pinned by tests rather than by
 * whoever next edits the storage call.
 */
export function publicNostrEnabled(stored: string | null | undefined): boolean {
  return stored !== PUBLIC_NOSTR_OFF;
}

/**
 * Where one account's choice lives. Null for a signed-out session — there is no
 * account to have a preference yet, so nothing is stored.
 */
export function publicNostrStorageKey(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  return `${KEY_PREFIX}${pubkey}`;
}

export function isPublicNostrEnabled(pubkey: string | null | undefined): boolean {
  const key = publicNostrStorageKey(pubkey);
  if (!key) return true; // signed out: the marketing/preview surfaces stay public
  try {
    return publicNostrEnabled(localStorage.getItem(key));
  } catch {
    return true;
  }
}

export function setPublicNostr(pubkey: string, on: boolean): void {
  const key = publicNostrStorageKey(pubkey);
  if (!key) return;
  try {
    localStorage.setItem(key, on ? "1" : PUBLIC_NOSTR_OFF);
  } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

/**
 * Called once, at account CREATION only — never on sign-in. Sign-in must stay
 * silent: an existing account signing in on a new device has no stored value,
 * and writing the new-account default there would opt a long-time user out of
 * their own feed.
 */
export function markNewAccountPublicNostrOff(pubkey: string): void {
  setPublicNostr(pubkey, false);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read, so a Settings toggle takes effect without a reload. */
export function usePublicNostr(pubkey: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (isPublicNostrEnabled(pubkey) ? "1" : "0"),
    () => "1",
  ) === "1";
}
