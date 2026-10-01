/**
 * Looking one event up by id (a reply's parent). Measured on a profile with
 * one relay stuck, 2026-10-01: every lookup waited for the slowest relay —
 * parents that WERE found took 4.2–8.0 s to appear — and with a relay hanging
 * past the caller's 8 s, "five relays said no" came back as "didn't load".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupById, MISSING_GRACE_MS } from "./lookup-by-id";
import type { Subscribe } from "./collect-once";

type Handlers = Parameters<Subscribe>[2];
function fakeRelays() {
  let h: Handlers | undefined; const closed = vi.fn();
  const subscribe: Subscribe = (_relays, _filter, handlers) => { h = handlers; return { close: closed }; };
  return { subscribe, closed, get h() { return h!; } };
}
const RELAYS = ["wss://a", "wss://b", "wss://c", "wss://d", "wss://e"];
const ev = (id: string) => ({ id, kind: 1, pubkey: "p", created_at: 1, tags: [], content: "", sig: "s" });

describe("lookupById", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is found the moment the event arrives — it does not wait for the other relays", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    r.h.onevent(ev("x") as never);
    await expect(p).resolves.toEqual({ outcome: "found", event: expect.objectContaining({ id: "x" }) });
    expect(r.closed).toHaveBeenCalled();
  });

  it("ignores an event that is not the one asked for", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    r.h.onevent(ev("other") as never);
    r.h.oneose();
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("is missing once most relays have really answered without it, after a short grace — a stuck relay can't hold it", async () => {
    const r = fakeRelays();
    let settled: unknown;
    lookupById(r.subscribe, RELAYS, "x", 8000).then((v) => { settled = v; });
    r.h.onrelayeose!("wss://a"); r.h.onrelayeose!("wss://b");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS + 10);
    expect(settled).toBeUndefined(); // two of five is not most
    r.h.onrelayeose!("wss://c");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS - 10);
    expect(settled).toBeUndefined(); // still inside the grace
    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toEqual({ outcome: "missing", event: null });
  });

  it("a late find inside the grace still wins", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    r.h.onrelayeose!("wss://a"); r.h.onrelayeose!("wss://b"); r.h.onrelayeose!("wss://c");
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS / 2);
    r.h.onevent(ev("x") as never);
    await expect(p).resolves.toMatchObject({ outcome: "found" });
  });

  it("relays that declined (rate limit, failed connection) don't count as asked: most of the REST is enough", async () => {
    const r = fakeRelays();
    let settled: unknown;
    lookupById(r.subscribe, RELAYS, "x", 8000).then((v) => { settled = v; });
    r.h.onrelaydeclined!("wss://d"); r.h.onrelaydeclined!("wss://e");
    r.h.onrelayeose!("wss://a"); r.h.onrelayeose!("wss://b"); // 2 of the 3 that can answer
    await vi.advanceTimersByTimeAsync(MISSING_GRACE_MS + 10);
    expect(settled).toEqual({ outcome: "missing", event: null });
  });

  it("declines alone are never an answer: nobody was asked, so nothing is concluded", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    for (const u of RELAYS) r.h.onrelaydeclined!(u);
    r.h.oneose();
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
  });

  it("at the cap with only a minority answered, it is unreached — retry is offered, absence is not claimed", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    r.h.onrelayeose!("wss://a");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toEqual({ outcome: "unreached", event: null });
    expect(r.closed).toHaveBeenCalled();
  });

  it("every relay finished without it: missing if any really answered", async () => {
    const r = fakeRelays();
    const p = lookupById(r.subscribe, RELAYS, "x", 8000);
    r.h.onrelayeose!("wss://a");
    r.h.oneose();
    await expect(p).resolves.toEqual({ outcome: "missing", event: null });
  });

  it("no relays to ask is unreached", async () => {
    const r = fakeRelays();
    await expect(lookupById(r.subscribe, [], "x", 8000)).resolves.toEqual({ outcome: "unreached", event: null });
  });
});

describe("who uses it", () => {
  it("a post's reply parent and its quoted notes are both looked up this way", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const post = readFileSync(path.resolve(import.meta.dirname, "../components/NostrPost.tsx"), "utf8");
    expect(post).toMatch(/lookupById\(subscribeById, relays, replyTargetId, 8_000\)/);
    expect(post).toMatch(/lookupById\(subscribeById, candidates, eventId, 8_000\)/);
    // The all-relays wait is gone from both by-id lookups.
    expect(post).not.toMatch(/queryAnswered\([a-zA-Z]+, \{ ids: \[/);
  });
});
