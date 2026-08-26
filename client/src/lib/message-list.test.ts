import { describe, it, expect } from "vitest";
import { emptyMessageList, addMessage, addMessages, insertSorted, mergeCachedHistory, type MessageList } from "./message-list";

interface Msg { id: string; t: number }
const getId = (m: Msg) => m.id;
const getTime = (m: Msg) => m.t;

const add = (state: MessageList<Msg>, id: string, t: number) => addMessage(state, { id, t }, getId, getTime);
const ids = (state: MessageList<Msg>) => state.items.map((m) => m.id);
const times = (state: MessageList<Msg>) => state.items.map((m) => m.t);

describe("addMessage", () => {
  it("appends newest messages in order (O(1) realtime path)", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 1);
    s = add(s, "b", 2);
    s = add(s, "c", 3);
    expect(ids(s)).toEqual(["a", "b", "c"]);
  });

  it("binary-inserts an out-of-order (older) message at its position", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 1);
    s = add(s, "c", 3);
    s = add(s, "b", 2); // arrives late
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(times(s)).toEqual([1, 2, 3]);
  });

  it("returns the SAME reference on a duplicate id (no re-render)", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 1);
    const before = s;
    const after = add(s, "a", 1);
    expect(after).toBe(before);
  });

  it("keeps a duplicate from a second relay out even with a different time", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 1);
    s = add(s, "a", 5); // same id, later time (relay clock skew) — ignored
    expect(ids(s)).toEqual(["a"]);
    expect(times(s)).toEqual([1]);
  });

  it("places an equal-time message AFTER existing equal-time items (stable)", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 5);
    s = add(s, "b", 5);
    s = add(s, "c", 5);
    expect(ids(s)).toEqual(["a", "b", "c"]);
  });

  it("inserts an equal-time item after equals but before a later one", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 5);
    s = add(s, "z", 9);
    s = add(s, "b", 5); // equal to a, before z
    expect(ids(s)).toEqual(["a", "b", "z"]);
  });
});

describe("insertSorted (array primitive)", () => {
  const arr = (xs: Array<[string, number]>) => xs.map(([id, t]) => ({ id, t }));
  it("appends when the item is newest (fast path returns a new array)", () => {
    const a = arr([["a", 1], ["b", 2]]);
    const out = insertSorted(a, { id: "c", t: 3 }, getTime);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(a);
  });
  it("binary-inserts an older item and equals a full stable re-sort", () => {
    const a = arr([["a", 1], ["c", 3], ["d", 4]]);
    const item = { id: "b", t: 2 };
    const out = insertSorted(a, item, getTime);
    const expected = [...a, item].sort((x, y) => x.t - y.t).map((m) => m.id);
    expect(out.map((m) => m.id)).toEqual(expected);
  });
  it("places an equal-time item after existing equals", () => {
    const a = arr([["a", 5], ["z", 9]]);
    const out = insertSorted(a, { id: "b", t: 5 }, getTime);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "z"]);
  });
});

describe("addMessages (batch)", () => {
  it("merges, dedupes, and sorts a batch once", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "b", 2);
    s = addMessages(s, [{ id: "d", t: 4 }, { id: "a", t: 1 }, { id: "b", t: 2 }, { id: "c", t: 3 }], getId, getTime);
    expect(ids(s)).toEqual(["a", "b", "c", "d"]);
    expect(times(s)).toEqual([1, 2, 3, 4]);
  });

  it("returns the SAME reference when the batch adds nothing new", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "a", 1);
    const before = s;
    const after = addMessages(s, [{ id: "a", t: 1 }], getId, getTime);
    expect(after).toBe(before);
  });

  it("prepending an older history page keeps global order", () => {
    let s = emptyMessageList<Msg>();
    s = add(s, "e", 5);
    s = add(s, "f", 6);
    s = addMessages(s, [{ id: "a", t: 1 }, { id: "b", t: 2 }], getId, getTime);
    expect(ids(s)).toEqual(["a", "b", "e", "f"]);
  });

  it("matches a full stable re-sort for a shuffled stream", () => {
    const stream = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, t: (i * 37) % 50 }));
    let s = emptyMessageList<Msg>();
    for (const m of stream) s = addMessage(s, m, getId, getTime);
    const expected = [...stream].sort((a, b) => a.t - b.t).map((m) => m.id);
    expect(ids(s)).toEqual(expected);
  });
});

describe("mergeCachedHistory", () => {
  const merge = (cached: Msg[], live: Msg[]) => mergeCachedHistory(cached, live, getId, getTime);

  it("returns the cached history when nothing arrived live", () => {
    expect(merge([{ id: "a", t: 1 }, { id: "b", t: 2 }], []).map(getId)).toEqual(["a", "b"]);
  });

  it("keeps live messages that the cached snapshot missed (the clobber bug)", () => {
    const out = merge([{ id: "a", t: 1 }], [{ id: "live", t: 5 }]);
    expect(out.map(getId)).toEqual(["a", "live"]);
  });

  it("interleaves live messages at their time-sorted position", () => {
    const out = merge(
      [{ id: "a", t: 1 }, { id: "c", t: 3 }],
      [{ id: "b", t: 2 }, { id: "d", t: 4 }],
    );
    expect(out.map(getId)).toEqual(["a", "b", "c", "d"]);
  });

  it("prefers the live copy on an id conflict (edits/deletes already applied)", () => {
    const cachedMsg = { id: "a", t: 1, v: "old" } as Msg & { v: string };
    const liveMsg = { id: "a", t: 1, v: "edited" } as Msg & { v: string };
    const out = mergeCachedHistory([cachedMsg], [liveMsg], getId, getTime) as (Msg & { v: string })[];
    expect(out).toHaveLength(1);
    expect(out[0].v).toBe("edited");
  });

  it("does not mutate its inputs", () => {
    const cached = [{ id: "a", t: 1 }];
    const live = [{ id: "b", t: 2 }];
    merge(cached, live);
    expect(cached).toHaveLength(1);
    expect(live).toHaveLength(1);
  });
});
