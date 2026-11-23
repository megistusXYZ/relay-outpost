/**
 * Whether the footer's Relay mark is really on screen, so a bottom sheet may
 * open out of it. A mark that has stepped aside (a chat thread, the keyboard)
 * is still in the page, faded and moved below the screen: a sheet must not
 * grow out of a spot nobody can see.
 */
import { describe, it, expect } from "vitest";
import { markIsOnScreen } from "./mark-sheet";

const VH = 844;
describe("markIsOnScreen", () => {
  it("at rest above the menu, or folded into the corner: on screen", () => {
    expect(markIsOnScreen({ opacity: 1, visibility: "visible", top: 682, bottom: 740, width: 58 }, VH)).toBe(true);
    expect(markIsOnScreen({ opacity: 1, visibility: "visible", top: 770, bottom: 828, width: 58 }, VH)).toBe(true);
  });
  it("stepped aside for a chat or the keyboard (faded, slid below): not on screen", () => {
    expect(markIsOnScreen({ opacity: 0, visibility: "visible", top: 740, bottom: 798, width: 58 }, VH)).toBe(false);
    expect(markIsOnScreen({ opacity: 1, visibility: "visible", top: 850, bottom: 908, width: 58 }, VH)).toBe(false);
  });
  it("hidden because another sheet already holds it, or not laid out at all: not on screen", () => {
    expect(markIsOnScreen({ opacity: 1, visibility: "hidden", top: 682, bottom: 740, width: 58 }, VH)).toBe(false);
    expect(markIsOnScreen({ opacity: 1, visibility: "visible", top: 0, bottom: 0, width: 0 }, VH)).toBe(false);
  });
});
