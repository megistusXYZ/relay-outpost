/**
 * "The first posts are on screen" — said once, by the feed (pages/Home.tsx),
 * for anything that should wait until then rather than compete with the first
 * screen for a phone's connection (DeferredShell's overlays).
 */
const EVENT = "relay-outpost:first-posts-shown";
let shown = false;

export function markFirstPostsShown(): void {
  if (shown) return;
  shown = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Calls `cb` once the first posts are on screen (at once if they already are). Returns an unsubscribe. */
export function onFirstPostsShown(cb: () => void): () => void {
  if (shown) { cb(); return () => {}; }
  if (typeof window === "undefined") return () => {};
  const on = () => cb();
  window.addEventListener(EVENT, on, { once: true });
  return () => window.removeEventListener(EVENT, on);
}
