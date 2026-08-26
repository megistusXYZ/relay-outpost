import { describe, it, expect } from "vitest";
import {
  detectPasteLink,
  filterDirectory,
  filterJoinedMatches,
  toDirMatches,
  relayDisplayName,
  joinedUrlSet,
  type DiscoveredOutpost,
} from "./outpost-directory";
import type { Nip11Document } from "./nip11";
import type { OutpostRelay } from "./outpost-relays";

function relay(url: string, over: Partial<DiscoveredOutpost> = {}): DiscoveredOutpost {
  return {
    url,
    supportedNips: [],
    requirements: [],
    software: "",
    relayType: "",
    lastSeen: 0,
    nip11: null,
    nip11Loading: false,
    activeUserCount: null,
    ...over,
  };
}

function nip11(over: Partial<Nip11Document>): Nip11Document {
  return { ...over };
}

describe("detectPasteLink", () => {
  it("treats a bare host as a relay url to open (wss:// prefixed, slashes trimmed)", () => {
    const d = detectPasteLink("fiatjaf.com");
    expect(d.looksLikeUrl).toBe(true);
    expect(d.urlToOpen).toBe("wss://fiatjaf.com");
    expect(d.groupInvite).toBeNull();
  });

  it("preserves an explicit wss:// scheme and trims trailing slashes", () => {
    const d = detectPasteLink("wss://relay.example.com/");
    expect(d.looksLikeUrl).toBe(true);
    expect(d.urlToOpen).toBe("wss://relay.example.com");
  });

  it("strips an http(s):// scheme before rebuilding as wss://", () => {
    const d = detectPasteLink("https://groups.fiatjaf.com");
    expect(d.looksLikeUrl).toBe(true);
    expect(d.urlToOpen).toBe("wss://groups.fiatjaf.com");
  });

  it("unwraps a copied hub share link (/outposts/<encoded-relay>)", () => {
    const encoded = encodeURIComponent("wss://relay.example.com");
    const d = detectPasteLink(`https://relayoutpost.xyz/outposts/${encoded}`);
    expect(d.looksLikeUrl).toBe(true);
    expect(d.urlToOpen).toBe("wss://relay.example.com");
  });

  it("does not treat free-text as a url", () => {
    const d = detectPasteLink("bitcoin community");
    expect(d.looksLikeUrl).toBe(false);
    expect(d.groupInvite).toBeNull();
  });

  it("does not treat a bare word (no TLD) as a url", () => {
    expect(detectPasteLink("fiatjaf").looksLikeUrl).toBe(false);
  });
});

describe("filterDirectory", () => {
  const relays = [
    relay("wss://fiatjaf.com", { nip11: nip11({ name: "fiatjaf" }), activeUserCount: 5, lastSeen: 100 }),
    relay("wss://groups.fiatjaf.com", { nip11: nip11({ name: "fiatjaf groups" }), activeUserCount: 2, lastSeen: 200 }),
    relay("wss://nos.lol", { nip11: nip11({ name: "nos.lol", description: "a friendly relay" }), activeUserCount: 9, lastSeen: 50 }),
  ];

  it("fuzzy-matches on name/url and returns best-match-first while searching", () => {
    const out = filterDirectory(relays, "fiat", new Set());
    expect(out.map((r) => r.url)).toEqual([
      "wss://fiatjaf.com",
      "wss://groups.fiatjaf.com",
    ]);
  });

  it("excludes already-joined relays (normalized, case-insensitive)", () => {
    const joined = joinedUrlSet([{ url: "wss://FiatJaf.com/", label: "", access: "public" }]);
    const out = filterDirectory(relays, "fiat", joined);
    expect(out.map((r) => r.url)).toEqual(["wss://groups.fiatjaf.com"]);
  });

  it("returns [] when nothing matches the query", () => {
    expect(filterDirectory(relays, "zzzznomatch", new Set())).toEqual([]);
  });

  it("with an empty query returns everything sorted by active-user count (active sort)", () => {
    const out = filterDirectory(relays, "", new Set());
    expect(out.map((r) => r.url)).toEqual([
      "wss://nos.lol", // 9 active
      "wss://fiatjaf.com", // 5
      "wss://groups.fiatjaf.com", // 2
    ]);
  });

  it("honors the free/paid filter", () => {
    const paidRelay = relay("wss://paid.example", {
      nip11: nip11({ name: "paid relay", limitation: { payment_required: true } }),
    });
    const withPaid = [...relays, paidRelay];
    expect(filterDirectory(withPaid, "relay", new Set(), { discoverFilter: "paid" }).map((r) => r.url)).toEqual([
      "wss://paid.example",
    ]);
    expect(
      filterDirectory(withPaid, "relay", new Set(), { discoverFilter: "free" }).some((r) => r.url === "wss://paid.example"),
    ).toBe(false);
  });
});

describe("filterJoinedMatches", () => {
  const joined: OutpostRelay[] = [
    { url: "wss://team.example", label: "Team", access: "public" },
    { url: "wss://fiatjaf.com", label: "fiatjaf", access: "public" },
    { url: "wss://random.relay", label: "Random", access: "public" },
  ];
  const nip11For = (url: string): Nip11Document | null =>
    url === "wss://team.example" ? nip11({ name: "Team HQ", icon: "https://x/icon.png" }) : null;

  it("returns [] for an empty query", () => {
    expect(filterJoinedMatches(joined, nip11For, "")).toEqual([]);
  });

  it("matches by NIP-11 name, saved label, or url substring", () => {
    expect(filterJoinedMatches(joined, nip11For, "hq").map((m) => m.url)).toEqual(["wss://team.example"]);
    expect(filterJoinedMatches(joined, nip11For, "fiat").map((m) => m.url)).toEqual(["wss://fiatjaf.com"]);
    expect(filterJoinedMatches(joined, nip11For, "random.relay").map((m) => m.url)).toEqual(["wss://random.relay"]);
  });

  it("carries the display name + icon into the match shape", () => {
    const [m] = filterJoinedMatches(joined, nip11For, "hq");
    expect(m).toMatchObject({ url: "wss://team.example", name: "Team HQ", icon: "https://x/icon.png", activeUserCount: null });
  });

  it("respects the result limit", () => {
    expect(filterJoinedMatches(joined, () => null, "wss://", 2)).toHaveLength(2);
  });
});

describe("relayDisplayName", () => {
  it("prefers NIP-11 name, then label, then the host from the url", () => {
    expect(relayDisplayName("wss://a.com", nip11({ name: "Nice" }), "label")).toBe("Nice");
    expect(relayDisplayName("wss://a.com", null, "label")).toBe("label");
    expect(relayDisplayName("wss://a.com/", null)).toBe("a.com");
  });
});

describe("toDirMatches", () => {
  it("slices and maps directory relays into row-ready matches", () => {
    const relays = Array.from({ length: 8 }, (_, i) =>
      relay(`wss://relay-${i}.com`, { activeUserCount: i, nip11: nip11({ name: `Relay ${i}`, icon: `icon${i}` }) }),
    );
    const out = toDirMatches(relays, 6);
    expect(out).toHaveLength(6);
    expect(out[0]).toMatchObject({ url: "wss://relay-0.com", name: "Relay 0", icon: "icon0", activeUserCount: 0 });
  });
});
