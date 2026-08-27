/**
 * One-tap "Add to Featured" — the shared append flow behind the post menu,
 * the ops Live Feed star, and anything else that features content in place.
 *
 * The replaceable-event rule governs everything here: the base of every
 * publish is the FRESHEST edition fetched from the relay at add time — never
 * a stale local copy, and a fetch failure ABORTS rather than publishing a
 * feed that would erase someone's items. Duplicates are refused by identity
 * (curationItemKey), not by reference.
 */
import type { Event } from "nostr-tools";
import { pool, publishEvent } from "@/lib/nostr";
import { fetchNip11 } from "@/lib/nip11";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getOutpostRelays, type OutpostRelay } from "@/lib/outpost-relays";
import {
  KIND_CURATION_SET,
  buildCurationSetTags,
  relayFeaturedSets,
  containsItem,
  eventToCurationItem,
  type CurationSet,
  type CurationItem,
} from "@/lib/curation-set";

/** The relays this person can curate — operator or moderator, per their own records. */
export function getAdminOutposts(): OutpostRelay[] {
  return getOutpostRelays().filter((r) => r.isAdmin);
}

export async function fetchFeedsForRelay(relayUrl: string): Promise<CurationSet[]> {
  const [events, nip11] = await Promise.all([
    pool.querySync([relayUrl], { kinds: [KIND_CURATION_SET], limit: 100 }),
    fetchNip11(relayUrl),
  ]);
  return relayFeaturedSets(events, { pubkey: nip11?.pubkey, moderators: nip11?.moderators });
}

export type AddToFeaturedResult =
  | { ok: true; feedTitle: string; copied: boolean }
  | { ok: false; reason: "duplicate" | "unreached" | "not-signed-in" | "publish-failed"; feedTitle?: string };

function slugify(title: string): string {
  const base = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `feed-${Date.now().toString(36)}`;
}

/**
 * Append one event to a feed on a relay. `target` is either an existing set's
 * coordinate (`"pubkey:dTag"`) or a new feed's title. Also rebroadcasts the
 * event onto the relay (the relay should serve what it features) — a copy
 * failure never fails the add.
 */
export async function addToFeaturedFeed(opts: {
  relayUrl: string;
  target: { coord: string } | { newTitle: string };
  event: Event;
}): Promise<AddToFeaturedResult> {
  const signer = getGlobalSigner();
  if (!signer) return { ok: false, reason: "not-signed-in" };

  const item: CurationItem = eventToCurationItem(opts.event, opts.relayUrl);

  // Freshest edition first — appending onto anything older would republish a
  // stale item list and silently drop later additions.
  let base: CurationSet | null = null;
  let title: string;
  let dTag: string;
  let description: string | undefined;
  let image: string | undefined;
  if ("coord" in opts.target) {
    const coord = opts.target.coord;
    let feeds: CurationSet[];
    try {
      feeds = await fetchFeedsForRelay(opts.relayUrl);
    } catch {
      return { ok: false, reason: "unreached" };
    }
    base = feeds.find((s) => `${s.pubkey}:${s.dTag}` === coord) ?? null;
    if (!base) return { ok: false, reason: "unreached" };
    title = base.title;
    dTag = base.dTag;
    description = base.description;
    image = base.image;
    if (containsItem(base.items, item)) return { ok: false, reason: "duplicate", feedTitle: title };
  } else {
    title = opts.target.newTitle.trim();
    dTag = slugify(title);
  }

  const template = {
    kind: KIND_CURATION_SET,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: buildCurationSetTags({ dTag, title, description, image, items: [...(base?.items ?? []), item] }),
  };
  try {
    const signed = await signWithTimeout(signer, template);
    const ok = await publishEvent(signed, [opts.relayUrl]);
    if (!ok) return { ok: false, reason: "publish-failed", feedTitle: title };
  } catch {
    return { ok: false, reason: "publish-failed", feedTitle: title };
  }

  let copied = false;
  try {
    copied = await publishEvent(opts.event, [opts.relayUrl]);
  } catch {
    copied = false;
  }
  return { ok: true, feedTitle: title, copied };
}

/**
 * Suggestions for an empty feed editor: the relay's own recent content —
 * posts, articles, videos, streams, listings — newest first, sets excluded.
 */
export async function fetchRelaySuggestions(relayUrl: string, limit = 8): Promise<Event[]> {
  const events = await pool.querySync([relayUrl], {
    kinds: [1, 30023, 21, 22, 34235, 34236, 30311, 30402],
    limit: 40,
  });
  const byId = new Map<string, Event>();
  for (const ev of events) byId.set(ev.id, ev);
  return [...byId.values()]
    .filter((ev) => ev.content.trim().length > 0 || ev.tags.some((t) => t[0] === "title"))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}
