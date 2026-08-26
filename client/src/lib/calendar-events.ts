import type { Event, Filter } from "nostr-tools";
import type { ScheduledPostWithDecrypted } from "@/lib/schedule";
import { pool, filterBlockedRelays, FAST_RELAYS, fetchProfilesCached, DEFAULT_RELAYS } from "@/lib/nostr";
import { throttledSubscribe } from "@/lib/relay-throttler";
import { getHealthyRelays, sortRelaysByScore } from "@/lib/relay-health";
import { getOutpostRelays, getActiveDefaultRelays } from "@/lib/outpost-relays";

export const KIND_DATE_CALENDAR_EVENT = 31922;
export const KIND_TIME_CALENDAR_EVENT = 31923;
export const KIND_CALENDAR = 31924;
export const KIND_CALENDAR_RSVP = 31925;

export interface CalendarEventData {
  id: string;
  pubkey: string;
  dTag: string;
  title: string;
  description: string;
  image?: string;
  location?: string;
  startDate?: string;
  startTime?: number;
  endDate?: string;
  endTime?: number;
  hashtags: string[];
  participants: string[];
  references: string[];
  kind: number;
  event: Event;
}

export type CalendarItemType = "scheduled" | "published" | "pinned-event" | "subscribed" | "creator-stream";

export interface CalendarItemScheduled {
  type: "scheduled";
  id: string;
  date: Date;
  dotColor: string;
  data: ScheduledPostWithDecrypted;
}

export interface CalendarItemPublished {
  type: "published";
  id: string;
  date: Date;
  dotColor: string;
  kind: number;
  content: string;
  pubkey: string;
  event: Event;
}

export interface CalendarItemPinnedEvent {
  type: "pinned-event";
  id: string;
  date: Date;
  dotColor: string;
  calendarEvent: CalendarEventData;
}

export interface CalendarItemSubscribed {
  type: "subscribed";
  id: string;
  feedId: string;
  date: Date;
  dotColor: string;
  summary: string;
  feedName: string;
  feedEmoji: string;
  description?: string;
  location?: string;
  dtend?: Date;
}

export interface CalendarItemCreatorStream {
  type: "creator-stream";
  id: string;
  date: Date;
  dotColor: string;
  title: string;
  summary: string;
  creatorPubkey: string;
  image?: string;
  starts?: number;
  ends?: number;
  hashtags: string[];
  eventId: string;
  dTag: string;
  status: string;
}

export type CalendarItem = CalendarItemScheduled | CalendarItemPublished | CalendarItemPinnedEvent | CalendarItemSubscribed | CalendarItemCreatorStream;

const PINNED_EVENTS_KEY_PREFIX = "relay-outpost-pinned-calendar-events";

function pinnedEventsKey(pubkey: string): string {
  return `${PINNED_EVENTS_KEY_PREFIX}:${pubkey}`;
}

export interface PinnedEventRef {
  id: string;
  kind: number;
  pubkey: string;
  dTag: string;
}

export type PinnedEntry = string | PinnedEventRef;

// Read + validate one localStorage-backed entry list (the pin store and the
// explicit-pin marker store share the same shape).
function readEntryStore(key: string): PinnedEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PinnedEntry => {
      if (typeof entry === "string" && entry.length > 0) return true;
      if (entry && typeof entry === "object" && typeof entry.id === "string") return true;
      return false;
    });
  } catch {
    return [];
  }
}

function getRawPinnedData(userPubkey: string): PinnedEntry[] {
  return readEntryStore(pinnedEventsKey(userPubkey));
}

function refMatchesCoord(ref: PinnedEventRef, kind: number, pubkey: string, dTag: string): boolean {
  return ref.kind === kind && ref.pubkey === pubkey && ref.dTag === dTag;
}

// ── Pure entry-list transitions ────────────────────────────────────────────
// The pin store and the explicit-pin marker store both hold arrays of
// PinnedEntry; these three pure functions are the single source of truth for
// membership/add/remove semantics (id match for legacy string entries, id OR
// addressable coordinate match for ref entries). Exported for unit tests.

export function hasPinnedEntry(current: PinnedEntry[], eventId: string, calendarEvent?: CalendarEventData): boolean {
  return current.some((entry) => {
    if (typeof entry === "string") return entry === eventId;
    if (entry.id === eventId) return true;
    if (calendarEvent && calendarEvent.dTag) {
      return refMatchesCoord(entry, calendarEvent.kind, calendarEvent.pubkey, calendarEvent.dTag);
    }
    return false;
  });
}

// Returns the SAME array when the entry is already present (idempotent) so
// callers can skip the localStorage write on no-ops.
export function addPinnedEntry(current: PinnedEntry[], eventId: string, calendarEvent?: CalendarEventData): PinnedEntry[] {
  if (hasPinnedEntry(current, eventId, calendarEvent)) return current;
  if (calendarEvent && calendarEvent.dTag) {
    return [...current, {
      id: calendarEvent.id,
      kind: calendarEvent.kind,
      pubkey: calendarEvent.pubkey,
      dTag: calendarEvent.dTag,
    }];
  }
  return [...current, eventId];
}

export function removePinnedEntry(current: PinnedEntry[], eventId: string, calendarEvent?: CalendarEventData): PinnedEntry[] {
  return current.filter((entry) => {
    if (typeof entry === "string") return entry !== eventId;
    if (entry.id === eventId) return false;
    if (calendarEvent && calendarEvent.dTag) {
      return !refMatchesCoord(entry, calendarEvent.kind, calendarEvent.pubkey, calendarEvent.dTag);
    }
    return true;
  });
}

export function getPinnedEventIds(userPubkey: string): string[] {
  return getRawPinnedData(userPubkey).map((entry) =>
    typeof entry === "string" ? entry : entry.id
  );
}

export function getPinnedEventRefs(userPubkey: string): PinnedEventRef[] {
  return getRawPinnedData(userPubkey)
    .filter((entry): entry is PinnedEventRef => typeof entry === "object")
    .filter((ref) => ref.kind && ref.pubkey && ref.dTag);
}

export function pinEvent(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): void {
  const current = getRawPinnedData(userPubkey);
  const next = addPinnedEntry(current, eventId, calendarEvent);
  if (next === current) return; // already pinned
  if (calendarEvent && calendarEvent.dTag) {
    pinnedEventCache.set(calendarEvent.id, calendarEvent);
  }
  localStorage.setItem(pinnedEventsKey(userPubkey), JSON.stringify(next));
}

export function unpinEvent(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): void {
  const filtered = removePinnedEntry(getRawPinnedData(userPubkey), eventId, calendarEvent);
  localStorage.setItem(pinnedEventsKey(userPubkey), JSON.stringify(filtered));
}

export function isEventPinned(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): boolean {
  return hasPinnedEntry(getRawPinnedData(userPubkey), eventId, calendarEvent);
}

// ── Pin provenance ─────────────────────────────────────────────────────────
// An event ends up pinned in the in-app calendar one of two ways:
//   • an EXPLICIT quiet pin from the event card's "Add to calendar" popover
//     ("Relay Outpost calendar") — a deliberate private save; localStorage
//     only, publishes nothing, or
//   • as a side effect of RSVPing Going (Going is the "save to my calendar"
//     gesture; clearing Going unpins).
// Clearing Going must only remove rsvp-provenance pins — a pin the user made
// explicitly must never be silently dropped by RSVP churn. We track provenance
// as a separate per-user marker set (same entry shape as the pin store)
// listing the explicitly pinned events; absence of a marker = rsvp provenance.
// Chosen over a flag on the pin entry itself because all legacy entries
// (written before provenance existed) were Going-pins — "no marker = rsvp"
// preserves their documented clear-unpins behavior with zero migration.
const EXPLICIT_PIN_KEY_PREFIX = "relay-outpost-explicit-pinned-events";

function explicitPinKey(pubkey: string): string {
  return `${EXPLICIT_PIN_KEY_PREFIX}:${pubkey}`;
}

// Quiet pin from the popover: pin + record explicit provenance.
export function pinEventExplicit(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): void {
  pinEvent(userPubkey, eventId, calendarEvent);
  const markers = readEntryStore(explicitPinKey(userPubkey));
  const next = addPinnedEntry(markers, eventId, calendarEvent);
  if (next !== markers) {
    localStorage.setItem(explicitPinKey(userPubkey), JSON.stringify(next));
  }
}

// Deliberate removal from the popover: always unpins, and clears the marker so
// a later Going→clear cycle behaves like a fresh rsvp-provenance pin.
export function unpinEventExplicit(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): void {
  unpinEvent(userPubkey, eventId, calendarEvent);
  const markers = removePinnedEntry(readEntryStore(explicitPinKey(userPubkey)), eventId, calendarEvent);
  localStorage.setItem(explicitPinKey(userPubkey), JSON.stringify(markers));
}

export function isEventPinnedExplicit(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): boolean {
  return hasPinnedEntry(readEntryStore(explicitPinKey(userPubkey)), eventId, calendarEvent);
}

// RSVP-driven unpin (clearing Going, or rolling back a failed Going publish):
// removes the pin ONLY when the user never explicitly pinned the event.
export function unpinEventFromRsvpClear(userPubkey: string, eventId: string, calendarEvent?: CalendarEventData): void {
  if (isEventPinnedExplicit(userPubkey, eventId, calendarEvent)) return;
  unpinEvent(userPubkey, eventId, calendarEvent);
}

// Coerce an untrusted value to a string, or undefined if it isn't one. Nostr
// events come off arbitrary relays; a malformed event can carry an object/array
// where a tag value or content should be a plain string. Every field that
// eventually reaches a JSX text node MUST pass through here so a single bad
// event can never throw "Objects are not valid as a React child".
export function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// The first string value of a given tag, or undefined. Ignores non-string
// values (which JSX would otherwise render as an object and crash on).
function firstTagString(event: Event, name: string): string | undefined {
  for (const t of event.tags) {
    if (t[0] === name && typeof t[1] === "string") return t[1];
  }
  return undefined;
}

// All string values for a repeated tag, dropping any non-string entries.
function tagStrings(event: Event, name: string): string[] {
  const out: string[] = [];
  for (const t of event.tags) {
    if (t[0] === name && typeof t[1] === "string") out.push(t[1]);
  }
  return out;
}

export function parseCalendarEvent(event: Event): CalendarEventData | null {
  // A non-string `d` (or a missing one) means this isn't a usable addressable
  // event — skip it rather than let a bad identifier flow downstream.
  const dTag = firstTagString(event, "d");
  if (!dTag) return null;

  const title = firstTagString(event, "title") || firstTagString(event, "name") || "Untitled Event";
  const description = safeString(event.content) || "";
  const image = firstTagString(event, "image");
  const location = firstTagString(event, "location");

  let startDate: string | undefined;
  let startTime: number | undefined;
  let endDate: string | undefined;
  let endTime: number | undefined;

  if (event.kind === KIND_DATE_CALENDAR_EVENT) {
    startDate = firstTagString(event, "start");
    endDate = firstTagString(event, "end");
  } else if (event.kind === KIND_TIME_CALENDAR_EVENT) {
    const startStr = firstTagString(event, "start");
    const endStr = firstTagString(event, "end");
    if (startStr) { const n = parseInt(startStr, 10); if (!Number.isNaN(n)) startTime = n; }
    if (endStr) { const n = parseInt(endStr, 10); if (!Number.isNaN(n)) endTime = n; }
  }

  const hashtags = tagStrings(event, "t");
  const participants = tagStrings(event, "p");
  const references = tagStrings(event, "r");

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title,
    description,
    image,
    location,
    startDate,
    startTime,
    endDate,
    endTime,
    hashtags,
    participants,
    references,
    kind: event.kind,
    event,
  };
}

export function getCalendarEventDate(ce: CalendarEventData): Date | null {
  if (ce.startTime) {
    return new Date(ce.startTime * 1000);
  }
  if (ce.startDate) {
    const parts = ce.startDate.split("-");
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
  }
  return null;
}

export interface MeetingLink {
  url: string;
  label: string;
  kind: "video" | "stream" | "link";
}

const STREAM_HOSTS = ["zap.stream", "twitch.tv", "youtube.com", "youtu.be", "kick.com", "rumble.com", "nostrnests.com"];
const VIDEO_HOSTS = ["meet.google.com", "zoom.us", "teams.microsoft.com", "teams.live.com", "meet.jit.si", "jitsi", "whereby.com", "8x8.vc", "riverside.fm", "around.co", "around.com"];

// Detect a "join"-style link (video meeting or live stream) for an event. We
// store it as an `r` reference tag; the first http(s) reference wins. Provider
// detection drives the CTA label so it reads the way users expect from the
// platform they're being sent to ("Join" a meeting, "Watch" a stream).
export function getMeetingLink(ce: CalendarEventData): MeetingLink | null {
  const url = ce.references.find((r) => /^https?:\/\//i.test(r));
  if (!url) return null;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = url.toLowerCase(); }
  if (STREAM_HOSTS.some((h) => host.includes(h))) return { url, label: "Watch", kind: "stream" };
  if (VIDEO_HOSTS.some((h) => host.includes(h))) return { url, label: "Join", kind: "video" };
  return { url, label: "Open link", kind: "link" };
}

export function getCalendarEventEndDate(ce: CalendarEventData): Date | null {
  if (ce.endTime) {
    return new Date(ce.endTime * 1000);
  }
  if (ce.endDate) {
    const parts = ce.endDate.split("-");
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// NIP-52 RSVP (kind 31925)
// ─────────────────────────────────────────────────────────────────────────

export type RsvpStatus = "accepted" | "tentative" | "declined";

export interface RsvpTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface EventRsvp {
  pubkey: string;
  status: RsvpStatus;
  createdAt: number;
  dTag: string;
}

export interface RsvpAggregate {
  goingCount: number;
  tentativeCount: number;
  goingPubkeys: string[];
  tentativePubkeys: string[];
  myStatus: RsvpStatus | null;
}

// The addressable coordinate of a calendar event: `<kind>:<pubkey>:<d>`.
// Same string ShareEventDialog puts in its q-tag; reused here for the RSVP `a`
// tag and for read-side `#a` subscriptions.
export function getEventCoordinate(ce: CalendarEventData): string {
  return `${ce.kind}:${ce.pubkey}:${ce.dTag}`;
}

// Deterministic, collision-resistant-enough `d` tag for an RSVP so that a user
// re-RSVPing the same event REPLACES their prior RSVP (addressable events are
// keyed by kind:pubkey:d). FNV-1a over "userPubkey:coordinate" — the author
// pubkey is already part of the address, this just keeps one RSVP per event.
export function rsvpDTag(userPubkey: string, coordinate: string): string {
  const input = `${userPubkey}:${coordinate}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `rsvp-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// Build the unsigned kind-31925 RSVP template. PURE: `now` (unix seconds) is
// injected, never read from the clock here. Tags follow NIP-52:
//   d      — stable id (per user+event) so re-RSVP replaces
//   a      — event coordinate (required)
//   e      — event id (recommended)
//   p      — event author (recommended)
//   status — accepted | tentative | declined
//   fb     — free|busy, only meaningful when accepted
// clientTags/relay hints are added by the publish call-site, keeping this pure
// and unit-testable in a node env (no localStorage).
export function buildRsvp(
  ce: CalendarEventData,
  status: RsvpStatus,
  userPubkey: string,
  now: number,
  relayHint?: string,
): RsvpTemplate {
  const coord = getEventCoordinate(ce);
  const aTag = relayHint ? ["a", coord, relayHint] : ["a", coord];
  const eTag = relayHint ? ["e", ce.id, relayHint] : ["e", ce.id];
  const tags: string[][] = [
    ["d", rsvpDTag(userPubkey, coord)],
    aTag,
    eTag,
    ["p", ce.pubkey],
    ["status", status],
  ];
  if (status === "accepted") tags.push(["fb", "busy"]);
  return {
    kind: KIND_CALENDAR_RSVP,
    created_at: now,
    tags,
    content: "",
  };
}

function getTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function parseRsvpStatus(raw: string | undefined): RsvpStatus | null {
  if (raw === "accepted" || raw === "tentative" || raw === "declined") return raw;
  return null;
}

// Fold a bag of kind-31925 events into per-event attendance. Keeps only the
// LATEST RSVP per author (by created_at, tie-broken by id for determinism), then
// counts accepted ("going") and tentative ("maybe"). Declined/unknown RSVPs are
// retained for the latest-per-author dedup but don't count toward either total.
// PURE — feed it whatever the subscription collected.
export function aggregateRsvps(events: Event[], viewerPubkey?: string | null): RsvpAggregate {
  const latest = new Map<string, Event>();
  for (const ev of events) {
    if (ev.kind !== KIND_CALENDAR_RSVP) continue;
    if (!parseRsvpStatus(getTagValue(ev.tags, "status"))) continue;
    const prev = latest.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at || (ev.created_at === prev.created_at && ev.id > prev.id)) {
      latest.set(ev.pubkey, ev);
    }
  }

  const goingPubkeys: string[] = [];
  const tentativePubkeys: string[] = [];
  let myStatus: RsvpStatus | null = null;

  for (const [pubkey, ev] of latest) {
    const status = parseRsvpStatus(getTagValue(ev.tags, "status"));
    if (status === "accepted") goingPubkeys.push(pubkey);
    else if (status === "tentative") tentativePubkeys.push(pubkey);
    if (viewerPubkey && pubkey === viewerPubkey) myStatus = status;
  }

  return {
    goingCount: goingPubkeys.length,
    tentativeCount: tentativePubkeys.length,
    goingPubkeys,
    tentativePubkeys,
    myStatus,
  };
}

function getCalendarRelays(): string[] {
  const outpost = getOutpostRelays().map((r) => r.url);
  const active = getActiveDefaultRelays();
  const combined = [...new Set([...outpost, ...active, ...FAST_RELAYS])];
  return filterBlockedRelays(sortRelaysByScore(getHealthyRelays(combined))).slice(0, 5);
}

export async function searchCalendarEvents(
  query: string,
  followedPubkeys?: string[],
): Promise<CalendarEventData[]> {
  return new Promise((resolve) => {
    const results: CalendarEventData[] = [];
    const seenIds = new Set<string>();
    const relays = getCalendarRelays();
    let eoseCount = 0;
    let resolved = false;
    const closers: Array<{ close(): void }> = [];

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        for (const c of closers) { try { c.close(); } catch {} }
        finalize();
      }
    }, 12000);

    const finalize = () => {
      clearTimeout(timer);
      const pubkeys = [...new Set(results.map((r) => r.pubkey))];
      if (pubkeys.length > 0) fetchProfilesCached(pubkeys);
      resolve(results);
    };

    const handleEvent = (event: Event) => {
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);
      const parsed = parseCalendarEvent(event);
      if (!parsed) return;

      if (query) {
        const lowerQuery = query.toLowerCase();
        const matchesTitle = parsed.title.toLowerCase().includes(lowerQuery);
        const matchesDesc = parsed.description.toLowerCase().includes(lowerQuery);
        const matchesLocation = parsed.location?.toLowerCase().includes(lowerQuery);
        const matchesHashtag = parsed.hashtags.some((h) => h.toLowerCase().includes(lowerQuery));
        if (!matchesTitle && !matchesDesc && !matchesLocation && !matchesHashtag) return;
      }

      results.push(parsed);
    };

    const filters: Filter[] = [];

    // Bound by publish time. NIP-52 calendar events are parametrized-replaceable
    // (kinds 31922/31923), so any event still relevant — including recurring
    // meetups and anything with an upcoming date — is republished and carries a
    // recent created_at. A generous one-year floor keeps all of those while
    // trimming the long tail of ancient one-off events that otherwise dominate
    // the discovery feed (and make it slow to fetch + filter on weak devices).
    const since = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;

    if (followedPubkeys && followedPubkeys.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < followedPubkeys.length; i += 200) {
        chunks.push(followedPubkeys.slice(i, i + 200));
      }
      for (const chunk of chunks) {
        filters.push({
          kinds: [KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT],
          authors: chunk,
          since,
          limit: 100,
        });
      }
    } else {
      filters.push({
        kinds: [KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT],
        since,
        limit: 100,
      });
    }

    for (const relay of relays) {
      for (const filter of filters) {
        const closer = throttledSubscribe(relay, () => {
          return pool.subscribeMany([relay], filter, {
            onevent: handleEvent,
            oneose() {
              eoseCount++;
              closer.close();
              if (eoseCount >= relays.length * filters.length && !resolved) {
                resolved = true;
                finalize();
              }
            },
          });
        });
        closers.push(closer);
      }
    }
  });
}

const pinnedEventCache = new Map<string, CalendarEventData>();

const PRIVATE_EVENTS_KEY = "outpost:private-events";

function getPrivateEventsStore(): Record<string, CalendarEventData> {
  try {
    const raw = localStorage.getItem(PRIVATE_EVENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePrivateEvent(calendarEvent: CalendarEventData): void {
  const store = getPrivateEventsStore();
  store[calendarEvent.id] = calendarEvent;
  localStorage.setItem(PRIVATE_EVENTS_KEY, JSON.stringify(store));
  pinnedEventCache.set(calendarEvent.id, calendarEvent);
}

export function removePrivateEvent(id: string): void {
  const store = getPrivateEventsStore();
  if (store[id]) {
    delete store[id];
    localStorage.setItem(PRIVATE_EVENTS_KEY, JSON.stringify(store));
  }
  pinnedEventCache.delete(id);
}

// NIP-9 deletion request for one of the user's own calendar events. References
// both the event id and its replaceable coordinate so relays drop every version.
export function buildEventDeletion(ce: CalendarEventData): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", ce.id],
      ["a", `${ce.kind}:${ce.pubkey}:${ce.dTag}`],
      ["k", String(ce.kind)],
    ],
    content: "Calendar event deleted",
  };
}

function loadPrivateEventsIntoCache(): void {
  const store = getPrivateEventsStore();
  for (const [id, ce] of Object.entries(store)) {
    if (!pinnedEventCache.has(id)) {
      pinnedEventCache.set(id, ce);
    }
  }
}

function findCachedByCoord(kind: number, pubkey: string, dTag: string): CalendarEventData | undefined {
  for (const ce of pinnedEventCache.values()) {
    if (ce.kind === kind && ce.pubkey === pubkey && ce.dTag === dTag) return ce;
  }
  return undefined;
}

/**
 * The user's pinned calendar events that are resolvable WITHOUT any relay
 * work: the localStorage private-event store plus whatever this session's
 * calendar fetches already cached. Synchronous and fetch-free by design — the
 * Stories menu's "Up next" row reads it on open, and a menu open must never
 * trigger network. Pins whose event data isn't locally known are simply
 * omitted.
 */
export function getLocallyCachedPinnedEvents(userPubkey: string): CalendarEventData[] {
  loadPrivateEventsIntoCache();
  const out: CalendarEventData[] = [];
  const seen = new Set<string>();
  for (const entry of getRawPinnedData(userPubkey)) {
    const ce =
      typeof entry === "string"
        ? pinnedEventCache.get(entry)
        : pinnedEventCache.get(entry.id) ?? findCachedByCoord(entry.kind, entry.pubkey, entry.dTag);
    if (ce && !seen.has(ce.id)) {
      seen.add(ce.id);
      out.push(ce);
    }
  }
  return out;
}

export async function fetchCalendarEventsByIds(eventIds: string[], refs?: PinnedEventRef[]): Promise<CalendarEventData[]> {
  if (eventIds.length === 0 && (!refs || refs.length === 0)) return [];

  loadPrivateEventsIntoCache();

  const cached: CalendarEventData[] = [];
  const uncachedIds: string[] = [];
  const uncachedRefs: PinnedEventRef[] = [];
  const seenCachedIds = new Set<string>();

  for (const id of eventIds) {
    const hit = pinnedEventCache.get(id);
    if (hit) {
      cached.push(hit);
      seenCachedIds.add(hit.id);
    } else {
      uncachedIds.push(id);
    }
  }

  if (refs) {
    for (const ref of refs) {
      const byId = pinnedEventCache.get(ref.id);
      if (byId && !seenCachedIds.has(byId.id)) {
        cached.push(byId);
        seenCachedIds.add(byId.id);
        continue;
      }
      const byCoord = findCachedByCoord(ref.kind, ref.pubkey, ref.dTag);
      if (byCoord && !seenCachedIds.has(byCoord.id)) {
        cached.push(byCoord);
        seenCachedIds.add(byCoord.id);
        continue;
      }
      if (!seenCachedIds.has(ref.id)) {
        uncachedRefs.push(ref);
      }
    }
  }

  if (uncachedIds.length === 0 && uncachedRefs.length === 0) return cached;

  return new Promise((resolve) => {
    const results: CalendarEventData[] = [...cached];
    const seenIds = new Set<string>(cached.map((c) => c.id));
    const relays = getCalendarRelays();
    let eoseCount = 0;
    let resolved = false;
    const closers: Array<{ close(): void }> = [];
    let totalSubs = 0;

    console.debug("[pinned-fetch] Starting relay fetch", {
      cachedCount: cached.length,
      uncachedIds: uncachedIds.length,
      uncachedRefs: uncachedRefs.length,
      relayCount: relays.length,
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.debug("[pinned-fetch] Timeout — resolving with", results.length, "results");
        for (const c of closers) { try { c.close(); } catch {} }
        finalize();
      }
    }, 10000);

    const finalize = () => {
      clearTimeout(timer);
      console.debug("[pinned-fetch] Finalized with", results.length, "total results");
      const pubkeys = [...new Set(results.map((r) => r.pubkey))];
      if (pubkeys.length > 0) fetchProfilesCached(pubkeys);
      resolve(results);
    };

    const handleEvent = (event: Event) => {
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);
      const parsed = parseCalendarEvent(event);
      if (parsed) {
        console.debug("[pinned-fetch] Received event:", parsed.title, parsed.id.slice(0, 8));
        pinnedEventCache.set(parsed.id, parsed);
        results.push(parsed);
      }
    };

    const checkEose = () => {
      eoseCount++;
      console.debug("[pinned-fetch] EOSE", eoseCount, "/", totalSubs);
      if (eoseCount >= totalSubs && !resolved) {
        resolved = true;
        finalize();
      }
    };

    const filters: Filter[] = [];

    if (uncachedIds.length > 0) {
      const idChunks: string[][] = [];
      for (let i = 0; i < uncachedIds.length; i += 50) {
        idChunks.push(uncachedIds.slice(i, i + 50));
      }
      for (const chunk of idChunks) {
        filters.push({
          ids: chunk,
          kinds: [KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT],
        });
      }
    }

    if (uncachedRefs.length > 0) {
      const byAuthor = new Map<string, PinnedEventRef[]>();
      for (const ref of uncachedRefs) {
        const existing = byAuthor.get(ref.pubkey) || [];
        existing.push(ref);
        byAuthor.set(ref.pubkey, existing);
      }
      for (const [author, authorRefs] of byAuthor) {
        filters.push({
          kinds: [KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT],
          authors: [author],
          "#d": authorRefs.map((r) => r.dTag),
        });
      }
    }

    console.debug("[pinned-fetch] Filters:", JSON.stringify(filters.map((f) => {
      const summary: Record<string, unknown> = { kinds: f.kinds };
      if ("ids" in f && Array.isArray(f.ids)) summary.ids = f.ids.length;
      if ("authors" in f && Array.isArray(f.authors)) summary.authors = f.authors;
      if ("#d" in f) summary["#d"] = f["#d"];
      return summary;
    })));

    if (filters.length === 0) {
      resolve(cached);
      return;
    }

    totalSubs = relays.length;

    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], filters, {
          onevent: handleEvent,
          oneose() {
            closer.close();
            checkEose();
          },
        });
      });
      closers.push(closer);
    }
  });
}

export async function fetchUserPublishedPosts(
  pubkey: string,
  startDate: Date,
  endDate: Date,
): Promise<CalendarItemPublished[]> {
  return new Promise((resolve) => {
    const items: CalendarItemPublished[] = [];
    const seenIds = new Set<string>();
    const outpost = getOutpostRelays().map((r) => r.url);
    const active = getActiveDefaultRelays();
    const combined = [...new Set([...outpost, ...active, ...DEFAULT_RELAYS, ...FAST_RELAYS])];
    const relays = filterBlockedRelays(sortRelaysByScore(getHealthyRelays(combined))).slice(0, 5);
    let eoseCount = 0;
    let resolved = false;
    const closers: Array<{ close(): void }> = [];

    const since = Math.floor(startDate.getTime() / 1000);
    const until = Math.floor(endDate.getTime() / 1000);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        for (const c of closers) { try { c.close(); } catch {} }
        resolve(items);
      }
    }, 10000);

    const handleEvent = (event: Event) => {
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);

      items.push({
        type: "published",
        id: event.id,
        date: new Date(event.created_at * 1000),
        dotColor: "bg-emerald-500",
        kind: event.kind,
        content: event.content?.slice(0, 200) || "",
        pubkey: event.pubkey,
        event,
      });
    };

    const filter = {
      kinds: [1, 1068, 30023],
      authors: [pubkey],
      since,
      until,
      limit: 200,
    };

    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany([relay], filter, {
          onevent: handleEvent,
          oneose() {
            eoseCount++;
            closer.close();
            if (eoseCount >= relays.length && !resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(items);
            }
          },
        });
      });
      closers.push(closer);
    }
  });
}
