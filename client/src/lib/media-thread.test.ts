/**
 * Kind-aware commenting for media surfaces (lib/media-thread.ts).
 *
 * The images feed now carries TWO root kinds: kind-1 notes with images, and
 * NIP-68 kind-20 picture posts. They take different comment vocabularies —
 * kind-1 replies are kind-1 with NIP-10 e-tags; kind-20 comments are NIP-22
 * kind-1111 (what Olas and Amethyst publish and read). A composer that posted
 * kind-1 replies to a kind-20 would publish comments the author's own client
 * never shows — worse than no composer.
 *
 * Interop shape pinned here because it was measured in the wild, not assumed:
 * a top-level NIP-22 comment carries BOTH the uppercase root triple (E/K/P)
 * and the lowercase parent triple (e/k/p) pointing at the same event — the
 * parent of a top-level comment IS the root. Thread views key on the
 * lowercase set; omitting it files the comment under "no parent".
 */
import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import {
  buildMediaCommentTags,
  commentFiltersFor,
  commentKindFor,
  isCommentOn,
} from "./media-thread";

const KIND_COMMENT = 1111;

function mk(kind: number, tags: string[][] = [], id = "root-id", pubkey = "author-pk"): Event {
  return { id, pubkey, kind, tags, content: "", created_at: 1_700_000_000, sig: "" };
}

const tag = (tags: string[][], name: string) => tags.filter((t) => t[0] === name);

describe("commentKindFor", () => {
  it("kind-1 targets take kind-1 replies; kind-20 takes NIP-22 kind-1111", () => {
    expect(commentKindFor(mk(1))).toBe(1);
    expect(commentKindFor(mk(20))).toBe(KIND_COMMENT);
  });
});

describe("buildMediaCommentTags", () => {
  it("kind-20: carries the uppercase root triple AND the lowercase parent triple", () => {
    const tags = buildMediaCommentTags(mk(20), "wss://relay.example");
    expect(tag(tags, "E")[0]?.slice(0, 3)).toEqual(["E", "root-id", "wss://relay.example"]);
    expect(tag(tags, "K")[0]?.[1]).toBe("20");
    expect(tag(tags, "P")[0]?.[1]).toBe("author-pk");
    expect(tag(tags, "e")[0]?.slice(0, 3)).toEqual(["e", "root-id", "wss://relay.example"]);
    expect(tag(tags, "k")[0]?.[1]).toBe("20");
    expect(tag(tags, "p").some((t) => t[1] === "author-pk")).toBe(true);
  });

  it("kind-1: plain NIP-10 reply tags (root e-tag + author p-tag), no NIP-22 vocabulary", () => {
    const tags = buildMediaCommentTags(mk(1), "wss://relay.example");
    expect(tag(tags, "e")[0]?.[3]).toBe("root");
    expect(tag(tags, "p")[0]?.[1]).toBe("author-pk");
    expect(tag(tags, "E")).toHaveLength(0);
    expect(tag(tags, "K")).toHaveLength(0);
  });
});

describe("commentFiltersFor", () => {
  it("kind-1: one legacy #e filter", () => {
    const filters = commentFiltersFor(mk(1));
    expect(filters).toHaveLength(1);
    expect(filters[0].kinds).toEqual([1]);
    expect(filters[0]["#e"]).toEqual(["root-id"]);
  });

  it("kind-20: NIP-22 #E filter plus a legacy #e filter (clients that still reply in kind-1)", () => {
    const filters = commentFiltersFor(mk(20));
    expect(filters.some((f) => f.kinds?.includes(KIND_COMMENT) && f["#E"]?.[0] === "root-id")).toBe(true);
    expect(filters.some((f) => f["#e"]?.[0] === "root-id")).toBe(true);
  });
});

describe("isCommentOn", () => {
  it("matches kind-1 e-tag replies and kind-1111 E/e comments; rejects the rest", () => {
    expect(isCommentOn(mk(1, [["e", "root-id"]], "c1", "x"), "root-id")).toBe(true);
    expect(isCommentOn(mk(KIND_COMMENT, [["E", "root-id"]], "c2", "x"), "root-id")).toBe(true);
    expect(isCommentOn(mk(KIND_COMMENT, [["e", "root-id"]], "c3", "x"), "root-id")).toBe(true);
    expect(isCommentOn(mk(1, [["e", "other"]], "c4", "x"), "root-id")).toBe(false);
    // A reaction carries an e-tag at the same id — it is not a comment.
    expect(isCommentOn(mk(7, [["e", "root-id"]], "c5", "x"), "root-id")).toBe(false);
  });
});
