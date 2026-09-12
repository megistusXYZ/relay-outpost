/**
 * Private mode's re-arm rule. The grilled contract (2026-08-14):
 *
 *  - With the setting ON, Chats OPENS masked and RE-ARMS when the app
 *    backgrounds — the screen-share moment is "I switched apps".
 *  - Without the setting, the eye is a session control: an ad-hoc mask (or
 *    reveal) survives a stray tab switch — nothing re-arms what you didn't
 *    ask to be standing.
 *  - The eye always flips the current state.
 */
import { describe, it, expect } from "vitest";
import { nextMaskedState, maskChips } from "./private-mode";

describe("nextMaskedState", () => {
  it("opens masked iff the standing setting is on", () => {
    expect(nextMaskedState("open", false, true)).toBe(true);
    expect(nextMaskedState("open", true, false)).toBe(false);
  });

  it("re-arms on background ONLY with the standing setting", () => {
    // Setting on, previously revealed → backgrounding re-masks.
    expect(nextMaskedState("hidden", false, true)).toBe(true);
    // No setting: an ad-hoc reveal is not undone by a tab switch…
    expect(nextMaskedState("hidden", false, false)).toBe(false);
    // …and an ad-hoc mask is not dropped by one either.
    expect(nextMaskedState("hidden", true, false)).toBe(true);
  });

  it("the eye flips regardless of the setting", () => {
    expect(nextMaskedState("toggle", true, true)).toBe(false);
    expect(nextMaskedState("toggle", false, false)).toBe(true);
  });
});

/**
 * Owner (2026-09-12): the 6px blur was see-through — avatars, colours,
 * verified dots and row shapes all read through it — and the chips above it
 * still said "People 9, Communities 16". Masked must be unrecognisable: the
 * list isn't drawn at all (a branded panel stands in), and the chips say how
 * many of nothing.
 */
describe("what a masked chat list still says", () => {
  const chips = [
    { key: "all", label: "All", count: 26, unread: 1 },
    { key: "people", label: "People", count: 9, unread: 0 },
  ];

  it("the filter chips keep their names but say nothing about how many or what's waiting", () => {
    expect(maskChips(chips, true)).toEqual([
      { key: "all", label: "All", count: null, unread: 0 },
      { key: "people", label: "People", count: null, unread: 0 },
    ]);
  });

  it("unmasked, the chips are left exactly as they were", () => {
    expect(maskChips(chips, false)).toBe(chips);
  });
});
