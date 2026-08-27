import { getOutpostRelays, joinOutpostWithEnrichment } from "@/lib/outpost-relays";

const PINNED_FEEDS_KEY = "nostr_pinned_feeds";
const EVENT_NAME = "pinned-feeds-changed";

export type PinnableTab = "feed" | "topics" | "channels" | "horizon";

// URL slug <-> internal tab key for outpost-detail tabs. Internal keys stay stable
// (saved pins + old shared links use them); the URL shows a friendly slug. slugToTabKey
// also accepts the legacy raw keys so old links/pins keep resolving (back-compat).
const TAB_KEY_TO_SLUG: Record<string, string> = { feed: "posts", topics: "discussions", channels: "chat", horizon: "articles", about: "about" };
const SLUG_TO_TAB_KEY: Record<string, string> = { posts: "feed", discussions: "topics", chat: "channels", articles: "horizon", about: "about" };
export function tabKeyToSlug(key: string): string { return TAB_KEY_TO_SLUG[key] ?? key; }
export function slugToTabKey(slug: string): string { return SLUG_TO_TAB_KEY[slug] ?? slug; }

export interface PinnedFeed {
  id: string;
  relayUrl: string;
  tab: PinnableTab;
  channelId?: string;
  label: string;
  channelLabel?: string;
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function makeId(relayUrl: string, tab: PinnableTab, channelId?: string): string {
  const base = `${normalizeUrl(relayUrl)}::${tab}`;
  return channelId ? `${base}::${channelId}` : base;
}

function dispatch(): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getPinnedFeeds(): PinnedFeed[] {
  try {
    const stored = localStorage.getItem(PINNED_FEEDS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function savePinnedFeeds(feeds: PinnedFeed[]): void {
  localStorage.setItem(PINNED_FEEDS_KEY, JSON.stringify(feeds));
  dispatch();
}

export function pinFeed(feed: Omit<PinnedFeed, "id">): void {
  const feeds = getPinnedFeeds();
  const id = makeId(feed.relayUrl, feed.tab, feed.channelId);
  if (feeds.some((f) => f.id === id)) return;
  feeds.push({ ...feed, id });
  savePinnedFeeds(feeds);
  // Auto-promote: pinning a feed should make the underlying relay show up
  // as one of the user's communities. The enrichment helper is a no-op if the
  // relay is already joined. Don't pass the pin's label as the relay name —
  // it's now a bare view name ("Waves"); let enrichment derive the relay
  // label from the host + NIP-11.
  void joinOutpostWithEnrichment(feed.relayUrl);
}

export function unpinFeed(id: string): void {
  const feeds = getPinnedFeeds();
  const filtered = feeds.filter((f) => f.id !== id);
  if (filtered.length !== feeds.length) {
    savePinnedFeeds(filtered);
  }
}

export function isPinned(relayUrl: string, tab: PinnableTab, channelId?: string): boolean {
  const id = makeId(relayUrl, tab, channelId);
  return getPinnedFeeds().some((f) => f.id === id);
}

export function togglePin(
  relayUrl: string,
  tab: PinnableTab,
  label: string,
  channelId?: string,
  channelLabel?: string,
): boolean {
  const id = makeId(relayUrl, tab, channelId);
  if (isPinned(relayUrl, tab, channelId)) {
    unpinFeed(id);
    return false;
  }
  pinFeed({ relayUrl, tab, label, channelId, channelLabel });
  return true;
}

export function renamePinnedFeed(id: string, newLabel: string): void {
  const feeds = getPinnedFeeds();
  const feed = feeds.find((f) => f.id === id);
  if (!feed) return;
  feed.label = newLabel.trim() || feed.label;
  savePinnedFeeds(feeds);
}

export function reorderPinnedFeeds(ids: string[]): void {
  const feeds = getPinnedFeeds();
  const byId = new Map(feeds.map((f) => [f.id, f]));
  const reordered: PinnedFeed[] = [];
  for (const id of ids) {
    const feed = byId.get(id);
    if (feed) {
      reordered.push(feed);
      byId.delete(id);
    }
  }
  for (const feed of byId.values()) reordered.push(feed);
  savePinnedFeeds(reordered);
}

/** Deep-link to a pinned view (the same URL the sidebar + in-page dropdown use). */
export function pinUrl(pin: PinnedFeed): string {
  const params = new URLSearchParams();
  if (pin.tab !== "feed") params.set("tab", pin.tab);
  if (pin.channelId) params.set("channel", pin.channelId);
  const qs = params.toString();
  return `/outposts/${encodeURIComponent(pin.relayUrl)}${qs ? `?${qs}` : ""}`;
}

/** Group pins by their parent relay, keyed by normalized url. */
export function groupPinsByRelay(pins: PinnedFeed[]): Map<string, PinnedFeed[]> {
  const m = new Map<string, PinnedFeed[]>();
  for (const p of pins) {
    const k = normalizeUrl(p.relayUrl);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(p);
  }
  return m;
}

export function cleanupPinnedFeeds(): void {
  const feeds = getPinnedFeeds();
  const joined = new Set(getOutpostRelays().map((r) => normalizeUrl(r.url)));
  const cleaned = feeds.filter((f) => joined.has(normalizeUrl(f.relayUrl)));
  if (cleaned.length !== feeds.length) {
    savePinnedFeeds(cleaned);
  }
}
