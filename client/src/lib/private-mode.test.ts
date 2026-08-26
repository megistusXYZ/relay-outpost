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
import { nextMaskedState } from "./private-mode";

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
