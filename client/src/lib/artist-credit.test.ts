import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { resolveArtistLink, resolveArtistZapTarget, isValidPubkey } from "./artist-credit";

// A real 64-hex pubkey (jack) for encode round-trips.
const PK_A = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const PK_B = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

describe("isValidPubkey", () => {
  it("accepts 64-char hex", () => {
    expect(isValidPubkey(PK_A)).toBe(true);
  });
  it("rejects empty / short / non-hex", () => {
    expect(isValidPubkey(undefined)).toBe(false);
    expect(isValidPubkey("")).toBe(false);
    expect(isValidPubkey("abc")).toBe(false);
    expect(isValidPubkey("z".repeat(64))).toBe(false);
  });
});

describe("resolveArtistLink", () => {
  it("prefers the Nostr profile when artistPubkey is present", () => {
    const link = resolveArtistLink({
      artistPubkey: PK_A,
      wavlakeUrl: "https://wavlake.com/track/abc",
      artistId: "artist-1",
    });
    expect(link).toEqual({
      kind: "profile",
      href: `/profile/${nip19.npubEncode(PK_A)}`,
      external: false,
    });
  });

  it("falls back to the Wavlake track url when there is no pubkey", () => {
    const link = resolveArtistLink({
      wavlakeUrl: "https://wavlake.com/track/abc",
      artistId: "artist-1",
    });
    expect(link).toEqual({
      kind: "wavlake",
      href: "https://wavlake.com/track/abc",
      external: true,
    });
  });

  it("falls back to the in-app Wavlake artist page when only artistId is present", () => {
    const link = resolveArtistLink({ artistId: "artist 1/x" });
    expect(link).toEqual({
      kind: "wavlake",
      href: "/audio?artist=artist%201%2Fx",
      external: false,
    });
  });

  it("ignores an invalid pubkey and returns null with no other links", () => {
    expect(resolveArtistLink({ artistPubkey: "not-hex" })).toBeNull();
    expect(resolveArtistLink({})).toBeNull();
  });
});

describe("resolveArtistZapTarget", () => {
  it("returns null when there is no pubkey and no splits", () => {
    expect(resolveArtistZapTarget({ artist: "Nobody" })).toBeNull();
    expect(resolveArtistZapTarget({ artist: "Nobody", zapSplits: [] })).toBeNull();
  });

  it("routes to the artist's own pubkey when no splits are present", () => {
    expect(
      resolveArtistZapTarget({ artist: "Ada", artistPubkey: PK_A }),
    ).toEqual({ pubkey: PK_A, name: "Ada" });
  });

  it("routes to the split recipient that matches the artist pubkey", () => {
    const target = resolveArtistZapTarget({
      artist: "Ada",
      artistPubkey: PK_A,
      zapSplits: [
        { name: "Producer", pubkey: PK_B, split: 90 },
        { name: "Ada", pubkey: PK_A, split: 10 },
      ],
    });
    expect(target).toEqual({ pubkey: PK_A, name: "Ada" });
  });

  it("routes to the largest-share pubkey split when the artist pubkey is unknown", () => {
    const target = resolveArtistZapTarget({
      artist: "Ada",
      zapSplits: [
        { name: "Small", pubkey: PK_A, split: 5 },
        { name: "Big", pubkey: PK_B, split: 95 },
      ],
    });
    expect(target).toEqual({ pubkey: PK_B, name: "Ada" });
  });

  it("ignores split recipients that carry only a lightning address (no nostr pubkey)", () => {
    const target = resolveArtistZapTarget({
      artist: "Ada",
      artistPubkey: PK_A,
      zapSplits: [
        { name: "Node", address: "0266e4598d1d3c415f572a8488830b60f7e744ed9235eb0b1ba93283b315c035", split: 100, type: "node" },
      ],
    });
    // No valid nostr pubkey in the splits, so it falls back to the artist pubkey.
    expect(target).toEqual({ pubkey: PK_A, name: "Ada" });
  });

  it("returns null when the only splits lack usable nostr pubkeys and there is no artist pubkey", () => {
    const target = resolveArtistZapTarget({
      artist: "Ada",
      zapSplits: [{ name: "Node", address: "lnaddr@example.com", split: 100, type: "node" }],
    });
    expect(target).toBeNull();
  });

  it("defaults the name when the artist name is blank", () => {
    expect(resolveArtistZapTarget({ artistPubkey: PK_A })).toEqual({
      pubkey: PK_A,
      name: "the artist",
    });
  });
});
