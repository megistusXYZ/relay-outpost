/**
 * Only the author's own deletion counts (owner QA, 2026-10-12: blank rows in
 * threads). A properly signed deletion by someone else naming your post must
 * change nothing, so the set remembers WHO deleted and answers only for the
 * matching author.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { markDeleted, isDeletedBy, deletedBy, _resetDeletedEvents } from "./deleted-events";

const ID = "e".repeat(64), OTIS = "a".repeat(64), MALLORY = "b".repeat(64);

describe("deleted events remember who deleted", () => {
  beforeEach(() => _resetDeletedEvents());
  it("the author's own deletion hides their post", () => {
    markDeleted(ID, OTIS);
    expect(isDeletedBy(ID, OTIS)).toBe(true);
  });
  it("someone else's deletion naming the post does not", () => {
    markDeleted(ID, MALLORY);
    expect(isDeletedBy(ID, OTIS)).toBe(false);
    expect(deletedBy(ID)).toBe(MALLORY);
  });
  it("the author's deletion is not undone by a later stranger's", () => {
    markDeleted(ID, OTIS);
    markDeleted(ID, MALLORY);
    expect(isDeletedBy(ID, OTIS)).toBe(true);
  });
});
