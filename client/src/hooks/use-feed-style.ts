import { useSyncExternalStore } from "react";

/**
 * Feed presentation style. "clean" is the default X/Primal look (flush,
 * borderless, dense, consistent width); "bubbles" is the opt-in SMS-style
 * frosted `.glass-inner` bubble (includes short-message shrink-to-fit).
 */
export type FeedStyle = "clean" | "bubbles";

const STORAGE_KEY = "relay-outpost-feed-style";
const CHANGE_EVENT = "feed-style-changed";

export function readFeedStyle(): FeedStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === "bubbles" ? "bubbles" : "clean";
  } catch {
    return "clean";
  }
}

/** Persist the choice and notify every mounted post to re-render live. */
export function setFeedStyle(style: FeedStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // cross-tab
  // NIP-78 remote-settings apply writes the localStorage key directly
  // (without dispatching CHANGE_EVENT), then fires this generic event.
  window.addEventListener("nip78-settings-applied", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("nip78-settings-applied", onChange);
  };
}

/** Read the current feed style, re-rendering on change (same tab or cross-tab). */
export function useFeedStyle(): FeedStyle {
  return useSyncExternalStore(subscribe, readFeedStyle, () => "clean");
}
