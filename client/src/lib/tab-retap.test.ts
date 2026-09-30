// @vitest-environment jsdom
/**
 * A second tap on a footer tab can ask the page it's on to do something
 * (owner, 2026-09-30): Discover puts you in its search box, Chats and
 * Activity take you to the first unread. The footer doesn't know how each
 * page does that, so it says what was tapped and the page answers.
 *
 * The page must be told in the same instant as the tap: iOS only opens the
 * keyboard for a focus() made while the tap is still being handled.
 */
import { describe, it, expect, vi } from "vitest";
import { emitTabRetap, onTabRetap } from "./tab-retap";
import { isPageAtTop } from "./scroll-root";

describe("tab re-tap messages", () => {
  it("the page hears it before emit returns (iOS keyboard needs the tap still in hand)", () => {
    const heard: string[] = [];
    const off = onTabRetap("discover", "focus-search", () => heard.push("focus"));
    emitTabRetap("discover", "focus-search");
    expect(heard).toEqual(["focus"]);
    off();
  });

  it("only the page for that tab and that action hears it", () => {
    const discover = vi.fn(), chats = vi.fn(), activity = vi.fn();
    const offs = [
      onTabRetap("discover", "focus-search", discover),
      onTabRetap("chats", "first-unread", chats),
      onTabRetap("activity", "first-unread", activity),
    ];
    emitTabRetap("chats", "first-unread");
    expect(chats).toHaveBeenCalledTimes(1);
    expect(discover).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
    offs.forEach((off) => off());
  });

  it("a page that has gone stops hearing", () => {
    const handler = vi.fn();
    const off = onTabRetap("chats", "first-unread", handler);
    off();
    emitTabRetap("chats", "first-unread");
    expect(handler).not.toHaveBeenCalled();
  });

  it("nobody listening is fine", () => {
    expect(() => emitTabRetap("activity", "first-unread")).not.toThrow();
  });
});

describe("isPageAtTop — is there anything to scroll back up?", () => {
  const page = (html: string) => {
    document.body.innerHTML = `<main>${html}</main>`;
    return document.querySelector("main")!;
  };

  it("a page nobody has scrolled is at the top", () => {
    expect(isPageAtTop(page("<div class='overflow-y-auto'></div>"))).toBe(true);
  });

  it("a scrolled page is not", () => {
    const main = page("");
    main.scrollTop = 240;
    expect(isPageAtTop(main)).toBe(false);
  });

  it("a page whose own inner scroller is scrolled is not (a profile has one)", () => {
    const main = page("<div class='overflow-y-auto' id='inner'></div>");
    (main.querySelector("#inner") as HTMLElement).scrollTop = 80;
    expect(isPageAtTop(main)).toBe(false);
  });

  it("the kept-alive Home layer, frozen at its Back position, doesn't count", () => {
    const main = page("<div inert><div class='overflow-y-auto' id='frozen'></div></div>");
    (main.querySelector("#frozen") as HTMLElement).scrollTop = 900;
    expect(isPageAtTop(main)).toBe(true);
  });

  it("no page at all counts as at the top", () => {
    expect(isPageAtTop(null)).toBe(true);
  });
});
