/**
 * NIP-99 classified listings (lib/listing.ts) — the decidable half of
 * marketplace support (Conduit et al).
 *
 * Shapes MEASURED live before writing (2026-08-27, 95-listing sample across
 * damus/nos/primal + relay.conduit.market): title on every listing, price on
 * 94/95 as ["price", amount, currency, frequency?] with currency case
 * varying ("SATS"/"sats"/"USD") and decimal amounts, image on 82, status on
 * 85, location on 37. Content duplicates summary on many.
 */
import { describe, expect, it } from "vitest";
import { parseListing, formatListingPrice, listingWebUrl, pickMarketListings } from "./listing";

const PK = "a".repeat(64);
const listing = (tags: string[][], content = "") =>
  ({ id: "e".repeat(64), kind: 30402, pubkey: PK, created_at: 1756200000, content, tags, sig: "" }) as never;

describe("parseListing", () => {
  it("parses the measured happy shape", () => {
    const l = parseListing(listing([
      ["d", "coffee-1"],
      ["title", "Sound Coffee"],
      ["summary", "The coffee that started it all."],
      ["price", "27000", "SATS"],
      ["image", "https://img.example/a.jpg"],
      ["image", "https://img.example/b.jpg"],
      ["location", "Guatemala"],
      ["status", "active"],
      ["published_at", "1756100000"],
    ]));
    expect(l).not.toBeNull();
    expect(l!.title).toBe("Sound Coffee");
    expect(l!.dTag).toBe("coffee-1");
    expect(l!.price).toEqual({ amount: "27000", currency: "SATS" });
    expect(l!.images).toEqual(["https://img.example/a.jpg", "https://img.example/b.jpg"]);
    expect(l!.location).toBe("Guatemala");
    expect(l!.sold).toBe(false);
  });

  it("a listing without a title is not renderable", () => {
    expect(parseListing(listing([["d", "x"], ["price", "1", "USD"]]))).toBeNull();
  });

  it("missing status means active; 'sold' means sold", () => {
    expect(parseListing(listing([["d", "x"], ["title", "T"]]))!.sold).toBe(false);
    expect(parseListing(listing([["d", "x"], ["title", "T"], ["status", "sold"]]))!.sold).toBe(true);
  });

  it("falls back to content when summary is absent (measured: content duplicates summary)", () => {
    const l = parseListing(listing([["d", "x"], ["title", "T"]], "Body text."));
    expect(l!.summary).toBe("Body text.");
  });
});

describe("formatListingPrice", () => {
  it("sats spell out with separators, any case (measured: SATS and sats both live)", () => {
    expect(formatListingPrice({ amount: "27000", currency: "SATS" })).toBe("27,000 sats");
    expect(formatListingPrice({ amount: "171000", currency: "sats" })).toBe("171,000 sats");
  });

  it("USD uses the symbol; decimals survive (measured: '0.315 USD')", () => {
    expect(formatListingPrice({ amount: "20", currency: "USD" })).toBe("$20");
    expect(formatListingPrice({ amount: "0.315", currency: "USD" })).toBe("$0.315");
  });

  it("recurring listings carry their cadence", () => {
    expect(formatListingPrice({ amount: "5", currency: "USD", frequency: "month" })).toBe("$5 / month");
  });

  it("unknown currencies pass through honestly, never invented symbols", () => {
    expect(formatListingPrice({ amount: "0.001", currency: "BTC" })).toBe("0.001 BTC");
  });

  it("an unparsable amount renders as-is rather than NaN", () => {
    expect(formatListingPrice({ amount: "a lot", currency: "USD" })).toBe("a lot USD");
  });
});

describe("listingWebUrl — where 'view / buy' should take a person", () => {
  const base = (tags: string[][]) => parseListing(listing([["d", "coffee-1"], ["title", "T"], ...tags]))!;

  it("honors the seller's own declared page first (r tag, human web page)", () => {
    const out = listingWebUrl(base([["r", "https://barattolo.store"]]));
    expect(out).toEqual({ url: "https://barattolo.store", via: "seller" });
  });

  it("never sends a person to a machine endpoint (measured: api.* r tags on live listings)", () => {
    const out = listingWebUrl(base([["r", "https://api.the402.ai/v1/services/svc_df741e"]]));
    expect(out.via).toBe("conduit");
  });

  it("falls back to the Conduit shop page built from the coordinate (measured URL scheme)", () => {
    const out = listingWebUrl(base([]));
    expect(out.via).toBe("conduit");
    expect(out.url).toBe(`https://shop.conduit.market/products/${encodeURIComponent(`30402:${PK}:coffee-1`)}`);
  });

  it("ignores non-http r values", () => {
    expect(listingWebUrl(base([["r", "wss://relay.example"]])).via).toBe("conduit");
  });
});

describe("pickMarketListings — assembling a browse surface from raw relay events", () => {
  const ev = (pubkey: string, d: string, createdAt: number, extra: string[][] = [], title = "Item") =>
    ({ id: `${pubkey.slice(0, 4)}-${d}-${createdAt}`, kind: 30402, pubkey, created_at: createdAt,
       content: "", sig: "", tags: [["d", d], ["title", title], ...extra] }) as never;
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("keeps only the newest version of each addressable coordinate", () => {
    const out = pickMarketListings([ev(A, "x", 100, [], "Old"), ev(A, "x", 200, [], "New")]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("New");
  });

  it("active listings lead; sold trail; newest first within each group", () => {
    const out = pickMarketListings([
      ev(A, "sold-new", 400, [["status", "sold"]]),
      ev(A, "act-old", 100),
      ev(B, "act-new", 300),
    ]);
    expect(out.map((l) => l.dTag)).toEqual(["act-new", "act-old", "sold-new"]);
  });

  it("drops unrenderable events and flagged sellers", () => {
    const out = pickMarketListings(
      [ev(A, "ok", 100), { id: "z", kind: 30402, pubkey: B, created_at: 50, content: "", sig: "", tags: [["d", "untitled"]] } as never],
      { flagged: new Set([A]) },
    );
    expect(out).toHaveLength(0);
  });
});
