/**
 * What Discover shows (owner, 2026-10-10; lib/network-mode.ts). Discover is
 * a bottom-bar tab and every tile on it is the wider network. While a new
 * account's wider network is off the tab is the DOOR: the news (our own
 * curated outlets, not Nostr) and one card that opens the switch. With the
 * wider network on, the tab is exactly what it was. Pure.
 */
export type DiscoverSurface =
  | "news" | "feed" | "communities" | "articles" | "live" | "podcasts" | "events" | "videos" | "images" | "marketplace" | "topics" | "people"
  | "door";

export const DISCOVER_SURFACES_OPEN: readonly DiscoverSurface[] = [
  "news", "feed", "communities", "articles", "live", "podcasts", "events", "videos", "images", "marketplace", "topics", "people",
];

export function discoverSurfaces(widerNetworkOn: boolean): DiscoverSurface[] {
  return widerNetworkOn ? [...DISCOVER_SURFACES_OPEN] : ["news", "door"];
}
