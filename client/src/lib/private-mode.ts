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

function emit(): void {
  listeners.forEach((l) => l());
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

// ── Sign-in ─────────────────────────────────────────────────────────────────
// Owner, 2026-10-06: signing in (a pasted nsec in a new browser, or just
// signing in again) showed every chat with private mode on. The mask was
// decided once, at page load, from what this device had stored — a session
// that had tapped "Show chats" kept showing them, and a device that had never
// received this account's settings showed them until the synced settings
// arrived (2 s later at best, never if the relays didn't answer).
let pending = false;

/**
 * An account just signed in. `settingsKnown`: this device already holds this
 * account's settings (it has synced them before). Known → the shield follows
 * the setting, re-arming it even after an earlier "Show chats". Unknown →
 * Chats stays shielded until privateModeSettingsSettled(): whether private
 * mode is on can't be known yet, and showing the list to find out is the leak.
 */
export function privateModeOnSignIn(settingsKnown: boolean): void {
  pending = !settingsKnown;
  applyMasked(settingsKnown ? nextMaskedState("open", masked, getPrivateModeSetting()) : true);
  emit();
}

/**
 * This account's settings are here (or the relays answered that it has
 * none). A list still waiting under the shield now follows the setting; one
 * revealed by hand while waiting stays revealed. Never called when nobody
 * answered — then the shield stays, with its Show chats button (owner's call).
 */
export function privateModeSettingsSettled(): void {
  if (!pending) return;
  pending = false;
  if (masked) applyMasked(getPrivateModeSetting());
  emit();
}

/** Shielded only because this account's settings haven't arrived yet. */
export function isPrivateModePending(): boolean {
  return pending;
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

/**
 * The chat-filter chips as a masked list may show them: their names and no
 * number at all, so nothing says how many people, groups or communities there
 * are, or where something is waiting. Unmasked, the chips come back untouched.
 */
export function maskChips<C extends { count: number; unread: number }>(
  chips: C[],
  masked: boolean,
): Array<Omit<C, "count"> & { count: number | null }> {
  return masked ? chips.map((c) => ({ ...c, count: null, unread: 0 })) : chips;
}

/** Reactive read: shielded only while this account's settings are on their way. */
export function usePrivateModePending(): boolean {
  return useSyncExternalStore(subscribe, isPrivateModePending, () => false);
}

/** Reactive read of the session mask state. */
export function usePrivateMasked(): boolean {
  return useSyncExternalStore(subscribe, isPrivateMasked, () => false);
}
