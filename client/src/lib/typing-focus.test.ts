// @vitest-environment jsdom
/**
 * While you type on a phone the bottom bar steps aside, as in native apps —
 * it rode up on the keyboard and covered the box you were typing in (owner,
 * 2026-10-07: stream chat, the reply box). What counts as typing is anything
 * that brings up the keyboard; a checkbox or a button does not.
 */
import { describe, it, expect, vi } from "vitest";
import { isTypingField } from "./typing-focus";

const el = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as Element;
};

describe("isTypingField", () => {
  it("text boxes bring up the keyboard", () => {
    expect(isTypingField(el("<textarea></textarea>"))).toBe(true);
    expect(isTypingField(el('<input type="text">'))).toBe(true);
    expect(isTypingField(el("<input>"))).toBe(true);
    expect(isTypingField(el('<input type="search">'))).toBe(true);
    expect(isTypingField(el('<input type="email">'))).toBe(true);
    expect(isTypingField(el('<div contenteditable="true"></div>'))).toBe(true);
  });
  it("switches, buttons and pickers do not", () => {
    expect(isTypingField(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingField(el('<input type="range">'))).toBe(false);
    expect(isTypingField(el('<input type="file">'))).toBe(false);
    expect(isTypingField(el("<button>Go</button>"))).toBe(false);
    expect(isTypingField(el("<select><option>a</option></select>"))).toBe(false);
  });
  it("a box you can't type in does not", () => {
    expect(isTypingField(el("<textarea readonly></textarea>"))).toBe(false);
    expect(isTypingField(el("<input disabled>"))).toBe(false);
    expect(isTypingField(null)).toBe(false);
  });
});

/**
 * The bar steps aside at once when typing starts, and comes back only after
 * the tap that ended typing has landed. Back at once, the page's bottom
 * spacing changed mid-tap and the tapped button moved away from the finger
 * (ops-publisher-e2e: "Sign" under a text box never signed, 2026-10-07).
 */
describe("useTyping timing", () => {
  it("hides at once on typing, returns only after BAR_RETURN_MS when focus moves to a button", async () => {
    if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = (await import("react")) as unknown as { act: (cb: () => void | Promise<void>) => Promise<void> };
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { useTyping, BAR_RETURN_MS } = await import("./typing-focus");
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const Probe = () => { seen.push(useTyping()); return null; };
    document.body.innerHTML = '<textarea id="t"></textarea><button id="b">Sign</button><div id="root"></div>';
    await act(async () => { createRoot(document.getElementById("root")!).render(createElement(Probe)); });
    await act(async () => { (document.getElementById("t") as HTMLTextAreaElement).focus(); });
    expect(seen.at(-1)).toBe(true);
    await act(async () => { (document.getElementById("b") as HTMLButtonElement).focus(); });
    await act(async () => { vi.advanceTimersByTime(BAR_RETURN_MS - 50); });
    expect(seen.at(-1)).toBe(true); // still out of the way while the tap lands
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(seen.at(-1)).toBe(false);
    vi.useRealTimers();
  });
});
