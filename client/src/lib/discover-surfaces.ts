/**
 * What Discover shows (owner, 2026-10-10 and 2026-10-13; lib/network-mode.ts).
 * Discover is a bottom-bar tab and, with the wider network on, every tile on
 * it is the wider network. While the wider network is off the tab is YOUR
 * SPACE: the news and podcasts (our own sources, not Nostr), your own
 * communities (never the public directory), invite a friend, a rail of shows
 * to play, and the door last — the exit, not the point of the page. Pure.
 */
export type DiscoverSurface =
  | "news" | "feed" | "communities" | "articles" | "live" | "podcasts" | "events" | "videos" | "images" | "marketplace" | "topics" | "people"
  | "invite" | "listen"
  | "door";

/** The tab with the wider network off: nothing here reads from strangers. */
export const DISCOVER_SURFACES_YOUR_SPACE: readonly DiscoverSurface[] = [
  "news", "podcasts", "communities", "invite", "listen", "door",
];

export const DISCOVER_SURFACES_OPEN: readonly DiscoverSurface[] = [
  "news", "feed", "communities", "articles", "live", "podcasts", "events", "videos", "images", "marketplace", "topics", "people",
];

export function discoverSurfaces(widerNetworkOn: boolean): DiscoverSurface[] {
  return widerNetworkOn ? [...DISCOVER_SURFACES_OPEN] : [...DISCOVER_SURFACES_YOUR_SPACE];
}
