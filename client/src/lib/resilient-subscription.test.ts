import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event } from "nostr-tools";
import { openResilientSub, type ResilientOpener } from "./resilient-subscription";

interface FakeSub {
  handlers: { onevent: (e: Event) => void; oneose: () => void; onclose: () => void };
  closed: boolean;
}

/** Opener that records every underlying subscription it creates. */
function makeFakeOpener() {
  const subs: FakeSub[] = [];
  const open: ResilientOpener = (_relays, _filters, handlers) => {
    const sub: FakeSub = { handlers, closed: false };
    subs.push(sub);
    return { close: () => { sub.closed = true; } };
  };
  return { open, subs };
}

const evt = (id: string) => ({ id } as unknown as Event);
const FILTER = { kinds: [1059], authors: ["pk"] };

describe("openResilientSub", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens one underlying subscription and forwards events", () => {
    const { open, subs } = makeFakeOpener();
    const seen: string[] = [];
    openResilientSub(open, ["wss://r"], FILTER, { onevent: (e) => seen.push(e.id) });
    expect(subs).toHaveLength(1);
    subs[0].handlers.onevent(evt("a"));
    expect(seen).toEqual(["a"]);
  });

  it("reopens with backoff after the underlying sub closes underneath", () => {
    const { open, subs } = makeFakeOpener();
    const seen: string[] = [];
    openResilientSub(open, ["wss://r"], FILTER, { onevent: (e) => seen.push(e.id) });
    subs[0].handlers.onclose(); // socket died
    expect(subs).toHaveLength(1); // not yet — backoff pending
    vi.advanceTimersByTime(1_500);
    expect(subs).toHaveLength(2); // reopened
    subs[1].handlers.onevent(evt("b"));
    expect(seen).toEqual(["b"]); // live again
  });

  it("backs off exponentially on repeated failures and caps the delay", () => {
    const { open, subs } = makeFakeOpener();
    openResilientSub(open, ["wss://r"], FILTER, {});
    // Fail 10 times in a row without any event in between.
    let expected = 1;
    const delays = [1_500, 3_000, 6_000, 12_000, 24_000, 30_000, 30_000];
    for (const d of delays) {
      subs[subs.length - 1].handlers.onclose();
      vi.advanceTimersByTime(d - 1);
      expect(subs).toHaveLength(expected); // not yet
      vi.advanceTimersByTime(1);
      expected++;
      expect(subs).toHaveLength(expected);
    }
  });

  it("does NOT reset the backoff on replayed events alone", () => {
    // Every `since`-based reopen replays stored events, so resetting the backoff
    // on the first event would peg a flapping relay at the retry floor forever.
    const { open, subs } = makeFakeOpener();
    openResilientSub(open, ["wss://r"], FILTER, {});
    subs[0].handlers.onclose();
    vi.advanceTimersByTime(1_500); // reopen → sub[1], attempt now 1
    subs[1].handlers.onclose();
    vi.advanceTimersByTime(3_000); // reopen → sub[2], attempt now 2
    expect(subs).toHaveLength(3);
    subs[2].handlers.onevent(evt("replayed")); // must NOT reset the backoff
    subs[2].handlers.onclose();
    vi.advanceTimersByTime(1_500);
    expect(subs).toHaveLength(3); // base delay would have reopened — it did not
    vi.advanceTimersByTime(4_500); // total 6_000 = the backed-off delay
    expect(subs).toHaveLength(4);  // reopens only after the FULL backoff
  });

  it("resets the backoff after a generation stays open past the stability window", () => {
    const { open, subs } = makeFakeOpener();
    openResilientSub(open, ["wss://r"], FILTER, {});
    subs[0].handlers.onclose();
    vi.advanceTimersByTime(1_500); // sub[1], attempt 1
    subs[1].handlers.onclose();
    vi.advanceTimersByTime(3_000); // sub[2], attempt 2
    expect(subs).toHaveLength(3);
    vi.advanceTimersByTime(10_000); // sub[2] stays open ⇒ healthy ⇒ attempt reset to 0
    subs[2].handlers.onclose();
    vi.advanceTimersByTime(1_500); // back to the base delay
    expect(subs).toHaveLength(4);
  });

  it("does NOT reopen when the caller closed the subscription", () => {
    const { open, subs } = makeFakeOpener();
    const handle = openResilientSub(open, ["wss://r"], FILTER, {});
    handle.close();
    expect(subs[0].closed).toBe(true);
    // The underlying close also surfaces an onclose — must not resurrect.
    subs[0].handlers.onclose();
    vi.advanceTimersByTime(60_000);
    expect(subs).toHaveLength(1);
  });

  it("close() cancels a pending reopen", () => {
    const { open, subs } = makeFakeOpener();
    const handle = openResilientSub(open, ["wss://r"], FILTER, {});
    subs[0].handlers.onclose();
    handle.close();
    vi.advanceTimersByTime(60_000);
    expect(subs).toHaveLength(1);
  });

  it("kick() fast-forwards a pending reopen (online/foreground path)", () => {
    const { open, subs } = makeFakeOpener();
    const handle = openResilientSub(open, ["wss://r"], FILTER, {});
    subs[0].handlers.onclose();
    expect(subs).toHaveLength(1);
    handle.kick(); // e.g. window came back online
    expect(subs).toHaveLength(2);
  });

  it("kick() is a no-op while the subscription is believed alive", () => {
    const { open, subs } = makeFakeOpener();
    const handle = openResilientSub(open, ["wss://r"], FILTER, {});
    handle.kick();
    expect(subs).toHaveLength(1);
  });

  it("fires oneose at most once across reopens", () => {
    const { open, subs } = makeFakeOpener();
    let eoses = 0;
    openResilientSub(open, ["wss://r"], FILTER, { oneose: () => eoses++ });
    subs[0].handlers.oneose();
    subs[0].handlers.onclose();
    vi.advanceTimersByTime(1_500);
    subs[1].handlers.oneose(); // replayed EOSE after reopen
    expect(eoses).toBe(1);
  });

  it("ignores events from a superseded underlying subscription", () => {
    const { open, subs } = makeFakeOpener();
    const seen: string[] = [];
    openResilientSub(open, ["wss://r"], FILTER, { onevent: (e) => seen.push(e.id) });
    subs[0].handlers.onclose();
    vi.advanceTimersByTime(1_500);
    subs[0].handlers.onevent(evt("stale"));
    subs[1].handlers.onevent(evt("fresh"));
    expect(seen).toEqual(["fresh"]);
  });

  it("survives an opener whose onclose fires synchronously during open", () => {
    let calls = 0;
    const seen: string[] = [];
    let lastHandlers: FakeSub["handlers"] | null = null;
    const open: ResilientOpener = (_r, _f, handlers) => {
      calls++;
      if (calls === 1) handlers.onclose(); // e.g. zero healthy relays at first
      lastHandlers = handlers;
      return { close() {} };
    };
    openResilientSub(open, ["wss://r"], FILTER, { onevent: (e) => seen.push(e.id) });
    vi.advanceTimersByTime(1_500);
    expect(calls).toBe(2);
    lastHandlers!.onevent(evt("ok"));
    expect(seen).toEqual(["ok"]);
  });
});
