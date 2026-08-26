import { useSyncExternalStore } from "react";

/**
 * Whether a reply shows the post it is answering, inline, in the feed.
 *
 * DEFAULT ON. A reply with its context collapsed is a fragment: "Very good
 * points" tells a reader nothing, and asking them to press "Show context"
 * charges a tap for the sentence to mean anything. Conversation is the thing
 * this app is for, so the conversation is what gets shown.
 *
 * Only a literal "0" turns it off — unset and anything corrupt read as ON, the
 * same fail-open rule as the other presentation defaults here. An absent value
 * is someone who never chose, and the default is what we'd choose for them.
 */
const STORAGE_KEY = "relay-outpost-reply-context";
const CHANGE_EVENT = "reply-context-changed";
const OFF = "0";

export function readReplyContext(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== OFF;
  } catch {
    return true;
  }
}

/** Persist the choice and notify every mounted post to re-render live. */
export function setReplyContext(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : OFF);
  } catch {}
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // cross-tab
  window.addEventListener("nip78-settings-applied", onChange); // remote-settings apply
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("nip78-settings-applied", onChange);
  };
}

/** Read the preference, re-rendering on change (same tab or cross-tab). */
export function useReplyContext(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (readReplyContext() ? "1" : "0"),
    () => "1",
  ) === "1";
}
