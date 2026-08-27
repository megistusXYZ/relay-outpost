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
    event,
  };
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
