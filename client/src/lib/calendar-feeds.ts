import type { FeedCatalogEntry } from "./calendar-feeds-catalog";

export interface FeedEvent {
  uid: string;
  summary: string;
  dtstart: Date;
  dtend?: Date;
  description?: string;
  location?: string;
}

export interface SubscribedFeed {
  id: string;
  name: string;
  emoji: string;
  url: string;
  isCatalog: boolean;
}

interface CachedFeedData {
  events: FeedEvent[];
  fetchedAt: number;
}

const SUBSCRIPTIONS_PREFIX = "relay-outpost-feed-subscriptions";
const FEED_CACHE_PREFIX = "relay-outpost-feed-cache";
const FEED_REMINDERS_PREFIX = "relay-outpost-feed-reminders";
const CACHE_TTL = 24 * 60 * 60 * 1000;

export type FeedReminderInterval = "10min" | "30min" | "1hr";

export const FEED_REMINDER_OPTIONS: { value: FeedReminderInterval; label: string; minutes: number }[] = [
  { value: "10min", label: "10 min", minutes: 10 },
  { value: "30min", label: "30 min", minutes: 30 },
  { value: "1hr", label: "1 hour", minutes: 60 },
];

function subscriptionsKey(pubkey: string): string {
  return `${SUBSCRIPTIONS_PREFIX}:${pubkey}`;
}

function feedCacheKey(pubkey: string, feedId: string): string {
  return `${FEED_CACHE_PREFIX}:${pubkey}:${feedId}`;
}

function feedRemindersKey(pubkey: string): string {
  return `${FEED_REMINDERS_PREFIX}:${pubkey}`;
}

export function getFeedReminderSettings(pubkey: string): FeedReminderInterval[] {
  try {
    const raw = localStorage.getItem(feedRemindersKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFeedReminderSettings(pubkey: string, intervals: FeedReminderInterval[]): void {
  localStorage.setItem(feedRemindersKey(pubkey), JSON.stringify(intervals));
}

const FEED_REMINDER_FEEDS_PREFIX = "relay-outpost-feed-reminder-feeds";

function feedReminderFeedsKey(pubkey: string): string {
  return `${FEED_REMINDER_FEEDS_PREFIX}:${pubkey}`;
}

export function getFeedReminderEnabledFeeds(pubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(feedReminderFeedsKey(pubkey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveFeedReminderEnabledFeeds(pubkey: string, feedIds: Set<string>): void {
  localStorage.setItem(feedReminderFeedsKey(pubkey), JSON.stringify([...feedIds]));
}

export function toggleFeedReminderForFeed(pubkey: string, feedId: string): boolean {
  const enabled = getFeedReminderEnabledFeeds(pubkey);
  if (enabled.has(feedId)) {
    enabled.delete(feedId);
  } else {
    enabled.add(feedId);
  }
  saveFeedReminderEnabledFeeds(pubkey, enabled);
  return enabled.has(feedId);
}

const SCHEDULED_FEED_REMINDERS_PREFIX = "relay-outpost-feed-reminders-scheduled";

function scheduledFeedRemindersKey(pubkey: string): string {
  return `${SCHEDULED_FEED_REMINDERS_PREFIX}:${pubkey}`;
}

export function getScheduledFeedReminderIds(pubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(scheduledFeedRemindersKey(pubkey));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function addScheduledFeedReminderId(pubkey: string, id: string): void {
  const current = getScheduledFeedReminderIds(pubkey);
  current.add(id);
  const arr = [...current];
  if (arr.length > 500) {
    localStorage.setItem(scheduledFeedRemindersKey(pubkey), JSON.stringify(arr.slice(-200)));
  } else {
    localStorage.setItem(scheduledFeedRemindersKey(pubkey), JSON.stringify(arr));
  }
}

export function getSubscribedFeeds(pubkey: string): SubscribedFeed[] {
  try {
    const raw = localStorage.getItem(subscriptionsKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSubscribedFeeds(pubkey: string, feeds: SubscribedFeed[]): void {
  localStorage.setItem(subscriptionsKey(pubkey), JSON.stringify(feeds));
}

export function subscribeFeed(pubkey: string, feed: SubscribedFeed): void {
  const current = getSubscribedFeeds(pubkey);
  if (current.some((f) => f.id === feed.id)) return;
  current.push(feed);
  saveSubscribedFeeds(pubkey, current);
}

export function unsubscribeFeed(pubkey: string, feedId: string): void {
  const current = getSubscribedFeeds(pubkey);
  saveSubscribedFeeds(pubkey, current.filter((f) => f.id !== feedId));
  try {
    localStorage.removeItem(feedCacheKey(pubkey, feedId));
  } catch {}
}

export function isFeedSubscribed(pubkey: string, feedId: string): boolean {
  return getSubscribedFeeds(pubkey).some((f) => f.id === feedId);
}

export function catalogEntryToSubscribedFeed(entry: FeedCatalogEntry): SubscribedFeed {
  return {
    id: entry.id,
    name: entry.name,
    emoji: entry.emoji,
    url: entry.url,
    isCatalog: true,
  };
}

interface CacheResult {
  events: FeedEvent[] | null;
  isStale: boolean;
}

function getCachedFeedEvents(pubkey: string, feedId: string): CacheResult {
  try {
    const raw = localStorage.getItem(feedCacheKey(pubkey, feedId));
    if (!raw) return { events: null, isStale: false };
    const parsed: CachedFeedData = JSON.parse(raw);
    const events = parsed.events.map((e) => ({
      ...e,
      dtstart: new Date(e.dtstart),
      dtend: e.dtend ? new Date(e.dtend) : undefined,
    }));
    const isStale = Date.now() - parsed.fetchedAt > CACHE_TTL;
    return { events, isStale };
  } catch {
    return { events: null, isStale: false };
  }
}

function setCachedFeedEvents(pubkey: string, feedId: string, events: FeedEvent[]): void {
  try {
    const data: CachedFeedData = { events, fetchedAt: Date.now() };
    localStorage.setItem(feedCacheKey(pubkey, feedId), JSON.stringify(data));
  } catch {}
}

function parseIcsDate(value: string): Date | null {
  if (!value) return null;

  const cleaned = value.replace(/^[A-Z]+[=;][^:]*:/i, "").trim();

  const basic = cleaned.replace("Z", "");
  if (/^\d{8}T\d{6}$/.test(basic)) {
    const y = parseInt(basic.slice(0, 4));
    const m = parseInt(basic.slice(4, 6)) - 1;
    const d = parseInt(basic.slice(6, 8));
    const h = parseInt(basic.slice(9, 11));
    const min = parseInt(basic.slice(11, 13));
    const s = parseInt(basic.slice(13, 15));
    if (cleaned.endsWith("Z")) {
      return new Date(Date.UTC(y, m, d, h, min, s));
    }
    return new Date(y, m, d, h, min, s);
  }

  if (/^\d{8}$/.test(basic)) {
    const y = parseInt(basic.slice(0, 4));
    const m = parseInt(basic.slice(4, 6)) - 1;
    const d = parseInt(basic.slice(6, 8));
    return new Date(y, m, d);
  }

  const fallback = new Date(cleaned);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function unfoldIcs(text: string): string {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

// Hard cap on events parsed from a single feed. Some public ICS feeds carry
// years of history (tens of thousands of VEVENTs); parsing them all would build
// that many Date objects and jank the UI on weak devices. A calendar only needs
// the near future, so we stop well before that.
const MAX_FEED_EVENTS = 1000;

export function parseIcal(icsText: string): FeedEvent[] {
  const events: FeedEvent[] = [];
  const unfolded = unfoldIcs(icsText);
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  let uid = "";
  let summary = "";
  let dtstart: Date | null = null;
  let dtend: Date | null = null;
  let description = "";
  let location = "";

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      summary = "";
      dtstart = null;
      dtend = null;
      description = "";
      location = "";
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && summary && dtstart) {
        events.push({
          uid: uid || `${dtstart.getTime()}-${summary.slice(0, 20)}`,
          summary,
          dtstart,
          dtend: dtend || undefined,
          description: description || undefined,
          location: location || undefined,
        });
      }
      inEvent = false;
      if (events.length >= MAX_FEED_EVENTS) break;
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith("UID:")) {
      uid = line.slice(4).trim();
    } else if (line.startsWith("SUMMARY:")) {
      summary = line.slice(8).trim().replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
    } else if (line.startsWith("DTSTART")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        dtstart = parseIcsDate(line.slice(colonIdx + 1).trim());
      }
    } else if (line.startsWith("DTEND")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        dtend = parseIcsDate(line.slice(colonIdx + 1).trim());
      }
    } else if (line.startsWith("DESCRIPTION:")) {
      description = line.slice(12).trim().replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
    } else if (line.startsWith("LOCATION:")) {
      location = line.slice(9).trim().replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
    }
  }

  return events;
}

export interface FeedFetchError {
  feedId: string;
  feedName: string;
  error: string;
}

const feedErrors: FeedFetchError[] = [];

export function getLastFeedErrors(): FeedFetchError[] {
  return [...feedErrors];
}

export function clearFeedErrors(): void {
  feedErrors.length = 0;
}

async function fetchFeedFromNetwork(feed: SubscribedFeed): Promise<FeedEvent[]> {
  const proxyUrl = `/api/ical-proxy?url=${encodeURIComponent(feed.url)}`;
  const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    const errorMsg = data.error || `HTTP ${response.status}`;
    console.warn(`[feeds] Failed to fetch ${feed.name}: ${errorMsg}`);
    feedErrors.push({ feedId: feed.id, feedName: feed.name, error: errorMsg });
    return [];
  }
  const text = await response.text();
  return parseIcal(text);
}

export async function fetchFeedEventsWithErrorTracking(feed: SubscribedFeed): Promise<FeedEvent[]> {
  try {
    return await fetchFeedFromNetwork(feed);
  } catch (err: any) {
    const errorMsg = err?.name === "TimeoutError" ? "Request timed out" : (err?.message || "Network error");
    feedErrors.push({ feedId: feed.id, feedName: feed.name, error: errorMsg });
    return [];
  }
}

export async function fetchFeedEvents(
  feed: SubscribedFeed,
  pubkey: string,
  forceRefresh?: boolean,
  onBackgroundRefresh?: () => void,
): Promise<FeedEvent[]> {
  const cache = getCachedFeedEvents(pubkey, feed.id);

  if (!forceRefresh && cache.events && !cache.isStale) {
    return cache.events;
  }

  if (!forceRefresh && cache.events && cache.isStale) {
    fetchFeedFromNetwork(feed)
      .then((freshEvents) => {
        setCachedFeedEvents(pubkey, feed.id, freshEvents);
        if (onBackgroundRefresh) onBackgroundRefresh();
      })
      .catch(() => {});
    return cache.events;
  }

  const events = await fetchFeedEventsWithErrorTracking(feed);
  if (events.length > 0) {
    setCachedFeedEvents(pubkey, feed.id, events);
  }
  return events.length > 0 ? events : (cache.events || []);
}

export async function fetchAllSubscribedFeedEvents(
  pubkey: string,
  startDate: Date,
  endDate: Date,
  forceRefresh?: boolean,
  onBackgroundRefresh?: () => void,
): Promise<{ feedId: string; feedName: string; feedEmoji: string; event: FeedEvent }[]> {
  const feeds = getSubscribedFeeds(pubkey);
  if (feeds.length === 0) return [];

  clearFeedErrors();

  const results: { feedId: string; feedName: string; feedEmoji: string; event: FeedEvent }[] = [];
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // Fetch in bounded batches rather than all at once: a user with many feeds
  // would otherwise fire every request in parallel and trip the proxy's
  // per-IP rate limit (30/min), causing feeds to fail in bursts.
  const CONCURRENCY = 5;
  const allEvents: { feed: SubscribedFeed; events: FeedEvent[] }[] = [];
  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((feed) =>
        fetchFeedEvents(feed, pubkey, forceRefresh, onBackgroundRefresh).then((events) => ({ feed, events })),
      ),
    );
    allEvents.push(...batchResults);
  }

  for (const { feed, events } of allEvents) {
    for (const event of events) {
      const eventMs = event.dtstart.getTime();
      if (eventMs >= startMs && eventMs <= endMs) {
        results.push({
          feedId: feed.id,
          feedName: feed.name,
          feedEmoji: feed.emoji,
          event,
        });
      }
    }
  }

  return results;
}
