import { describe, it, expect } from "vitest";
import { quotesItsParent } from "./quote-reply";

const PARENT = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("quotesItsParent — the same note, drawn twice", () => {
  it("catches a post that replies to a note and quotes that same note", () => {
    // The live report: three blocks in one post — a context preview of HODL's
    // note, then a quote card of HODL's note, and the author's own words
    // nowhere, because the quote WAS the post.
    expect(quotesItsParent(PARENT, [PARENT])).toBe(true);
  });

  it("leaves a reply that quotes a DIFFERENT note alone", () => {
    // The case a naive fix breaks. "Does this post have any quote cards?" would
    // hide the context preview here, and replying to one person while quoting
    // someone else is an ordinary thing to do — both belong on screen.
    expect(quotesItsParent(PARENT, [OTHER])).toBe(false);
  });

  it("finds the parent among several quotes", () => {
    expect(quotesItsParent(PARENT, [OTHER, PARENT])).toBe(true);
  });

  it("says no for a post that is not a reply at all", () => {
    expect(quotesItsParent(null, [PARENT])).toBe(false);
    expect(quotesItsParent(undefined, [PARENT])).toBe(false);
    expect(quotesItsParent("", [PARENT])).toBe(false);
  });

  it("says no for a reply that quotes nothing", () => {
    expect(quotesItsParent(PARENT, [])).toBe(false);
  });

  it("ignores refs with no id rather than matching them", () => {
    // Address refs (naddr) carry a coordinate, not an event id, and arrive in
    // the same list with `id` undefined. An undefined must never collide with
    // an absent parent and silently suppress context.
    expect(quotesItsParent(PARENT, [undefined, undefined])).toBe(false);
  });
});
