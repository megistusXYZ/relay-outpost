/**
 * Private mode — the chat list's screen-share shield.
 *
 * Two controls, one feature: the STANDING SETTING (Settings → Privacy, synced
 * across devices via NIP-78) makes Chats OPEN masked and re-arm whenever the
 * app goes to background; the EYE in the chat-list header masks/reveals right
 * now, with or without the setting ("the eye hides your chats now; the setting
 * makes them start hidden").
 *
 * What masked means is decided in the list (People + Group rows blur their
 * name/avatar/preview; Communities stay legible — public places, private
 * people), but WHEN it is masked is decided here, in one module, so the eye,
 * the pill, the row taps and the re-arm listener can never disagree.
 *
 * THREAT MODEL, stated so nobody oversells it: this is a shield against
 * shoulder-surfing and screen-sharing — the blurred text is still in the DOM.
 * It is not encryption (the DMs underneath are already encrypted) and it is
 * not a lock.
 */
import { useSyncExternalStore } from "react";

export const PRIVATE_MODE_LS_KEY = "relay-outpost-private-mode";

/** The standing setting: should Chats START masked (and re-arm on background)? */
export function getPrivateModeSetting(): boolean {
  try { return localStorage.getItem(PRIVATE_MODE_LS_KEY) === "true"; } catch { return false; }
}

export function setPrivateModeSetting(value: boolean): void {
  // Written through localStorage.setItem so the NIP-78 watcher schedules a sync.
  try { localStorage.setItem(PRIVATE_MODE_LS_KEY, String(value)); } catch {}
  // Arming the setting masks immediately — the person just asked for privacy;
  // making them ALSO background the app first to see the effect reads broken.
  // Disarming reveals: a shield you turned off should not need a second tap.
  applyMasked(value);
}

/**
 * The pure re-arm rule, separated so it is testable without a DOM:
 * given what just happened and the standing setting, should the list be masked?
 *
 *  - "open":   a fresh session (page load) — masked iff the setting says so.
 *  - "hidden": the app/tab went to background — RE-ARM iff the setting is on.
 *              Without the setting, an ad-hoc eye-mask simply keeps its state;
 *              an ad-hoc reveal is not undone by a stray tab switch.
 *  - "toggle": the eye (or pill/row tap) — flips the current state.
 */
export function nextMaskedState(
  event: "open" | "hidden" | "toggle",
  current: boolean,
  settingOn: boolean,
): boolean {
  switch (event) {
    case "open": return settingOn;
    case "hidden": return settingOn ? true : current;
    case "toggle": return !current;
  }
}

// ── Session state (module-level store, deliberately NOT localStorage: the
// masked/revealed decision is per-session by design — persistence is exactly
// what the standing setting is for) ─────────────────────────────────────────
let masked = getPrivateModeSetting();
const listeners = new Set<() => void>();

function applyMasked(value: boolean): void {
  if (masked === value) return;
  masked = value;
  listeners.forEach((l) => l());
  // The desktop Messages page listens for this to close an open thread when
  // the mask arms — a shielded list beside an open conversation shields
  // nothing. A window event rather than a prop because the thread pane and
  // the list are siblings, not parent/child.
  if (value) {
    try { window.dispatchEvent(new CustomEvent("private-mode-masked")); } catch {}
  }
}

export function isPrivateMasked(): boolean {
  return masked;
}

/**
 * Re-arm after the NIP-78 settings sync writes the key from another device.
 * The sync bypasses setPrivateModeSetting (it writes localStorage raw), so
 * without this the in-memory mask stays stale until the next reload or
 * backgrounding. Deliberately one-directional: a remote ON masks now (the
 * person asked for privacy somewhere — honor it everywhere); a remote OFF
 * never force-reveals a list someone masked by hand on THIS device.
 */
export function armPrivateModeIfSet(): void {
  if (getPrivateModeSetting()) applyMasked(true);
}

export function togglePrivateMasked(): void {
  applyMasked(nextMaskedState("toggle", masked, getPrivateModeSetting()));
}

export function revealPrivateMasked(): void {
  applyMasked(false);
}

// One re-arm listener for the whole app, armed on first import from the list.
let rearmInstalled = false;
export function ensurePrivateModeRearm(): void {
  if (rearmInstalled || typeof document === "undefined") return;
  rearmInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      applyMasked(nextMaskedState("hidden", masked, getPrivateModeSetting()));
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read of the session mask state. */
export function usePrivateMasked(): boolean {
  return useSyncExternalStore(subscribe, isPrivateMasked, () => false);
}
