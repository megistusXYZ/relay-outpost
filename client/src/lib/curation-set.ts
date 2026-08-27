/**
 * NIP-51 curation sets (kind 30004) — the container behind a relay's
 * operator-curated "Featured" feeds.
 *
 * One signed event = one named, ordered list of references: `e` tags for
 * notes/media posts, `a` tags for addressable content (articles, listings,
 * live streams, videos), `r` tags for plain web links. TAG ORDER IS DISPLAY
 * ORDER — the operator arranges the feed, the list carries the arrangement.
 *
 * Distinct from the Announce tab's kind-30078 "featured pins" doc: that one is
 * app-private plumbing; these sets are standard NIP-51, readable by any client.
 */
import { nip19, type Event } from "nostr-tools";
import { toHexPubkey } from "@/lib/nip11";

export const KIND_CURATION_SET = 30004;

export type CurationItem =
  | { type: "note"; id: string; relayHint?: string }
  | { type: "address"; kind: number; pubkey: string; identifier: string; relayHint?: string }
  | { type: "url"; url: string };

export interface CurationSet {
  id: string;
  pubkey: string;
  dTag: string;
  title: string;
  description?: string;
  image?: string;
  /** Tag order preserved — this IS the display order. */
  items: CurationItem[];
  createdAt: number;
  event: Event;
}

/**
 * The relay's OWN featured sets: only ones authored by the NIP-11 operator
 * pubkey or a listed moderator — anyone else publishing a 30004 to the relay
 * does not get its front page. Both sides normalized (NIP-11 pubkeys arrive in
 * npub form in the wild — the operator-key-gate rule). No named operator means
 * NO sets: authority is never guessed. Newest edition per author:d (30004 is
 * addressable), newest-first.
 */
export function relayFeaturedSets(
  events: Event[],
  nip11: { pubkey?: string; moderators?: string[] },
): CurationSet[] {
  const allowed = new Set<string>();
  const op = nip11.pubkey ? toHexPubkey(nip11.pubkey) : null;
  if (op) allowed.add(op);
  for (const m of nip11.moderators || []) {
    const hex = toHexPubkey(m);
    if (hex) allowed.add(hex);
  }
  if (allowed.size === 0) return [];

  const byCoord = new Map<string, CurationSet>();
  for (const ev of events) {
    if (!allowed.has(ev.pubkey)) continue;
    const set = parseCurationSet(ev);
    if (!set) continue;
    const key = `${set.pubkey}:${set.dTag}`;
    const prev = byCoord.get(key);
    if (!prev || set.createdAt > prev.createdAt) byCoord.set(key, set);
  }
  return [...byCoord.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export type FeedPaste = CurationItem | { type: "profile"; pubkey: string };

const BECH32_IN_TEXT = /(npub1|nprofile1|nevent1|note1|naddr1)[0-9a-z]+/i;

/**
 * One paste box, any reference: a nostr entity (bare, nostr:-prefixed, or
 * inside an njump/web link), a bare 64-hex event id, or a plain web URL.
 * npub/nprofile is a PROFILE, not an item — it opens the person picker.
 * Unrecognizable input is null, never a guessed item.
 */
export function detectFeedPaste(raw: string): FeedPaste | null {
  const input = raw.trim();
  if (!input) return null;

  const bech = input.match(BECH32_IN_TEXT)?.[0];
  if (bech) {
    try {
      const decoded = nip19.decode(bech.toLowerCase());
      if (decoded.type === "note") return { type: "note", id: decoded.data };
      if (decoded.type === "nevent") {
        const hint = decoded.data.relays?.[0];
        return { type: "note", id: decoded.data.id, ...(hint ? { relayHint: hint } : {}) };
      }
      if (decoded.type === "naddr") {
        const hint = decoded.data.relays?.[0];
        return {
          type: "address",
          kind: decoded.data.kind,
          pubkey: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          ...(hint ? { relayHint: hint } : {}),
        };
      }
      if (decoded.type === "npub") return { type: "profile", pubkey: decoded.data };
      if (decoded.type === "nprofile") return { type: "profile", pubkey: decoded.data.pubkey };
    } catch {
      return null;
    }
  }

  if (/^[0-9a-f]{64}$/i.test(input)) return { type: "note", id: input.toLowerCase() };
  if (/^https?:\/\/\S+$/i.test(input)) return { type: "url", url: input };
  return null;
}

export interface CurationSetDraft {
  dTag: string;
  title: string;
  description?: string;
  image?: string;
  items: CurationItem[];
}

/** Tags for publishing a set — the inverse of parseCurationSet. */
export function buildCurationSetTags(draft: CurationSetDraft): string[][] {
  const tags: string[][] = [["d", draft.dTag], ["title", draft.title]];
  if (draft.description) tags.push(["description", draft.description]);
  if (draft.image) tags.push(["image", draft.image]);
  for (const item of draft.items) {
    if (item.type === "note") {
      tags.push(item.relayHint ? ["e", item.id, item.relayHint] : ["e", item.id]);
    } else if (item.type === "address") {
      const coord = `${item.kind}:${item.pubkey}:${item.identifier}`;
      tags.push(item.relayHint ? ["a", coord, item.relayHint] : ["a", coord]);
    } else {
      tags.push(["r", item.url]);
    }
  }
  return tags;
}

export function parseCurationSet(event: Event): CurationSet | null {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (dTag === undefined) return null;

  const items: CurationItem[] = [];
  for (const t of event.tags) {
    if (t[0] === "e" && t[1]) {
      items.push({ type: "note", id: t[1], ...(t[2] ? { relayHint: t[2] } : {}) });
    } else if (t[0] === "a" && t[1]) {
      const [kindStr, pubkey, ...rest] = t[1].split(":");
      const kind = Number(kindStr);
      if (!Number.isInteger(kind) || !pubkey) continue;
      items.push({
        type: "address",
        kind,
        pubkey,
        // identifiers may themselves contain ":" — rejoin the tail.
        identifier: rest.join(":"),
        ...(t[2] ? { relayHint: t[2] } : {}),
      });
    } else if (t[0] === "r" && t[1]) {
      items.push({ type: "url", url: t[1] });
    }
  }

  const title = event.tags.find((t) => t[0] === "title")?.[1];
  const description = event.tags.find((t) => t[0] === "description")?.[1];
  const image = event.tags.find((t) => t[0] === "image")?.[1];

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title: title?.trim() || dTag,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    items,
    createdAt: event.created_at,
    event,
  };
}

/** Reader-facing name for an item — vocabulary, never kind numbers. */
export function curationItemLabel(item: CurationItem): string {
  if (item.type === "note") return "Post";
  if (item.type === "url") return "Link";
  switch (item.kind) {
    case 30023: return "Article";
    case 30402: return "Listing";
    case 30311: return "Stream";
    case 34235:
    case 34236: return "Video";
    default: return "Item";
  }
}
