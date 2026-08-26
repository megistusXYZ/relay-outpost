import { describe, it, expect } from "vitest";
import {
  articleCategory,
  categoryToBucket,
  NEWS_BUCKETS,
  NEWS_BUCKET_LABELS,
  type NewsBucket,
} from "./news-categories";
import { DEFAULT_FEEDS, EXTRA_DEFAULT_FEEDS, SUGGESTED_FEEDS } from "./rss-feeds";

describe("categoryToBucket", () => {
  it("folds the editorial categories onto the canonical buckets", () => {
    // News
    expect(categoryToBucket("World")).toBe("News");
    expect(categoryToBucket("US & Breaking")).toBe("News");
    expect(categoryToBucket("Politics")).toBe("News");
    expect(categoryToBucket("Local")).toBe("News");
    // Business
    expect(categoryToBucket("Business & Finance")).toBe("Business");
    expect(categoryToBucket("Markets")).toBe("Business");
    expect(categoryToBucket("Bitcoin")).toBe("Business");
    // Tech
    expect(categoryToBucket("Technology")).toBe("Tech");
    expect(categoryToBucket("Nostr")).toBe("Tech");
    expect(categoryToBucket("Privacy")).toBe("Tech");
    // Single-topic buckets
    expect(categoryToBucket("Sports")).toBe("Sports");
    expect(categoryToBucket("Health")).toBe("Health");
    expect(categoryToBucket("Science")).toBe("Science");
  });

  it("returns null for categories that belong to no bucket (Top-only)", () => {
    expect(categoryToBucket("Entertainment & Culture")).toBeNull();
    expect(categoryToBucket("Longform")).toBeNull();
    expect(categoryToBucket("Podcasts")).toBeNull();
    expect(categoryToBucket("Podcast")).toBeNull(); // singular, ad-hoc podcast adds
    expect(categoryToBucket("Custom")).toBeNull();
    expect(categoryToBucket("Totally Made Up")).toBeNull();
  });

  it("returns null for empty / missing input", () => {
    expect(categoryToBucket("")).toBeNull();
    expect(categoryToBucket(undefined)).toBeNull();
    expect(categoryToBucket(null)).toBeNull();
  });

  it("only ever yields a value from the canonical bucket list", () => {
    for (const cat of ["World", "Markets", "Technology", "Sports", "Health", "Science", "Bitcoin"]) {
      const b = categoryToBucket(cat);
      expect(b).not.toBeNull();
      expect(NEWS_BUCKETS).toContain(b as NewsBucket);
    }
  });
});

describe("articleCategory", () => {
  const map = new Map<string, string>([
    ["https://zh/feed", "Markets"],
    ["https://verge/feed", "Technology"],
    ["https://colossal/feed", "Entertainment & Culture"],
  ]);

  it("resolves an item's source url → its feed's category → bucket", () => {
    expect(articleCategory({ source: { url: "https://zh/feed" } }, map)).toBe("Business");
    expect(articleCategory({ source: { url: "https://verge/feed" } }, map)).toBe("Tech");
  });

  it("returns null when the source's category maps to no bucket (Top-only)", () => {
    expect(articleCategory({ source: { url: "https://colossal/feed" } }, map)).toBeNull();
  });

  it("returns null for an unknown source url", () => {
    expect(articleCategory({ source: { url: "https://who/feed" } }, map)).toBeNull();
  });

  it("returns null when the item carries no source url", () => {
    expect(articleCategory({}, map)).toBeNull();
    expect(articleCategory({ source: {} }, map)).toBeNull();
    expect(articleCategory({ source: { url: "" } }, map)).toBeNull();
  });
});

describe("taxonomy ↔ rss-feeds coverage", () => {
  it("every curated feed category either maps to a bucket or is a deliberate Top-only category", () => {
    // Categories we intentionally leave unmapped (they appear only under Top).
    const TOP_ONLY = new Set([
      "Entertainment & Culture", "Longform", "Podcasts", "Podcast",
      // Dedicated podcast-library categories (Top-only so episodes stay out of the
      // news topic tabs). "Sports" and "Nostr" are omitted here because those two
      // reuse existing news categories that DO map to a bucket.
      "Interviews & Ideas", "Comedy", "Bitcoin & Crypto", "Business & Investing",
      "Science & Tech", "Health & Longevity", "Mind & Wellness", "News & Commentary",
      "True Crime & Curiosity", "Culture & Creativity",
    ]);
    const seen = new Set<string>();
    for (const f of [...DEFAULT_FEEDS, ...EXTRA_DEFAULT_FEEDS, ...SUGGESTED_FEEDS]) {
      if (seen.has(f.category)) continue;
      seen.add(f.category);
      const bucket = categoryToBucket(f.category);
      // Assert each real category is a conscious decision: mapped, or Top-only.
      expect(bucket !== null || TOP_ONLY.has(f.category)).toBe(true);
    }
  });
});

describe("labels", () => {
  it("has a label for every bucket", () => {
    for (const b of NEWS_BUCKETS) {
      expect(typeof NEWS_BUCKET_LABELS[b]).toBe("string");
      expect(NEWS_BUCKET_LABELS[b].length).toBeGreaterThan(0);
    }
  });
});
