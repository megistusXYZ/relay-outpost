import { describe, it, expect } from "vitest";
import { rankTopics } from "./IdentityPresence";

const ev = (content: string, tags: string[][] = []) => ({ content, tags });

describe("rankTopics", () => {
  it("returns nothing when there are no hashtags (graceful fade)", () => {
    expect(rankTopics([ev("just a plain note"), ev("another one")])).toEqual([]);
  });

  it("ignores one-off tags — a topic must recur across ≥2 posts", () => {
    expect(rankTopics([ev("hello #bitcoin"), ev("world")])).toEqual([]);
  });

  it("surfaces a hashtag that recurs across posts", () => {
    const out = rankTopics([ev("gm #bitcoin"), ev("wagmi #bitcoin"), ev("plain")]);
    expect(out).toEqual(["bitcoin"]);
  });

  it("does NOT let a single post satisfy ≥2 via both inline and t-tag", () => {
    // One post carries #nostr inline AND as a t-tag — that's still ONE post.
    expect(rankTopics([ev("hi #nostr", [["t", "nostr"]])])).toEqual([]);
  });

  it("counts an inline+t-tag post once, so two such posts make a topic", () => {
    const out = rankTopics([
      ev("hi #nostr", [["t", "nostr"]]),
      ev("yo #nostr", [["t", "nostr"]]),
    ]);
    expect(out).toEqual(["nostr"]);
  });

  it("ranks by frequency, most-used first, and caps the list", () => {
    const notes = [
      ev("#aa #bb"), ev("#aa #bb"), ev("#aa #bb"), // aa,bb each 3
      ev("#cc"), ev("#cc"),                        // cc 2
      ev("#dd"), ev("#dd"),                        // dd 2
      ev("#ee"), ev("#ee"),                        // ee 2
    ];
    // aa,bb (3) rank above cc,dd,ee (2); cap of 4 drops one of the 2-counts.
    const out = rankTopics(notes, 4);
    expect(out.slice(0, 2).sort()).toEqual(["aa", "bb"]);
    expect(out).toHaveLength(4);
  });

  it("normalizes case and the leading # from t-tags", () => {
    const out = rankTopics([ev("x", [["t", "#Bitcoin"]]), ev("y", [["t", "BITCOIN"]])]);
    expect(out).toEqual(["bitcoin"]);
  });

  it("skips junk tags (too short, too long, non-word)", () => {
    const long = "a".repeat(40);
    const out = rankTopics([
      ev(`#a #${long} #good-tag? #ok_tag`),
      ev(`#a #${long} #good-tag? #ok_tag`),
    ]);
    // '#a' too short; the 40-char tag too long; 'good-tag?' has punctuation
    // (the inline regex stops at '-', so 'good' is captured instead). ok_tag is valid.
    expect(out).toContain("ok_tag");
    expect(out).not.toContain(long);
  });
});
