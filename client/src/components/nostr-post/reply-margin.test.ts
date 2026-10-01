import { describe, it, expect } from "vitest";
import { contextGoesToMargin } from "./reply-margin";

const el = {} as HTMLElement;

describe("contextGoesToMargin", () => {
  it("a reply in a row with a margin sends its context there", () => {
    expect(contextGoesToMargin({ eventId: "a", el }, "a", true, false)).toBe(true);
  });

  it("no margin (other surfaces, narrower screens): context stays in the card", () => {
    expect(contextGoesToMargin(null, "a", true, false)).toBe(false);
    expect(contextGoesToMargin({ eventId: "a", el: null }, "a", true, false)).toBe(false);
  });

  it("only the row's own post uses the slot, never a post nested inside it", () => {
    expect(contextGoesToMargin({ eventId: "a", el }, "quoted-inside-a", true, false)).toBe(false);
  });

  it("a post that is not a reply has no context to move", () => {
    expect(contextGoesToMargin({ eventId: "a", el }, "a", false, false)).toBe(false);
  });

  it("a reply that already quotes its parent shows it once, in the card", () => {
    expect(contextGoesToMargin({ eventId: "a", el }, "a", true, true)).toBe(false);
  });
});

describe("margin notes wiring", () => {
  // The rule above is pure; these pin where a browser check found it had to be.
  const read = async (rel: string) => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    return readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
  };

  it("the post moves its existing context to the slot and stops drawing it inline", async () => {
    const post = await read("../NostrPost.tsx");
    expect(post).toMatch(/const inMargin = !compact && contextGoesToMargin\(marginSlot, event\.id, isReply, parentIsQuoted\);/);
    expect(post).toMatch(/\{inMargin && marginSlot\?\.el && !\(parentNotFound && replyContextOn\) && createPortal\(/);
    expect(post).toMatch(/isReply && !parentIsQuoted && showParentPost && !inMargin &&/);
    expect(post).toMatch(/isReply && !parentIsQuoted && !replyContextOn && !inMargin &&/);
  });

  it("the margin respects the reply-context setting: off shows who is answered and a Show context tap, like the card", async () => {
    const post = await read("../NostrPost.tsx");
    const start = post.indexOf("{inMargin && marginSlot?.el && ");
    const block = post.slice(start, post.indexOf("marginSlot.el,", start));
    expect(block).toMatch(/\{!replyContextOn && \(\s*<button[\s\S]*?onClick=\{handleShowParent\}/);
    expect(block).toMatch(/\{showParentPost \? "Hide context" : "Show context"\}/);
    expect(block).toMatch(/\{!showParentPost \? null : parentEvent \? \(/);
  });

  it("in the margin the note is a real card with readable secondary text (light mode measured 2.5–3:1 before)", async () => {
    const post = await read("../NostrPost.tsx");
    const thread = await read("./thread.tsx");
    const start = post.indexOf("{inMargin && marginSlot?.el && ");
    const block = post.slice(start, post.indexOf("marginSlot.el,", start));
    expect(block).toContain('<ParentPostPreview event={parentEvent} variant="note" />');
    expect(block).not.toMatch(/text-muted-foreground\/\d/); // no faded secondary text on the page background
    expect(thread).toMatch(/variant === "note"\s*\? "rounded-lg bg-card border border-border\/60/);
    expect(thread).toMatch(/variant === "note" \? "text-muted-foreground" : "text-muted-foreground\/60"/);
  });

  it("the profile stream gives each row a slot level with its post, clipped to the row, only when there is a margin", async () => {
    const main = await read("../profile/IdentityProfileMain.tsx");
    expect(main).toMatch(/el: hasMargin \? slot : null/);
    expect(main).toMatch(/\{hasMargin && \(\s*<aside\s+ref=\{setSlot\}\s+className="absolute top-1 bottom-0 left-full ml-5 w-\[280px\] 2xl:w-\[300px\] overflow-hidden"/);
  });

  it("the layout keeps room for the margin from 1440px", async () => {
    const layout = await read("../profile/IdentityProfileLayout.tsx");
    expect(layout).toContain("min-[1440px]:grid-cols-[320px_minmax(0,680px)_280px] 2xl:grid-cols-[380px_minmax(0,680px)_300px]");
  });
});
