/**
 * NIP-99 classified listings (kind 30402) — parsing and price formatting for
 * marketplace interop (Conduit et al).
 *
 * Shapes measured live before writing (2026-08-27): 95-listing sample across
 * damus/nos/primal plus wss://relay.conduit.market (Conduit's own relay,
 * confirmed serving 30402). price = ["price", amount, currency, frequency?],
 * currency case varies, amounts may be decimal strings; images repeat as
 * multiple `image` tags; status present on most ("active"/"sold"), absent
 * means active; content often duplicates `summary`.
 *
 * READ-side only by design: creating listings, orders, and checkout are the
 * marketplace apps' jobs — we render, link people, and hand conversation to
 * DMs and zaps, never money.
 */
import type { Event } from "nostr-tools";

export const KIND_CLASSIFIED_LISTING = 30402;

/** Conduit's relay carries the densest listing set — measured, not guessed. */
export const LISTING_RELAYS = ["wss://relay.conduit.market"];

export interface ListingPrice {
  amount: string;
  currency: string;
  frequency?: string;
}

export interface Listing {
  id: string;
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  price: ListingPrice | null;
  images: string[];
  location?: string;
  sold: boolean;
  publishedAt: number;
  /** Lowercased `t` hashtags — the category vocabulary sellers actually use. */
  tags: string[];
  event: Event;
}

/** Parse a kind-30402 into a renderable listing, or null when it can't be one. */
export function parseListing(event: Event): Listing | null {
  if (event.kind !== KIND_CLASSIFIED_LISTING) return null;
  const tag = (n: string) => event.tags.find((t) => t[0] === n)?.[1];
  const title = tag("title")?.trim();
  if (!title) return null;
  const priceTag = event.tags.find((t) => t[0] === "price" && t[1]);
  const price: ListingPrice | null = priceTag
    ? { amount: priceTag[1], currency: priceTag[2] ?? "", ...(priceTag[3] ? { frequency: priceTag[3] } : {}) }
    : null;
  const images = event.tags.filter((t) => t[0] === "image" && t[1]).map((t) => t[1]);
  const publishedAtStr = tag("published_at");
  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag: tag("d") ?? "",
    title,
    summary: (tag("summary") ?? event.content ?? "").trim(),
    price,
    images,
    location: tag("location") || undefined,
    // Positive claim only: sold means the event SAID sold.
    sold: tag("status")?.toLowerCase() === "sold",
    publishedAt: publishedAtStr ? parseInt(publishedAtStr, 10) || event.created_at : event.created_at,
    tags: event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1].toLowerCase().trim()),
    event,
  };
}

/**
 * The shop's category chips, from the vocabulary sellers actually use:
 * lowercased `t` tags ranked by how many listings carry them.
 */
export function rankListingCategories(listings: readonly Listing[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const l of listings) {
    for (const t of new Set(l.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Search + category over parsed listings. Both narrow; neither is case-sensitive. */
export function filterListings(
  listings: readonly Listing[],
  opts: { query?: string; category?: string },
): Listing[] {
  const q = opts.query?.trim().toLowerCase() ?? "";
  const cat = opts.category?.toLowerCase();
  return listings.filter((l) => {
    if (cat && !l.tags.includes(cat)) return false;
    if (!q) return true;
    return (
      l.title.toLowerCase().includes(q) ||
      l.summary.toLowerCase().includes(q) ||
      l.tags.some((t) => t.includes(q))
    );
  });
}

/**
 * Where "view / buy" should take a person, in sovereignty order:
 *
 *  1. The SELLER'S own declared page — an `r` tag holding a human web page.
 *     Their listing, their storefront, whatever marketplace that is.
 *  2. Otherwise the Conduit shop page for this listing, constructed from the
 *     addressable coordinate (URL scheme measured live 2026-08-27:
 *     /products/<kind>:<pubkey>:<d>, URL-encoded). Conduit's shop aggregates
 *     listings across marketplaces, so this resolves for most of the network.
 *
 * Machine endpoints are never a destination: live listings carry `r` tags
 * pointing at api.* service URLs (the402.ai), and sending a person to raw
 * JSON is worse than no link.
 */
export function listingWebUrl(listing: Pick<Listing, "pubkey" | "dTag" | "event">): { url: string; via: "seller" | "conduit" } {
  const rTags = listing.event.tags.filter((t) => t[0] === "r" && t[1]);
  for (const t of rTags) {
    const raw = t[1].trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    try {
      const u = new URL(raw);
      const machinish = u.hostname.startsWith("api.") || /\/(v\d+|api)\//i.test(u.pathname);
      if (!machinish) return { url: raw, via: "seller" };
    } catch { /* malformed r — keep looking */ }
  }
  const coord = `${KIND_CLASSIFIED_LISTING}:${listing.pubkey}:${listing.dTag}`;
  return { url: `https://shop.conduit.market/products/${encodeURIComponent(coord)}`, via: "conduit" };
}

/**
 * Assemble a browse surface from raw relay events: newest per addressable
 * coordinate (relays hold stale versions of replaceables), unrenderable
 * events dropped, flagged sellers excluded (the one cheap, positive scam
 * signal we hold), active listings before sold, newest first within each.
 * Shared by the profile "For sale" rail and the Marketplace page.
 */
export function pickMarketListings(
  events: readonly Event[],
  opts?: {
    flagged?: ReadonlySet<string>;
    /**
     * Locally-reported check (spam-filter's reported ledger, injected to keep
     * this module pure). Reporting must hide the goods HERE too, immediately —
     * feeds already hide by event id or author; waiting for the network-level
     * flag would leave what you just reported on the shelf.
     */
    isReported?: (event: Event) => boolean;
  },
): Listing[] {
  const byAddr = new Map<string, Event>();
  for (const e of events) {
    if (e.kind !== KIND_CLASSIFIED_LISTING) continue;
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? e.id;
    const key = `${e.pubkey}:${d}`;
    const prior = byAddr.get(key);
    if (!prior || e.created_at > prior.created_at) byAddr.set(key, e);
  }
  return [...byAddr.values()]
    .filter((e) => !opts?.flagged?.has(e.pubkey) && !opts?.isReported?.(e))
    .map(parseListing)
    .filter((l): l is Listing => l !== null)
    .sort((a, b) => (Number(a.sold) - Number(b.sold)) || (b.publishedAt - a.publishedAt));
}

/**
 * Human price line. Known currencies get their idiom (sats spelled out, $
 * for USD); everything else passes through as written — an invented symbol
 * for a currency we don't know would be a confident lie about money.
 */
export function formatListingPrice(price: ListingPrice): string {
  const { amount, currency, frequency } = price;
  const n = Number(amount);
  const cur = currency.toUpperCase();
  let base: string;
  if (!Number.isFinite(n)) {
    base = `${amount} ${currency}`.trim();
  } else if (cur === "SATS" || cur === "SAT") {
    base = `${n.toLocaleString("en-US")} sats`;
  } else if (cur === "USD") {
    base = `$${n.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  } else {
    base = `${amount} ${currency}`.trim();
  }
  return frequency ? `${base} / ${frequency}` : base;
}
