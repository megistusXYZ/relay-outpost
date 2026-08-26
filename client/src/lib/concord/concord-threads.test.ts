import { describe, it, expect } from "vitest";
import { groupThreads, type ThreadableMsg } from "./concord-threads";

const m = (id: string, pubkey: string, t: number, rootId?: string): ThreadableMsg => ({ id, pubkey, t, rootId });

describe("groupThreads — flat NIP-22 threading (group by root E)", () => {
  it("returns everything in the timeline when there are no replies", () => {
    const msgs = [m("a", "A", 1), m("b", "B", 2)];
    const { timeline, threads, meta } = groupThreads(msgs);
    expect(timeline.map((x) => x.id)).toEqual(["a", "b"]);
    expect(threads.size).toBe(0);
    expect(meta.size).toBe(0);
  });

  it("pulls replies out of the timeline and groups them under their root", () => {
    const msgs = [
      m("root", "A", 1),
      m("plain", "B", 2),
      m("r1", "B", 3, "root"),
      m("r2", "C", 4, "root"),
    ];
    const { timeline, threads, meta } = groupThreads(msgs);
    // root + plain stay; the two replies are pulled into the thread.
    expect(timeline.map((x) => x.id)).toEqual(["root", "plain"]);
    expect(threads.get("root")!.map((x) => x.id)).toEqual(["r1", "r2"]);
    expect(meta.get("root")).toEqual({ count: 2, repliers: ["B", "C"] });
  });

  it("sorts a thread's replies chronologically regardless of input order", () => {
    const msgs = [m("root", "A", 1), m("late", "B", 9, "root"), m("early", "C", 3, "root")];
    expect(groupThreads(msgs).threads.get("root")!.map((x) => x.id)).toEqual(["early", "late"]);
  });

  it("dedups repliers for the facepile (distinct, first-seen order)", () => {
    const msgs = [
      m("root", "A", 1),
      m("r1", "B", 2, "root"),
      m("r2", "B", 3, "root"),
      m("r3", "C", 4, "root"),
    ];
    expect(groupThreads(msgs).meta.get("root")).toEqual({ count: 3, repliers: ["B", "C"] });
  });

  it("FALLBACK: a reply whose root is not in this channel stays inline (never lost)", () => {
    // r1's root 'ghost' isn't among the messages — it must remain in the timeline.
    const msgs = [m("a", "A", 1), m("r1", "B", 2, "ghost")];
    const { timeline, threads } = groupThreads(msgs);
    expect(timeline.map((x) => x.id)).toEqual(["a", "r1"]);
    expect(threads.size).toBe(0);
  });

  it("ignores a self-referential root (id === rootId) — treats it as a plain message", () => {
    const msgs = [m("a", "A", 1, "a")];
    const { timeline, threads } = groupThreads(msgs);
    expect(timeline.map((x) => x.id)).toEqual(["a"]);
    expect(threads.size).toBe(0);
  });

  it("FLATTENS a reply-to-a-reply into the top-level thread (never a hidden sub-thread)", () => {
    // r1 replies to root; r2 replies to r1, so its own root pointer is r1. If we
    // took that literally, r2 would hang off a starter that is itself buried
    // inside root's thread — invisible from the channel. It must flatten to root.
    const msgs = [m("root", "A", 1), m("r1", "B", 2, "root"), m("r2", "C", 3, "r1")];
    const { timeline, threads, meta } = groupThreads(msgs);
    expect(timeline.map((x) => x.id)).toEqual(["root"]);
    expect(threads.get("root")!.map((x) => x.id)).toEqual(["r1", "r2"]);
    expect(threads.has("r1")).toBe(false);
    expect(meta.get("root")).toEqual({ count: 2, repliers: ["B", "C"] });
  });

  it("survives a reference cycle without hanging", () => {
    // Two messages naming each other as root (malformed/hostile input): the walk
    // must terminate, and neither may be silently dropped.
    const msgs = [m("x", "A", 1, "y"), m("y", "B", 2, "x")];
    const { timeline, threads } = groupThreads(msgs);
    // Both stay readable in the channel rather than being buried under each other.
    expect(timeline.map((t) => t.id)).toEqual(["x", "y"]);
    expect(threads.size).toBe(0);
  });

  it("keeps multiple independent threads separate", () => {
    const msgs = [
      m("root1", "A", 1), m("root2", "B", 2),
      m("x", "C", 3, "root1"), m("y", "D", 4, "root2"),
    ];
    const { threads, meta } = groupThreads(msgs);
    expect(threads.get("root1")!.map((x) => x.id)).toEqual(["x"]);
    expect(threads.get("root2")!.map((x) => x.id)).toEqual(["y"]);
    expect(meta.get("root1")!.count).toBe(1);
    expect(meta.get("root2")!.count).toBe(1);
  });
});
