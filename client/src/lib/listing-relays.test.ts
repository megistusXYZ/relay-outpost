/**
 * Where to ask for what a person sells (the profile's Shop tab).
 *
 * Measured 2026-10-01 on a seller with six listings: the lookup asked the
 * marketplace relay plus only the first three fast relays, and waited for all
 * of them. The marketplace relay now answers a read with an AUTH challenge and
 * then nothing (0 of 7 direct probes answered, 20 s each), so every lookup ran
 * its full 8 s; and of the other three only damus had the listings, so a
 * rate-limited damus meant no Shop tab at all (3 of 6 loads). A fourth default
 * relay that was never asked had all of them, in one second.
 */
import { describe, it, expect } from "vitest";
import { sellerListingRelays, collapseRelistings, LISTING_RELAYS, type Listing } from "./listing";

const DEFAULTS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.snort.social", "wss://nostr.land", "wss://relay.primal.net", "wss://nostr-01.yakihonne.com"];

describe("sellerListingRelays", () => {
  it("asks every default relay, not the first three", () => {
    const relays = sellerListingRelays([], DEFAULTS);
    for (const d of DEFAULTS) expect(relays).toContain(d);
  });

  it("the seller's own relays come before the defaults: that is where they publish", () => {
    const relays = sellerListingRelays(["wss://shop.example"], DEFAULTS);
    expect(relays.indexOf("wss://shop.example")).toBeLessThan(relays.indexOf(DEFAULTS[0]));
  });

  it("still asks the marketplace relay, first", () => {
    expect(sellerListingRelays([], DEFAULTS)[0]).toBe(LISTING_RELAYS[0]);
  });

  it("asks each relay once, however it was spelled", () => {
    const relays = sellerListingRelays(["wss://relay.damus.io/", "WSS://NOS.LOL"], DEFAULTS);
    expect(relays.filter((r) => r.includes("damus")).length).toBe(1);
    expect(relays.filter((r) => r.toLowerCase().includes("nos.lol")).length).toBe(1);
  });

  it("is capped, so a seller with a long relay list doesn't fan one lookup out to dozens of sockets", () => {
    const many = Array.from({ length: 30 }, (_, i) => `wss://r${i}.example`);
    expect(sellerListingRelays(many, DEFAULTS).length).toBeLessThanOrEqual(12);
    // …and the defaults still make the cut: they are where the listings were found.
    expect(sellerListingRelays(many, DEFAULTS)).toContain("wss://nostr-01.yakihonne.com");
  });
});

describe("collapseRelistings — one tile per product on a seller's own shop", () => {
  // The full catalog (55 listings) had 32 distinct product names: the seller
  // had re-listed the same items under new ids, and the grid repeated them.
  const item = (dTag: string, title: string, amount: string, over: Partial<Listing> = {}): Listing => ({
    id: dTag, pubkey: "seller", dTag, title, summary: "", price: { amount, currency: "SAT" }, images: [], sold: false, publishedAt: 100, tags: [], event: {} as never, ...over,
  });

  it("the same product at the same price, listed twice, shows once — the first in the list (unsold and newest come first)", () => {
    const a = item("new", "BED HEAD Small Talk Cream", "21000", { publishedAt: 200 });
    const b = item("old", "BED HEAD Small Talk Cream", "21000", { publishedAt: 100 });
    expect(collapseRelistings([a, b])).toEqual([a]);
  });

  it("spelling noise doesn't make two products: case and spacing are ignored", () => {
    const a = item("1", "Cretan Wildflower Honey 10 oz", "12100");
    const b = item("2", "  cretan wildflower  honey 10 oz ", "12100");
    expect(collapseRelistings([a, b])).toHaveLength(1);
  });

  it("a different price is a different offer and stays", () => {
    const a = item("1", "Olive Oil 34oz", "35000");
    const b = item("2", "Olive Oil 34oz", "42000");
    expect(collapseRelistings([a, b])).toHaveLength(2);
  });

  it("a different size is a different product and stays", () => {
    const a = item("1", "Cretan Wildflower Honey 10 oz", "12100");
    const b = item("2", "Cretan Wildflower Honey 4oz", "5000");
    expect(collapseRelistings([a, b])).toHaveLength(2);
  });

  it("only one seller's own repeats collapse: two sellers with the same product both stay", () => {
    const a = item("1", "Honey", "100");
    const b = item("2", "Honey", "100", { pubkey: "other" });
    expect(collapseRelistings([a, b])).toHaveLength(2);
  });
});
