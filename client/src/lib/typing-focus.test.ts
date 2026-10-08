// @vitest-environment jsdom
/**
 * While you type on a phone the bottom bar steps aside, as in native apps —
 * it rode up on the keyboard and covered the box you were typing in (owner,
 * 2026-10-07: stream chat, the reply box). What counts as typing is anything
 * that brings up the keyboard; a checkbox or a button does not.
 */
import { describe, it, expect } from "vitest";
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
