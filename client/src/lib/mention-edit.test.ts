/**
 * An @name in a text box is one thing (owner, 2026-10-07: "texting error when
 * deleting and retyping, spacing bug"). Each tagged name carries a few hidden
 * characters that remember who it is. Backspace used to eat them one at a
 * time — presses that seemed to do nothing — and deleting part-way left a
 * broken tag: "@Name" as plain text, stray invisible characters, odd gaps.
 * Now backspace takes the whole name at once, as in Slack and Discord, and
 * a name that gets cut into becomes plain text with nothing hidden left over.
 */
import { describe, it, expect } from "vitest";
import { backspaceMention, tidyMentions, snapOutOfMention } from "./mention-edit";

const ZWS = "​", ZWNJ = "‌";
const TOKEN = `${ZWS}${ZWNJ}${ZWS}${ZWNJ}`; // what use-mention.ts appends to a name
const DAWN = `@Dawn${TOKEN}`;

describe("backspace next to an @name", () => {
  it("right after the name, takes the whole name in one press", () => {
    const text = `hi ${DAWN}`;
    expect(backspaceMention(text, text.length)).toEqual({ text: "hi ", caret: 3 });
  });
  it("with words after it, takes only the name and keeps the rest", () => {
    const text = `${DAWN} 👋 see you`;
    expect(backspaceMention(text, DAWN.length)).toEqual({ text: " 👋 see you", caret: 0 });
  });
  it("with the caret among the hidden characters, still takes the whole name", () => {
    const text = `${DAWN} ok`;
    expect(backspaceMention(text, "@Dawn".length + 2)).toEqual({ text: " ok", caret: 0 });
  });
  it("after the space that follows a name, is an ordinary backspace", () => {
    const text = `${DAWN} `;
    expect(backspaceMention(text, text.length)).toBeNull();
  });
  it("anywhere else, is an ordinary backspace", () => {
    expect(backspaceMention("hello", 5)).toBeNull();
    expect(backspaceMention(`${DAWN} hello`, `${DAWN} hel`.length)).toBeNull();
  });
  it("works for names with spaces in them", () => {
    const text = `@TWENTY ONE Esports${TOKEN}`;
    expect(backspaceMention(text, text.length)).toEqual({ text: "", caret: 0 });
  });
});

describe("tidying a broken tag", () => {
  it("drops the hidden characters when an edit cuts into a name", () => {
    // "n" deleted out of "@Dawn": the tag is no longer the person tagged.
    const before = `${DAWN} hi`, after = `@Daw${TOKEN} hi`;
    expect(tidyMentions(before, after, "@Daw".length)).toEqual({ text: "@Daw hi", caret: "@Daw".length });
  });
  it("drops them when letters are typed into a name", () => {
    const before = `${DAWN} hi`, after = `@Dawxn${TOKEN} hi`;
    expect(tidyMentions(before, after, 5)).toEqual({ text: "@Dawxn hi", caret: 5 });
  });
  it("drops hidden characters left on their own", () => {
    const before = `${DAWN} hi`, after = `${TOKEN} hi`;
    expect(tidyMentions(before, after, TOKEN.length)).toEqual({ text: " hi", caret: 0 });
  });
  it("leaves whole tags alone, including one just added", () => {
    const text = `${DAWN} hi`;
    expect(tidyMentions(text, `${text}!`, 3)).toEqual({ text: `${text}!`, caret: 3 });
    expect(tidyMentions("hi ", `hi ${DAWN} `, 3)).toEqual({ text: `hi ${DAWN} `, caret: 3 });
  });
  it("leaves a lone zero-width non-joiner alone: Persian and other scripts use it", () => {
    const persian = "می\u200Cخواهم";
    expect(tidyMentions(persian, persian, 2)).toEqual({ text: persian, caret: 2 });
  });
});

describe("the caret never parks among the hidden characters", () => {
  it("moves to just after the name", () => {
    const text = `${DAWN} hi`;
    expect(snapOutOfMention(text, "@Dawn".length + 1)).toBe(DAWN.length);
    expect(snapOutOfMention(text, 2)).toBe(2); // inside the visible name: fine
    expect(snapOutOfMention(text, text.length)).toBe(text.length);
  });
  it("moving left (arrow key), steps over the hidden characters to the name, not back", () => {
    const text = `${DAWN} hi`;
    // From just after the tag, one step left lands among the hidden characters.
    expect(snapOutOfMention(text, DAWN.length - 1, DAWN.length)).toBe("@Dawn".length);
  });
});
