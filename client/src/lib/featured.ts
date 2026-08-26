// Community "Featured" content: an operator-curated announcement plus a small
// set of pinned items shown at the top of an Outpost's Timeline. Stored as a
// single NIP-78 app-data event (kind 30078) authored by the relay operator,
// keyed per relay, and published to a few well-connected app-data relays — the
// same proven pattern already used for pinned topics / community rules.

import { nip19 } from "nostr-tools";

export const KIND_APP_DATA = 30078;
export const FEATURED_D_TAG = "relay-outpost/featured";
export const APP_DATA_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];

export const MAX_FEATURED_ITEMS = 12;

export interface FeaturedItem {
  /** Event kind of the referenced item (1 note, 11 wave, 30023 article, 31922/31923 event). */
  kind: number;
  /** Event id for non-replaceable refs (notes, waves). */
  id?: string;
  /** Coordinate `kind:pubkey:dTag` for parametrized-replaceable refs (articles, calendar events). */
  coord?: string;
  /** Optional operator label shown if the item can't be fetched. */
  label?: string;
}

export interface FeaturedDoc {
  announcement?: {
    text: string;
    updatedAt: number;
    /** Event id of the kind-1 announcement this pin was created from, when it
     *  was pinned via the operator ANNOUNCE outbox (vs. typed in directly).
     *  Lets the outbox show *which* announcement is currently pinned without a
     *  fragile text comparison, and re-point the pin after an edit. */
    sourceId?: string;
  };
  items: FeaturedItem[];
  relay: string;
}

export function featuredDTag(relayUrl: string): string {
  return `${FEATURED_D_TAG}/${relayUrl}`;
}

export function emptyFeaturedDoc(relayUrl: string): FeaturedDoc {
  return { items: [], relay: relayUrl };
}

export function isFeaturedDocEmpty(doc: FeaturedDoc | null | undefined): boolean {
  if (!doc) return true;
  const hasAnn = !!doc.announcement?.text?.trim();
  return !hasAnn && doc.items.length === 0;
}

export function parseFeaturedDoc(content: string, relayUrl: string): FeaturedDoc {
  try {
    const data = JSON.parse(content);
    const items: FeaturedItem[] = Array.isArray(data.items)
      ? data.items
          .filter((it: any) => it && typeof it.kind === "number" && (typeof it.id === "string" || typeof it.coord === "string"))
          .slice(0, MAX_FEATURED_ITEMS)
          .map((it: any) => ({ kind: it.kind, id: it.id, coord: it.coord, label: typeof it.label === "string" ? it.label : undefined }))
      : [];
    const announcement = data.announcement && typeof data.announcement.text === "string" && data.announcement.text.trim()
      ? {
          text: String(data.announcement.text),
          updatedAt: Number(data.announcement.updatedAt) || 0,
          ...(typeof data.announcement.sourceId === "string" && data.announcement.sourceId
            ? { sourceId: data.announcement.sourceId }
            : {}),
        }
      : undefined;
    return { announcement, items, relay: relayUrl };
  } catch {
    return emptyFeaturedDoc(relayUrl);
  }
}

export function buildFeaturedEventTemplate(doc: FeaturedDoc, relayUrl: string) {
  return {
    kind: KIND_APP_DATA,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", featuredDTag(relayUrl)]],
    content: JSON.stringify({
      announcement: doc.announcement,
      items: doc.items.slice(0, MAX_FEATURED_ITEMS),
      relay: relayUrl,
    }),
  };
}

/** Resolve a pasted reference (note1/nevent/naddr/hex id) into a FeaturedItem.
 *  Returns null if it can't be decoded. */
export function refToFeaturedItem(input: string): FeaturedItem | null {
  const trimmed = input.trim().replace(/^nostr:/i, "");
  // Raw 64-char hex → assume a note (kind 1).
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return { kind: 1, id: trimmed.toLowerCase() };
  }
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "note") {
      return { kind: 1, id: decoded.data as string };
    }
    if (decoded.type === "nevent") {
      const d = decoded.data as { id: string; kind?: number };
      return { kind: typeof d.kind === "number" ? d.kind : 1, id: d.id };
    }
    if (decoded.type === "naddr") {
      const d = decoded.data as { kind: number; pubkey: string; identifier: string };
      return { kind: d.kind, coord: `${d.kind}:${d.pubkey}:${d.identifier}` };
    }
  } catch {}
  return null;
}

export function featuredItemKey(it: FeaturedItem): string {
  return it.id || it.coord || JSON.stringify(it);
}

export function kindLabel(kind: number): string {
  if (kind === 1) return "Post";
  if (kind === 11) return "Wave";
  if (kind === 30023) return "Article";
  if (kind === 31922 || kind === 31923) return "Event";
  if (kind === 30311) return "Stream";
  return "Pinned";
}

/**
 * The human-readable body of a relay ANNOUNCE (kind-1) event: its content with
 * the trailing relay URL the outbox appends (`\n\n{relayUrl}`) stripped off.
 * The outbox uses this both to render the announcement and to seed the pinned
 * community announcement, so the same text flows to both surfaces.
 */
export function announcementBody(content: string, relayUrl: string): string {
  const trimmed = (content || "").trimEnd();
  if (relayUrl && trimmed.endsWith(relayUrl)) {
    return trimmed.slice(0, -relayUrl.length).trim();
  }
  // Fallback for content where the URL isn't a clean trailing suffix.
  return (content || "").replace(relayUrl, "").trim();
}

/**
 * Return a new FeaturedDoc with the pinned announcement set (or cleared when
 * `announcement` is null / blank), **preserving the existing pinned items**.
 * This is the single write path both the Community tab and the Announce outbox
 * use, so the kind-30078 `featuredDTag` event is built identically regardless of
 * which surface set it — and pinning an announcement never clobbers pinned items.
 */
export function setDocAnnouncement(
  doc: Pick<FeaturedDoc, "items">,
  announcement: { text: string; sourceId?: string } | null,
  relayUrl: string,
  now: number = Math.floor(Date.now() / 1000),
): FeaturedDoc {
  const text = announcement?.text?.trim();
  return {
    relay: relayUrl,
    items: doc.items ?? [],
    announcement: text
      ? { text, updatedAt: now, ...(announcement?.sourceId ? { sourceId: announcement.sourceId } : {}) }
      : undefined,
  };
}

/**
 * Is the given kind-1 announcement the one currently pinned to the community
 * page? Prefers an exact `sourceId` match (announcements pinned via the outbox);
 * falls back to comparing the pinned text against the announcement body for
 * legacy pins or announcements typed directly into the Community tab.
 */
export function isAnnouncementPinnedFrom(
  doc: FeaturedDoc | null | undefined,
  event: { id: string; content: string },
  relayUrl: string,
): boolean {
  const ann = doc?.announcement;
  if (!ann?.text?.trim()) return false;
  if (ann.sourceId) return ann.sourceId === event.id;
  return ann.text.trim() === announcementBody(event.content, relayUrl);
}
