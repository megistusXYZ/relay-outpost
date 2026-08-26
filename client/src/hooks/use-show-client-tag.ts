import { useEffect, useState } from "react";

// DISPLAY setting: whether to show a subtle "via [App]" NIP-89 client badge on
// focused / thread posts. DEFAULT OFF. Synced across devices through the NIP-78
// settings map (see nip78-settings.ts — key `showClientTag`).
//
// This is a distinct concern from `relay-outpost-client-tag-enabled`
// (clientTagEnabled), which is the PRIVACY stamp on our OWN outgoing posts.
export const SHOW_CLIENT_TAG_KEY = "relay-outpost-show-client-tag";

const CHANGE_EVENT = "show-client-tag-changed";

export function getShowClientTag(): boolean {
  try {
    return localStorage.getItem(SHOW_CLIENT_TAG_KEY) === "true";
  } catch {
    return false;
  }
}

export function setShowClientTag(value: boolean): void {
  try {
    // Off is the default — mirror the NIP-78 convention of not persisting a
    // default-valued boolean so it stays clean in the synced settings blob.
    if (value) localStorage.setItem(SHOW_CLIENT_TAG_KEY, "true");
    else localStorage.removeItem(SHOW_CLIENT_TAG_KEY);
  } catch {}
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

/** Reactive read of the display setting — flips live when toggled or synced. */
export function useShowClientTag(): boolean {
  const [on, setOn] = useState<boolean>(getShowClientTag);

  useEffect(() => {
    const update = () => setOn(getShowClientTag());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    window.addEventListener("nip78-settings-applied", update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
      window.removeEventListener("nip78-settings-applied", update);
    };
  }, []);

  return on;
}
