import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { getPublicContacts, getProfilePicture as _getProfilePicture, getDisplayName as _getDisplayName } from "applesauce-core/helpers";
import type { ProfileContent } from "applesauce-core/helpers";

export { getProfileContent } from "applesauce-core/helpers";
import { getPetname, isShowingRealNames } from "./petnames";
import { petnameAvatarFor } from "./petname-images";

/**
 * Petname-aware display name — THE choke point (owner decision, 2026-08-15):
 * the name you gave someone replaces theirs everywhere; the session
 * "show real names" flip reveals the original. Surfaces that must never
 * petname — the rename dialog's "Real name:" line, anything whose text enters
 * PUBLISHED content — use getRealName instead.
 */
export function getDisplayName(metadata: Event, fallback?: string): string;
export function getDisplayName(metadata: undefined): undefined;
export function getDisplayName(metadata: ProfileContent | undefined): string | undefined;
export function getDisplayName(metadata: ProfileContent | Event | undefined, fallback: string): string;
export function getDisplayName(metadata: ProfileContent | Event | undefined, fallback?: string): string | undefined;
export function getDisplayName(metadata: ProfileContent | Event | undefined, fallback?: string): string | undefined {
  const real = _getDisplayName(metadata as Event, fallback as string);
  const pk = (metadata as { pubkey?: unknown } | undefined)?.pubkey;
  if (typeof pk !== "string" || !pk || isShowingRealNames()) return real;
  return getPetname("person", pk)?.name ?? real;
}

/** The RAW profile name — petnames never applied. */
export function getRealName(metadata: ProfileContent | Event | undefined, fallback: string): string;
export function getRealName(metadata: ProfileContent | Event | undefined, fallback?: string): string | undefined;
export function getRealName(metadata: ProfileContent | Event | undefined, fallback?: string): string | undefined {
  return _getDisplayName(metadata as Event, fallback as string);
}
export { getProfilePicture, getProfilePicture as getRawAvatarUrl } from "applesauce-core/helpers";

export function getOptimizedImageUrl(url: string | undefined, size: number = 128): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname === "image.nostr.build" || u.hostname.endsWith(".nostr.build") || u.hostname === "wsrv.nl") {
      return url;
    }
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${size}&h=${size}&fit=cover&default=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

export function getRawImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname === "wsrv.nl") {
      const original = u.searchParams.get("url");
      return original || url;
    }
    return url;
  } catch {
    return url;
  }
}

export function getAvatarUrl(event: Event | undefined): string | undefined {
  // The photo the viewer chose for this person wins over the real avatar
  // (same reveal flip as names).
  if (typeof event?.pubkey === "string" && event.pubkey) {
    const pet = petnameAvatarFor("person", event.pubkey);
    if (pet) return pet;
  }
  const raw = _getProfilePicture(event);
  return getOptimizedImageUrl(raw, 128);
}

// Resolve a kind-0 event's display name + avatar WITHOUT ever throwing.
// applesauce's getDisplayName/getProfilePicture read the raw metadata fields and
// call `(...)?.trim()` on them, plus npubEncode() on the event pubkey. A malformed
// profile — a numeric `name`/`display_name`/`picture` (`123?.trim()` is not a
// function), or an event whose pubkey isn't valid hex — makes them throw. Callers
// resolve profiles inside render-phase useMemos, so a single bad profile would
// otherwise crash the whole surrounding component (e.g. the Trust Reviews tab).
// Falls back to the caller-supplied name and an empty avatar on any failure.
export function resolveProfileDisplay(
  event: Event | undefined,
  fallbackName: string,
): { name: string; avatar: string } {
  let name: string | undefined;
  let avatar: string | undefined;
  // Resolve independently so one bad field (e.g. a numeric picture) can't drop a
  // perfectly good name.
  try {
    name = event ? _getDisplayName(event) : undefined;
  } catch {
    name = undefined;
  }
  try {
    avatar = event ? getAvatarUrl(event) : undefined;
  } catch {
    avatar = undefined;
  }
  return {
    name: name && name.trim() ? name : fallbackName,
    avatar: avatar || "",
  };
}

export function handleAvatarError(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  const raw = getRawImageUrl(img.src);
  if (raw && raw !== img.src) {
    img.src = raw;
  }
}

export const CLIENT_TAG: [string, string] = ["client", "Relay Outpost"];

// User-toggleable: whether to attribute published events with the client tag.
// OPT-IN — default OFF (owner decision 2026-08-27, flipping the old default):
// which app someone posts with is metadata about them, and the quiet default
// should not broadcast it. Only the literal "true" enables. Explicit choices
// made under the old default keep working ("true" stays on, "false" stays
// off). Returns a spreadable list so call sites do `...clientTags()`.
export const CLIENT_TAG_ENABLED_KEY = "relay-outpost-client-tag-enabled";
export function clientTags(): string[][] {
  try {
    return localStorage.getItem(CLIENT_TAG_ENABLED_KEY) === "true" ? [CLIENT_TAG] : [];
  } catch {
    return [];
  }
}

export const KIND_TEXT_NOTE = 1;
export const KIND_METADATA = 0;
export const KIND_FOLLOW_LIST = 3;
export const KIND_REPOST = 6;
/** NIP-18 generic repost — reposts of non-kind-1 events (pictures, videos).
 *  Carries a `k` tag naming the reposted kind. A profile that only ever
 *  fetches kind 6 shows a media-first account's repost activity as nothing. */
export const KIND_GENERIC_REPOST = 16;
export const KIND_REACTION = 7;
export const KIND_COMMUNITY = 34550;
export const KIND_LIVE_EVENT = 30311;
export const KIND_LIVE_CHAT = 1311;
export const KIND_TOPIC = 11;
export const KIND_COMMENT = 1111;
export const KIND_ZAP_REQUEST = 9734;
export const KIND_ZAP = 9735;
export const KIND_SHORT_VIDEO = 34236;
// NIP-71 as revised: 21 = normal video, 22 = short/vertical video. The
// addressable spellings (34235/34236) are the LEGACY generation — DiVine's
// archive still lives on 34236 (measured 2026-08-26: relay.divine.video
// serves 34236, zero 21/22), while new publishers ship 21/22 on general
// relays (100-event cap hit instantly on damus/nos/primal). A video surface
// that wants the whole catalog asks for all four.
export const KIND_VIDEO_NIP71 = 21;
export const KIND_SHORT_VIDEO_NIP71 = 22;
export const VIDEO_EVENT_KINDS = [KIND_VIDEO_NIP71, KIND_SHORT_VIDEO_NIP71, 34235, KIND_SHORT_VIDEO] as const;

export const DIVINE_VIDEO_RELAY = "wss://relay.divine.video";

export const LIVE_STREAM_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr.land",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com",
  "wss://relay.nostr.band",
  "wss://relay.zap.stream",
];

export function formatNoteId(hex: string): string {
  try {
    return nip19.noteEncode(hex);
  } catch {
    return hex.slice(0, 8) + "...";
  }
}

export function buildReplyTags(replyTo: Event, relayHint?: string): string[][] {
  const hint = relayHint || "";
  const tags: string[][] = [];
  const existingRoot = replyTo.tags.find(
    (t) => t[0] === "e" && t[3] === "root"
  );
  if (existingRoot) {
    tags.push(["e", existingRoot[1], existingRoot[2] || "", "root"]);
    tags.push(["e", replyTo.id, hint, "reply"]);
  } else {
    tags.push(["e", replyTo.id, hint, "root"]);
  }
  tags.push(["p", replyTo.pubkey]);
  const mentionedPubkeys = replyTo.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => t[1]);
  for (const pk of mentionedPubkeys) {
    if (pk !== replyTo.pubkey && !tags.some((t) => t[0] === "p" && t[1] === pk)) {
      tags.push(["p", pk]);
    }
  }
  tags.push(...clientTags());
  return tags;
}

export function buildNip22CommentTags(
  rootEvent: Event,
  parentEvent: Event | null,
  relayHint?: string,
): string[][] {
  const hint = relayHint || "";
  const tags: string[][] = [];
  tags.push(["K", String(rootEvent.kind)]);
  tags.push(["E", rootEvent.id, hint]);
  if (parentEvent && parentEvent.id !== rootEvent.id) {
    tags.push(["e", parentEvent.id, hint]);
  }
  tags.push(["P", rootEvent.pubkey]);
  if (parentEvent && parentEvent.pubkey !== rootEvent.pubkey) {
    tags.push(["p", parentEvent.pubkey]);
  }
  tags.push(...clientTags());
  return tags;
}

export function buildRepostTags(event: Event, relayHint?: string): string[][] {
  return [
    ["e", event.id, relayHint || ""],
    ["p", event.pubkey, relayHint || ""],
    ...clientTags(),
  ];
}

export function buildReactionTags(event: Event, relayHint?: string): string[][] {
  return [
    ["e", event.id, relayHint || ""],
    ["p", event.pubkey, relayHint || ""],
    ["k", String(event.kind)],
    ...clientTags(),
  ];
}

export function getRelayHintForEvent(eventId: string, getEventRelaysFn: (id: string) => string[]): string {
  const relays = getEventRelaysFn(eventId);
  return relays.length > 0 ? relays[0] : "";
}

export function parseFollowList(event: Event): string[] {
  return getPublicContacts(event).map((p) => p.pubkey);
}

export function getNoteTags(event: Event) {
  const tags = new Map<string, string[]>();
  for (const tag of event.tags) {
    if (tag[0]) {
      const existing = tags.get(tag[0]) || [];
      existing.push(tag[1]);
      tags.set(tag[0], existing);
    }
  }
  return tags;
}

export function formatNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch (e) {
    return hex.slice(0, 8) + '...';
  }
}

export function shortenNpub(npub: string): string {
  if (npub.length < 12) return npub;
  return `${npub.slice(0, 9)}...${npub.slice(-4)}`;
}

export function extractHashtags(content: string): string[][] {
  const textWithoutUrls = content.replace(/https?:\/\/\S+/g, "");
  const matches = textWithoutUrls.match(/(?:^|[\s\n])#(\w+)/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const tags: string[][] = [];
  for (const m of matches) {
    const hashIdx = m.indexOf("#");
    const tag = m.slice(hashIdx + 1).toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(["t", tag]);
    }
  }
  return tags;
}

export function isProtectedEvent(event: Pick<Event, "tags">): boolean {
  return event.tags.some((t) => t[0] === "-");
}

export function parseAuthRequiredRelays(err: unknown): string[] {
  const messages: string[] = [];
  const collect = (e: unknown) => {
    if (!e) return;
    if (typeof e === "string") messages.push(e);
    else if (e instanceof Error && e.message) messages.push(e.message);
  };
  if (err instanceof AggregateError) {
    for (const e of err.errors) collect(e);
  } else {
    collect(err);
  }
  const relays = new Set<string>();
  for (const msg of messages) {
    const lower = msg.toLowerCase();
    if (lower.includes("auth-required") || lower.includes("restricted: not authenticated")) {
      const urlMatch = msg.match(/wss?:\/\/[^\s,)\]]+/i);
      if (urlMatch) relays.add(urlMatch[0]);
    }
  }
  return Array.from(relays);
}

export function getMediaUrls(event: Event): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = event.content.match(urlRegex) || [];
  return matches.filter(url => 
    url.match(/\.(jpeg|jpg|gif|png|webp)(\?[^\s]*)?$/i)
  );
}
