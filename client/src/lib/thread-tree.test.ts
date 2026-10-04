import { describe, it, expect } from "vitest";
import {
  MOBILE_THREAD_INDENT_CAP,
  DESKTOP_THREAD_INDENT_CAP,
  SIBLING_OVERFLOW_LIMIT,
  BRANCH_CONTINUE_EXTRA,
  getThreadIndentCap,
  partitionSiblings,
  shouldContinueThread,
  rendersIndentColumn,
  isBeyondIndentCap,
} from "./thread-tree";

describe("getThreadIndentCap", () => {
  it("caps at 2 levels on narrow viewports", () => {
    expect(getThreadIndentCap(true)).toBe(MOBILE_THREAD_INDENT_CAP);
    expect(MOBILE_THREAD_INDENT_CAP).toBe(2);
  });

  it("caps at 5 levels on desktop", () => {
    expect(getThreadIndentCap(false)).toBe(DESKTOP_THREAD_INDENT_CAP);
    expect(DESKTOP_THREAD_INDENT_CAP).toBe(5);
  });
});

describe("partitionSiblings", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

  it("keeps levels at or under the limit fully visible (no overflow row)", () => {
    expect(partitionSiblings(items(8))).toEqual({ visible: items(8), overflow: [] });
    expect(partitionSiblings(items(1)).overflow).toHaveLength(0);
    expect(partitionSiblings([]).visible).toHaveLength(0);
  });

  it("folds everything past the first 8 into overflow", () => {
    const { visible, overflow } = partitionSiblings(items(9));
    expect(visible).toEqual(items(9).slice(0, 8));
    expect(overflow).toEqual(["r8"]);
  });

  it("preserves order and loses nothing", () => {
    const { visible, overflow } = partitionSiblings(items(23));
    expect(visible).toHaveLength(SIBLING_OVERFLOW_LIMIT);
    expect(overflow).toHaveLength(23 - SIBLING_OVERFLOW_LIMIT);
    expect([...visible, ...overflow]).toEqual(items(23));
  });

  it("honors a custom limit", () => {
    const { visible, overflow } = partitionSiblings(items(5), 3);
    expect(visible).toEqual(["r0", "r1", "r2"]);
    expect(overflow).toEqual(["r3", "r4"]);
  });
});

describe("shouldContinueThread (branch cutoff)", () => {
  const mobileCutoff = MOBILE_THREAD_INDENT_CAP + BRANCH_CONTINUE_EXTRA; // 6
  const desktopCutoff = DESKTOP_THREAD_INDENT_CAP + BRANCH_CONTINUE_EXTRA; // 9

  it("never cuts off a leaf", () => {
    expect(shouldContinueThread(mobileCutoff + 5, MOBILE_THREAD_INDENT_CAP, false)).toBe(false);
  });

  it("renders branches inline up to cap+4 levels", () => {
    expect(shouldContinueThread(0, MOBILE_THREAD_INDENT_CAP, true)).toBe(false);
    expect(shouldContinueThread(mobileCutoff - 1, MOBILE_THREAD_INDENT_CAP, true)).toBe(false);
    expect(shouldContinueThread(desktopCutoff - 1, DESKTOP_THREAD_INDENT_CAP, true)).toBe(false);
  });

  it("re-roots branches that extend beyond cap+4 levels", () => {
    expect(shouldContinueThread(mobileCutoff, MOBILE_THREAD_INDENT_CAP, true)).toBe(true);
    expect(shouldContinueThread(mobileCutoff + 1, MOBILE_THREAD_INDENT_CAP, true)).toBe(true);
    expect(shouldContinueThread(desktopCutoff, DESKTOP_THREAD_INDENT_CAP, true)).toBe(true);
  });
});

describe("rendersIndentColumn / isBeyondIndentCap", () => {
  it("rails exist only within the cap (max 2 stacked on mobile)", () => {
    expect(rendersIndentColumn(0, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(1, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(2, MOBILE_THREAD_INDENT_CAP)).toBe(false);
    expect(rendersIndentColumn(10, MOBILE_THREAD_INDENT_CAP)).toBe(false);
  });

  it("desktop rails stop after 5 levels", () => {
    expect(rendersIndentColumn(4, DESKTOP_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(5, DESKTOP_THREAD_INDENT_CAP)).toBe(false);
  });

  it("the ↳ parent cue turns on exactly where the indent clamps", () => {
    expect(isBeyondIndentCap(1, MOBILE_THREAD_INDENT_CAP)).toBe(false);
    expect(isBeyondIndentCap(2, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(isBeyondIndentCap(4, DESKTOP_THREAD_INDENT_CAP)).toBe(false);
    expect(isBeyondIndentCap(5, DESKTOP_THREAD_INDENT_CAP)).toBe(true);
  });
});

// ---- Replying (owner, 2026-10-04: "it puts it in a funky spot") ----
// A conversation reads post → replies → the box, so what you send lands right
// above where you wrote it.
import { buildThreadTree, replyBoxPlacement } from "./thread-tree";

describe("replyBoxPlacement", () => {
  it("puts the box after the replies when they read oldest first — a new reply lands just above it", () => {
    expect(replyBoxPlacement("oldest")).toBe("after");
  });
  it("puts it before them when newest is first, which is where a new reply lands", () => {
    expect(replyBoxPlacement("newest")).toBe("before");
  });
});

describe("buildThreadTree — where a new reply goes", () => {
  const ROOT = "r".repeat(64);
  const ev = (id: string, at: number, parent?: string) => ({
    id, created_at: at, pubkey: "p", kind: 1, content: "", sig: "",
    tags: parent ? [["e", ROOT, "", "root"], ["e", parent, "", "reply"]] : [["e", ROOT, "", "root"]],
  });
  const bob = ev("b", 10), carol = ev("c", 20), carolToBob = ev("cb", 30, "b");

  it("a reply to a comment goes under that comment, after the replies it already had", () => {
    const mine = ev("mine", 40, "b");
    const tree = buildThreadTree([bob, carol, carolToBob, mine], ROOT);
    expect(tree.map((n) => n.event.id)).toEqual(["b", "c"]);
    expect(tree[0].children.map((n) => n.event.id)).toEqual(["cb", "mine"]);
  });

  it("a reply to the post goes last among the post's replies", () => {
    const mine = ev("mine", 40);
    expect(buildThreadTree([mine, bob, carol], ROOT).map((n) => n.event.id)).toEqual(["b", "c", "mine"]);
  });

  it("a reply to something not in the thread is shown as a reply to the post, not dropped", () => {
    expect(buildThreadTree([ev("x", 5, "gone")], ROOT).map((n) => n.event.id)).toEqual(["x"]);
  });
});

describe("partitionSiblings — the reply you just sent is never folded away", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it("keeps a kept item visible even past the limit, in its place", () => {
    const { visible, overflow } = partitionSiblings(items(10), 8, (x) => x === 10);
    expect(visible).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(overflow).toEqual([9]);
  });
  it("changes nothing when the kept item is already showing", () => {
    expect(partitionSiblings(items(10), 8, (x) => x === 2)).toEqual({ visible: items(8), overflow: [9, 10] });
  });
});
