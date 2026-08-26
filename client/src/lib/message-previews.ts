/**
 * "Hide message previews" (Settings → Privacy, default OFF): when ON, the
 * merged Chats list shows a generic line instead of message text — for BOTH
 * 1:1 DMs and encrypted group chats (one toggle covers the whole list, like
 * a phone's lock-screen preview switch). Synced across devices via the NIP-78
 * portable-settings mapping (hideMessagePreviews in nip78-settings.ts).
 */
import { useEffect, useState } from "react";

export const HIDE_MESSAGE_PREVIEWS_LS_KEY = "relay-outpost-hide-message-previews";

export function getHideMessagePreviews(): boolean {
  try { return localStorage.getItem(HIDE_MESSAGE_PREVIEWS_LS_KEY) === "true"; } catch { return false; }
}

export function setHideMessagePreviews(value: boolean): void {
  // Written through localStorage.setItem so the NIP-78 watcher schedules a sync.
  try { localStorage.setItem(HIDE_MESSAGE_PREVIEWS_LS_KEY, String(value)); } catch {}
}

/** Reactive read — follows remote NIP-78 applies and cross-tab changes. */
export function useHideMessagePreviews(): boolean {
  const [hidden, setHidden] = useState(getHideMessagePreviews);
  useEffect(() => {
    const update = () => setHidden(getHideMessagePreviews());
    window.addEventListener("nip78-settings-applied", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("nip78-settings-applied", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return hidden;
}
