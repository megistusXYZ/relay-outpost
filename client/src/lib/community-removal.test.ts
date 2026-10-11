/**
 * Removing a post from a community (owner, 2026-10-11): an admin's removal is
 * the relay's fact, never the author's doing. It gets a confirmation that
 * says so, a log entry, a placeholder only where replies hang off it, and a
 * private note to the author from the admin's account.
 */
import { describe, it, expect } from "vitest";
import { removalWords, removalNotice, REMOVED_BY_COMMUNITY } from "./community-removal";

describe("removalWords", () => {
  it("a post, in the community's name, and says the author will hear", () => {
    expect(removalWords("post", "Night Market")).toEqual({
      title: "Remove from Night Market?",
      description: "This removes it from Night Market. The author gets a private message saying so.",
      confirmLabel: "Remove",
    });
  });
  it("a comment and a topic use the same shape", () => {
    expect(removalWords("comment", "Night Market").title).toBe("Remove from Night Market?");
    expect(removalWords("topic", "Night Market").confirmLabel).toBe("Remove");
  });
  it("banning an author keeps its own words", () => {
    expect(removalWords("ban", "Night Market")).toEqual({
      title: "Ban this person from Night Market?",
      description: "Their posts are removed from Night Market and they can't post here again.",
      confirmLabel: "Ban",
    });
  });
});

describe("removalNotice", () => {
  it("tells the author plainly, from the admin's account", () => {
    expect(removalNotice("Night Market")).toBe("Your post was removed from Night Market by a community admin.");
  });
});

it("the placeholder names the community, not the author", () => {
  expect(REMOVED_BY_COMMUNITY).toBe("Removed by the community");
});
