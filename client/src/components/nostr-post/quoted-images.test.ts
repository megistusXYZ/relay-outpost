import { describe, it, expect } from "vitest";
import { quotedImageUrls } from "./quoted-images";

describe("quotedImageUrls — the pictures a quoted post shows", () => {
  it("the same link pasted twice is one picture (it was two tiles with one key)", () => {
    const url = "https://nostr.download/3e4f.jpg";
    expect(quotedImageUrls(`look ${url}\n${url}`)).toEqual([url]);
  });

  it("different pictures keep their order", () => {
    expect(quotedImageUrls("https://a.test/1.png then https://a.test/2.webp")).toEqual(["https://a.test/1.png", "https://a.test/2.webp"]);
  });

  it("four at most — counted after repeats are dropped, so a repeat can't cost a real picture its place", () => {
    const u = (n: number) => `https://a.test/${n}.jpg`;
    expect(quotedImageUrls([u(1), u(1), u(2), u(3), u(4), u(5)].join(" "))).toEqual([u(1), u(2), u(3), u(4)]);
  });

  it("the same picture with a different query is a different link", () => {
    expect(quotedImageUrls("https://a.test/1.jpg?w=1 https://a.test/1.jpg?w=2")).toHaveLength(2);
  });

  it("no pictures, no list", () => {
    expect(quotedImageUrls("just words https://example.com/page")).toEqual([]);
  });

  it("the quoted-post card uses it", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const post = readFileSync(path.resolve(import.meta.dirname, "../NostrPost.tsx"), "utf8");
    expect(post).toMatch(/const imageUrls = quotedImageUrls\(fetchedEvent\.content\);/);
  });
});
