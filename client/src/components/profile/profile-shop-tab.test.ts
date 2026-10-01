/**
 * A seller's profile (owner, 2026-10-01): the "For sale" rail sat above the
 * Media shelf — two shelves before the first post. What they sell is a Shop
 * chip now, last in the stream's own row (All · Posts · Replies · Articles ·
 * Media · Shop), and only for people who have something listed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");
const main = read("IdentityProfileMain.tsx");
const profile = read("../../pages/Profile.tsx");
const listing = read("../ListingCard.tsx");

describe("profile Shop tab", () => {
  it("the identity profile no longer draws a For-sale rail above the stream", () => {
    const start = profile.indexOf("<IdentityProfileLayout");
    const block = profile.slice(start, profile.indexOf("</IdentityProfileLayout>", start));
    expect(block).not.toContain("<ProfileListingsStrip");
    expect(block).toMatch(/shopPubkey=\{myPubkey \? pubkey : null\}/);
  });

  it("Shop is the last chip, and only exists when there are listings", () => {
    expect(main).toMatch(/\{ key: "media", label: "Media" \},[\s\S]{0,260}\.\.\.\(listings\.length > 0 \? \[\{ key: "shop" as const, label: "Shop" \}\] : \[\]\),\s*\];/);
  });

  it("the Shop chip opens the whole catalog as a grid, and the rail's companion steps aside", () => {
    expect(main).toMatch(/filter === "shop" \? \(\s*<ProfileShopGrid listings=\{listings\} \/>/);
    expect(main).toMatch(/filter !== "articles" && filter !== "media" && filter !== "shop" && \(\s*<ProfileCompanion/);
    expect(listing).toMatch(/grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4/);
  });

  it("one lookup feeds both the chip and the classic rail", () => {
    expect(listing).toMatch(/export function useProfileListings\(/);
    expect(listing).toMatch(/export function ProfileListingsStrip\(\{ pubkey \}: \{ pubkey: string \}\) \{\s*const listings = useProfileListings\(pubkey\);/);
  });
});
