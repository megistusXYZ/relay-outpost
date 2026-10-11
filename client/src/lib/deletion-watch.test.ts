/**
 * Honouring everyone's deletions (owner, 2026-10-11): for the authors we
 * show, ask their deletions once, by author, and drop what they named. A
 * deletion only counts for the author's own events.
 */
import { describe, it, expect } from "vitest";
import { deletedIdsFrom, authorsToAsk } from "./deletion-watch";

const pk = "a".repeat(64);
const del = (author: string, tags: string[][]) => ({ id: "d".repeat(64), pubkey: author, kind: 5, created_at: 1, content: "", sig: "", tags });

describe("deletedIdsFrom", () => {
  it("names the event ids a deletion carries", () => {
    expect(deletedIdsFrom(del(pk, [["e", "1".repeat(64)], ["e", "2".repeat(64)], ["k", "1"]]))).toEqual(["1".repeat(64), "2".repeat(64)]);
  });
  it("ignores anything that is not a deletion, and malformed ids", () => {
    expect(deletedIdsFrom({ ...del(pk, [["e", "1".repeat(64)]]), kind: 1 })).toEqual([]);
    expect(deletedIdsFrom(del(pk, [["e", "not-an-id"], ["a", "30023:x:y"]]))).toEqual([]);
  });
});

describe("authorsToAsk", () => {
  it("asks each author once, however many of their posts we show", () => {
    const seen = new Set<string>();
    expect(authorsToAsk(seen, [pk, pk, "b".repeat(64)])).toEqual([pk, "b".repeat(64)]);
    expect(authorsToAsk(seen, [pk, "c".repeat(64)])).toEqual(["c".repeat(64)]);
    expect(seen.size).toBe(3);
  });
  it("skips malformed keys", () => {
    expect(authorsToAsk(new Set(), ["npub1notakey", ""])).toEqual([]);
  });
});
