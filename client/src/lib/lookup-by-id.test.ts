/**
 * Looking events up by id (a reply's parent, a quoted note), batched.
 *
 * Two measurements behind this file (2026-10-01, a busy profile):
 *  - the lookup used to settle only when EVERY relay had finished, so found
 *    parents sat 4–8 s behind one stuck relay and "five relays said no" came
 *    back as "didn't load" (fixed first, per lookup);
 *  - each reply then still made its own request to every relay: 90 replies ×
 *    7 relays = 630 requests through a throttle, and context took 3–7 s to
 *    fill in. One request per relay carries all the ids.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIdBatcher, MISSING_GRACE_MS, BATCH_WINDOW_MS } from "./lookup-by-id";
import type { Subscribe } from "./collect-once";

type Handlers = Parameters<Subscribe>[2];
interface Call { relay: string; ids: string[]; h: Handlers; closed: boolean }

/** A fake network: records every request (one relay each) and lets the test answer. */
function fakeNet() {
  const calls: Call[] = [];
  const subscribe: Subscribe = (relays, filter, handlers) => {
    const call: Call = { relay: relays[0], ids: [...((filter as { ids: string[] }).ids)], h: handlers, closed: false };
    calls.push(call);
    return { close: () => { call.closed = true; } };
  };
  const to = (relay: string) => calls.filter((c) => c.relay === relay);
  /** The relay really answers: these events, then EOSE. */
  const answer = (relay: string, ...ids: string[]) => {
    for (const c of to(relay)) {
      for (const id of ids) if (c.ids.includes(id)) c.h.onevent(ev(id) as never);
      c.h.onrelayeose?.(relay); c.h.oneose();
    }
  };
  /** The relay won't answer (rate limit, failed connection). */
  const decline = (relay: string) => { for (const c of to(relay)) { c.h.onrelaydeclined?.(relay); c.h.oneose(); } };
  return { subscribe, calls, to, answer, decline };
}
const ev = (id: string) => ({ id, kind: 1, pubkey: "p", created_at: 1, tags: [], content: "", sig: "s" });
const R = ["wss://a", "wss://b", "wss://c", "wss://d", "wss://e"];
const flush = () => vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 1);

describe("createIdBatcher — one request per relay", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("ninety lookups asked in the same moment make one request per relay, not ninety", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    for (let i = 0; i < 90; i++) void b.lookup("id" + i, R);
    expect(net.calls).toHaveLength(0); // nothing leaves until the window closes
    await flush();
    expect(net.calls).toHaveLength(R.length);
    expect(net.to("wss://a")[0].ids).toHaveLength(90);
  });

  it("each relay is asked only for the ids that named it (a hint relay gets its one id)", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    void b.lookup("x", ["wss://hint", "wss://a"]);
    void b.lookup("y", ["wss://a", "wss://b"]);
    await flush();
    expect(net.to("wss://hint")[0].ids).toEqual(["x"]);
    expect(net.to("wss://a")[0].ids.sort()).toEqual(["x", "y"]);
    expect(net.to("wss://b")[0].ids).toEqual(["y"]);
  });

  it("the same id wanted twice is asked once and answers both", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    const p1 = b.lookup("x", R), p2 = b.lookup("x", R);
    await flush();
    expect(net.to("wss://a")[0].ids).toEqual(["x"]);
    net.answer("wss://a", "x");
    await expect(p1).resolves.toMatchObject({ outcome: "found" });
    await expect(p2).resolves.toMatchObject({ outcome: "found" });
  });

  it("a very long list is split, so no single request carries more ids than relays accept", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe, { maxIdsPerRequest: 40 });
    for (let i = 0; i < 90; i++) void b.lookup("id" + i, ["wss://a"]);
    await flush();
    expect(net.to("wss://a").map((c) => c.ids.length)).toEqual([40, 40, 10]);
  });

  it("lookups asked later go out in a later batch", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    void b.lookup("x", ["wss://a"]);
    await flush();
    void b.lookup("y", ["wss://a"]);
    await flush();
    expect(net.to("wss://a").map((c) => c.ids)).toEqual([["x"], ["y"]]);
  });

  it("a relay's request is closed once every id in it is settled", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    const p = b.lookup("x", ["wss://a", "wss://b"]);
    await flush();
    net.to("wss://a")[0].h.onevent(ev("x") as never);
    await p;
    expect(net.to("wss://a")[0].closed).toBe(true);
    expect(net.to("wss://b")[0].closed).toBe(true);
  });
});

describe("createIdBatcher — the three honest outcomes, per id", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("found the moment the event arrives — it does not wait for the other relays", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", R);
    await flush();
    net.to("wss://c")[0].h.onevent(ev("x") as never);
    await expect(p).resolves.toEqual({ outcome: "found", event: expect.objectContaining({ id: "x" }) });
  });

  it("one id being found does not settle its neighbours in the same request", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    const px = b.lookup("x", R); let y: unknown; b.lookup("y", R).then((v) => { y = v; });
    await flush();
    net.to("wss://a")[0].h.onevent(ev("x") as never);
    await px;
    expect(y).toBeUndefined();
  });

  it("missing once most relays have really answered without it, after a short grace — a stuck relay can't hold it", async () => {
    const net = fakeNet();
    let settled: unknown;
    createIdBatcher(net.subscribe).lookup("x", R).then((v) => { settled = v; });
    await flush();
    net.answer("wss://a"); net.answer("wss://b");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS + 10);
    expect(settled).toBeUndefined(); // two of five is not most
    net.answer("wss://c");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS - 10);
    expect(settled).toBeUndefined(); // still inside the grace
    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toEqual({ outcome: "missing", event: null });
  });

  it("a late find inside the grace still wins", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", R);
    await flush();
    net.answer("wss://a"); net.answer("wss://b"); net.answer("wss://c");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS / 2);
    net.to("wss://d")[0].h.onevent(ev("x") as never);
    await expect(p).resolves.toMatchObject({ outcome: "found" });
  });

  it("relays that declined don't count as asked: most of the REST is enough", async () => {
    const net = fakeNet();
    let settled: unknown;
    createIdBatcher(net.subscribe).lookup("x", R).then((v) => { settled = v; });
    await flush();
    net.decline("wss://d"); net.decline("wss://e");
    net.answer("wss://a"); net.answer("wss://b"); // 2 of the 3 that can answer
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS + 10);
    expect(settled).toEqual({ outcome: "missing", event: null });
  });

  it("declines alone are never an answer: nothing is concluded", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", R);
    await flush();
    for (const r of R) net.decline(r);
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("a relay that finishes without a real answer counts as declined, not as an answer", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", ["wss://a", "wss://b"]);
    await flush();
    net.to("wss://a")[0].h.oneose(); // nostr-tools invents this for a failed connection
    net.to("wss://b")[0].h.oneose();
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("the app's subscribe reports 'request over' BEFORE 'really answered' (a microtask later): the answer still counts", async () => {
    // throttledPoolSubscribe calls oneose synchronously and onrelayeose from a
    // queued microtask. Judging at oneose would call a relay that answered
    // "declined", and a parent nobody has would read as "didn't load".
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", ["wss://a"]);
    await flush();
    const c = net.to("wss://a")[0];
    queueMicrotask(() => c.h.onrelayeose?.("wss://a"));
    c.h.oneose();
    await expect(p).resolves.toEqual({ outcome: "missing", event: null });
  });

  it("at the cap with only a minority answered, it is unreached — retry is offered, absence is not claimed", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe, { capMs: 8000 }).lookup("x", R);
    await flush();
    net.answer("wss://a");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("every relay finished without it: missing if any really answered", async () => {
    const net = fakeNet();
    const p = createIdBatcher(net.subscribe).lookup("x", ["wss://a", "wss://b"]);
    await flush();
    net.answer("wss://a"); net.decline("wss://b");
    await expect(p).resolves.toEqual({ outcome: "missing", event: null });
  });

  it("no relays to ask is unreached, at once", async () => {
    const net = fakeNet();
    await expect(createIdBatcher(net.subscribe).lookup("x", [])).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("an id that was unreached can be asked again (the retry button)", async () => {
    const net = fakeNet();
    const b = createIdBatcher(net.subscribe);
    const first = b.lookup("x", ["wss://a"]);
    await flush();
    net.decline("wss://a");
    await expect(first).resolves.toMatchObject({ outcome: "unreached" });
    const again = b.lookup("x", ["wss://a"]);
    await flush();
    expect(net.to("wss://a")).toHaveLength(2);
    net.answer("wss://a", "x");
    await expect(again).resolves.toMatchObject({ outcome: "found" });
  });
});

describe("who uses it", () => {
  it("a post's reply parent and its quoted notes both go through the one batcher", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const post = readFileSync(path.resolve(import.meta.dirname, "../components/NostrPost.tsx"), "utf8");
    expect(post).toMatch(/const idLookups = createIdBatcher\(subscribeById\);/);
    expect(post).toMatch(/idLookups\.lookup\(replyTargetId, relays\)/);
    expect(post).toMatch(/idLookups\.lookup\(eventId, candidates\)/);
    // The all-relays wait and the one-request-per-reply lookup are both gone.
    expect(post).not.toMatch(/queryAnswered\([a-zA-Z]+, \{ ids: \[/);
    expect(post).not.toMatch(/lookupById\(/);
  });
});
