/**
 * A note or comment answering a long-form article (kind 30023) should say so:
 * the feed shows the article on top of it, and treats a top-level comment on
 * an article as a post (it is commentary people want seen), while a reply to
 * another comment stays a reply.
 */
import { describe, it, expect } from "vitest";
import { articleReplyTarget, isTopLevelArticleComment, feedKeepsComment } from "./article-reply";

const PK = "a".repeat(64);
const ME = "b".repeat(64);
const FRIEND = "c".repeat(64);
const ART = `30023:${PK}:my-essay`;
const ART_ID = "d".repeat(64);

describe("articleReplyTarget", () => {
  it("reads a note's a-tag to an article", () => {
    expect(articleReplyTarget({ kind: 1, tags: [["a", ART, "wss://r.example"], ["p", PK]] })).toEqual({ pubkey: PK, identifier: "my-essay", relay: "wss://r.example" });
  });

  it("keeps colons inside the article's identifier", () => {
    expect(articleReplyTarget({ kind: 1, tags: [["a", `30023:${PK}:2026:notes`]] })?.identifier).toBe("2026:notes");
  });

  it("reads a NIP-22 comment's root scope (A)", () => {
    expect(articleReplyTarget({ kind: 1111, tags: [["A", ART], ["K", "30023"], ["a", ART], ["k", "30023"]] })?.identifier).toBe("my-essay");
  });

  it("ignores mentions, other addressable kinds, and malformed coordinates", () => {
    expect(articleReplyTarget({ kind: 1, tags: [["a", ART, "", "mention"]] })).toBeNull();
    expect(articleReplyTarget({ kind: 1, tags: [["a", `30311:${PK}:live`]] })).toBeNull();
    expect(articleReplyTarget({ kind: 1, tags: [["a", "30023:nothex:x"]] })).toBeNull();
    expect(articleReplyTarget({ kind: 1, tags: [] })).toBeNull();
  });
});

describe("isTopLevelArticleComment", () => {
  it("a note answering only the article is top level, with or without the article's event tag", () => {
    expect(isTopLevelArticleComment({ kind: 1, tags: [["a", ART]] })).toBe(true);
    expect(isTopLevelArticleComment({ kind: 1, tags: [["e", ART_ID, "", "root"], ["a", ART], ["p", PK]] })).toBe(true);
  });

  it("a note answering a comment under the article is a reply", () => {
    expect(isTopLevelArticleComment({ kind: 1, tags: [["e", ART_ID, "", "root"], ["e", "f".repeat(64), "", "reply"], ["a", ART]] })).toBe(false);
  });

  it("a NIP-22 comment whose parent is the article is top level; one under a comment is not", () => {
    expect(isTopLevelArticleComment({ kind: 1111, tags: [["A", ART], ["K", "30023"], ["a", ART], ["k", "30023"]] })).toBe(true);
    expect(isTopLevelArticleComment({ kind: 1111, tags: [["A", ART], ["K", "30023"], ["e", "f".repeat(64)], ["k", "1111"]] })).toBe(false);
  });

  it("anything not about an article is not", () => {
    expect(isTopLevelArticleComment({ kind: 1, tags: [["e", ART_ID]] })).toBe(false);
  });
});

describe("feedKeepsComment", () => {
  const follows = new Set([FRIEND]);
  const comment = (pubkey: string, top = true) => ({ kind: 1111, pubkey, tags: top ? [["A", ART], ["K", "30023"], ["a", ART], ["k", "30023"]] : [["A", ART], ["e", "f".repeat(64)], ["k", "1111"]] });

  it("keeps article comments from people you follow, and your own", () => {
    expect(feedKeepsComment(comment(FRIEND), follows, ME)).toBe(true);
    expect(feedKeepsComment(comment(ME), follows, ME)).toBe(true);
  });

  it("drops strangers' comments and comments on comments", () => {
    expect(feedKeepsComment(comment(PK), follows, ME)).toBe(false);
    expect(feedKeepsComment(comment(FRIEND, false), follows, ME)).toBe(false);
  });

  it("leaves every other kind to the feed's own rules", () => {
    expect(feedKeepsComment({ kind: 1, pubkey: PK, tags: [] }, follows, ME)).toBe(true);
  });
});
