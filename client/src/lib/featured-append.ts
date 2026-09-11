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
import { fetchNip11, toHexPubkey } from "@/lib/nip11";
import { canReachRelay, queryAnswered } from "@/lib/relay-reach";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getOutpostRelays, saveOutpostRelays, type OutpostRelay } from "@/lib/outpost-relays";
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

/**
 * A relay's Featured feeds, and whether you may shape them. Three outcomes, not
 * two (RELAY_REACHABILITY.md): the feeds (none yet is a real answer), a relay
 * we never got to ask, and one that doesn't list you as its operator. The old
 * read asked a dead relay, took nostr-tools' made-up EOSE for an answer, and
 * offered "Name your first feed" for a relay that could take nothing.
 */
export type RelayFeeds =
  | { status: "ok"; feeds: CurationSet[] }
  | { status: "unreachable" }
  | { status: "not-operator" };

type FeedDeps = {
  reach: (relayUrl: string) => Promise<boolean>;
  nip11: (relayUrl: string) => Promise<{ pubkey?: string; moderators?: string[] } | null>;
  query: (relayUrl: string) => Promise<{ events: Event[]; answered: boolean }>;
};
const liveFeedDeps: FeedDeps = {
  reach: (relayUrl) => canReachRelay(relayUrl),
  nip11: (relayUrl) => fetchNip11(relayUrl),
  query: (relayUrl) => queryAnswered([relayUrl], { kinds: [KIND_CURATION_SET], limit: 100 }),
};

export async function loadRelayFeeds(relayUrl: string, me: string | null, deps: Partial<FeedDeps> = {}): Promise<RelayFeeds> {
  const d = { ...liveFeedDeps, ...deps };
  if (!(await d.reach(relayUrl))) return { status: "unreachable" };
  // Who runs it comes from its NIP-11 document; without one we never got to ask.
  const doc = await d.nip11(relayUrl).catch(() => null);
  if (!doc) return { status: "unreachable" };
  const staff = new Set([doc.pubkey, ...(doc.moderators ?? [])].map(toHexPubkey).filter((p): p is string => !!p));
  if (!me || !staff.has(me.toLowerCase())) return { status: "not-operator" };
  const { events, answered } = await d.query(relayUrl);
  if (!answered) return { status: "unreachable" };
  return { status: "ok", feeds: relayFeaturedSets(events, doc) };
}

/** The relay says it isn't yours: stop offering Featured for it. */
export function forgetOperatorMark(relayUrl: string): void {
  const key = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const relays = getOutpostRelays();
  if (!relays.some((r) => key(r.url) === key(relayUrl) && r.isAdmin)) return;
  saveOutpostRelays(relays.map((r) => (key(r.url) === key(relayUrl) ? { ...r, isAdmin: false } : r)));
}

export type AddToFeaturedResult =
  | { ok: true; feedTitle: string; copied: boolean }
  | { ok: false; reason: "duplicate" | "unreached" | "not-operator" | "not-signed-in" | "publish-failed"; feedTitle?: string };

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
  /** Feature one EVENT (rebroadcast onto the relay too)… */
  event?: Event;
  /** …or a PERSON — all their published content flows into the feed. */
  person?: string;
  /** How the relay is asked (tests pass fakes). */
  deps?: Partial<FeedDeps>;
}): Promise<AddToFeaturedResult> {
  const signer = getGlobalSigner();
  if (!signer) return { ok: false, reason: "not-signed-in" };

  // Ask the relay first, for a new feed as much as an existing one: a feed on
  // a relay that's down can't land, and one on a relay that doesn't list you
  // would never be shown.
  const me = await signer.getPublicKey().catch(() => null);
  const found = await loadRelayFeeds(opts.relayUrl, me, opts.deps).catch((): RelayFeeds => ({ status: "unreachable" }));
  if (found.status === "unreachable") return { ok: false, reason: "unreached" };
  if (found.status === "not-operator") return { ok: false, reason: "not-operator" };

  const item: CurationItem = opts.event
    ? eventToCurationItem(opts.event, opts.relayUrl)
    : { type: "person", pubkey: opts.person!, relayHint: opts.relayUrl };

  // Freshest edition first — appending onto anything older would republish a
  // stale item list and silently drop later additions.
  let base: CurationSet | null = null;
  let title: string;
  let dTag: string;
  let description: string | undefined;
  let image: string | undefined;
  if ("coord" in opts.target) {
    const coord = opts.target.coord;
    base = found.feeds.find((s) => `${s.pubkey}:${s.dTag}` === coord) ?? null;
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
  if (opts.event) {
    try {
      copied = await publishEvent(opts.event, [opts.relayUrl]);
    } catch {
      copied = false;
    }
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
