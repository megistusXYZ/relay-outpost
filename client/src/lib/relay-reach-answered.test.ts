// @vitest-environment node
/**
 * queryAnswered: `answered` means a relay sent its OWN end of stream.
 *
 * `answered` is what writes are gated on (the DM relay list, the NIP-65 list,
 * a Featured feed). It has been wrong twice, each time by trusting the end of
 * the stream:
 *
 *  1. It was settled inside `oneose` with no look at the connection.
 *     nostr-tools fires `oneose` for a relay that never connected, so a set
 *     with every relay down came back `answered: true` with zero events. Found
 *     in a browser against real sockets (2026-11-18).
 *  2. The fix for that asked "is anyone connected?" when the stream ended. A
 *     relay we ARE connected to can end a stream without answering: it turns
 *     the question down, it drops the socket, or it says nothing until the
 *     library gives up and ends the stream itself. Found the next day, when
 *     the same browser check was first run in WebKit: there a dropped socket
 *     ends the stream at once, the re-dial succeeds, and it read as answered.
 *
 * Those checks live outside the repo because they need a browser and local
 * relays. This file is the backstop that runs every time, so it must not
 * repeat the mistake the first reachability tests made, a pool mocked to match
 * an assumption. The pool here is the library's own. Only the socket under it
 * is scripted, so a stream ends here the way the library really ends it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const { ScriptedSocket, dials } = vi.hoisted(() => {
  const dials: string[] = [];
  const HELD = {
    id: "a".repeat(64), pubkey: "b".repeat(64), created_at: 1_700_000_000,
    kind: 1, tags: [] as string[][], content: "held by the relay", sig: "c".repeat(128),
  };
  /**
   * One socket class, a different relay per host name:
   *   dead-*        errors before it opens
   *   hangs-*       never opens and never errors
   *   silent-*      opens, never says a word
   *   empty-*       opens, answers every REQ with a bare EOSE
   *   holds-*       opens, sends one event, then EOSE
   *   late-*        opens, answers with a bare EOSE twelve seconds on
   *   declines-*    opens, turns every REQ down with CLOSED
   *   drops-*       opens, then on the REQ the socket errors and closes
   *   sendsdrops-*  opens, sends one event, then the socket errors and closes
   *   eosedrops-*   opens, answers with EOSE, then the socket errors and closes
   * The three that drop fire `error` before `close`, which is what WebKit does
   * when a relay hangs up on an open socket without a close frame.
   */
  class ScriptedSocket {
    static OPEN = 1;
    onopen: (() => void) | null = null;
    onerror: ((e?: unknown) => void) | null = null;
    onclose: ((e?: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    readyState = 0;
    private kind: string;
    constructor(public url: string) {
      this.kind = new URL(url).hostname.split("-")[0];
      dials.push(url);
      if (this.kind === "dead") {
        setTimeout(() => this.onerror?.(new Error("connection failed")), 0);
        return;
      }
      if (this.kind === "hangs") return;
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg[0] !== "REQ") return;
      const say = (m: unknown, afterMs = 0) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), afterMs);
      const drop = () => setTimeout(() => { this.readyState = 3; this.onerror?.(new Error("dropped")); this.onclose?.({}); }, 0);
      if (this.kind === "holds" || this.kind === "sendsdrops") say(["EVENT", msg[1], HELD]);
      if (this.kind === "holds" || this.kind === "empty" || this.kind === "eosedrops") say(["EOSE", msg[1]]);
      if (this.kind === "late") say(["EOSE", msg[1]], 12_000);
      if (this.kind === "declines") say(["CLOSED", msg[1], "restricted: not a relay member"]);
      if (this.kind === "drops" || this.kind === "sendsdrops" || this.kind === "eosedrops") drop();
    }
    close() { this.readyState = 3; }
  }
  return { ScriptedSocket, dials };
});

vi.mock("@/lib/nostr", async () => {
  const { AbstractSimplePool } = await import("nostr-tools/abstract-pool");
  return {
    pool: new AbstractSimplePool({ verifyEvent: () => true, websocketImplementation: ScriptedSocket } as any),
    DEFAULT_READ_MAX_WAIT_MS: 10_000,
  };
});
vi.mock("./nip42-auth", () => ({ getAuthStatus: () => ({ status: "idle" }) }));

import { pool } from "@/lib/nostr";
import { queryAnswered } from "./relay-reach";

const FILTER = { kinds: [1], limit: 1 };

afterEach(() => { vi.useRealTimers(); });

describe("the library, as it really behaves", () => {
  it("ends the stream for a relay that never connected: this is the trap", async () => {
    // If a nostr-tools upgrade stops doing this, the per-relay check in
    // queryAnswered is merely redundant. If the tests below pass while this
    // one fails, they are no longer exercising the case they were written for.
    const ended = await new Promise<boolean>((resolve) => {
      pool.subscribeMany(["wss://dead-trap.example"], FILTER, { oneose: () => resolve(true) });
      setTimeout(() => resolve(false), 1500);
    });
    expect(ended).toBe(true);
  });

  it("and says so in the same turn: the close lands right behind the end of stream", async () => {
    // queryAnswered tells a relay's own EOSE from an ending the library made up
    // by this ordering and nothing else. A relay's own EOSE has no close behind it.
    const order = (url: string) => new Promise<string[]>((resolve) => {
      const seen: string[] = [];
      pool.subscribeMany([url], FILTER, {
        oneose: () => { seen.push("eose"); queueMicrotask(() => seen.push("next turn")); setTimeout(() => resolve(seen), 50); },
        onclose: () => seen.push("close"),
      });
    });
    expect(await order("wss://dead-order.example")).toEqual(["eose", "close", "next turn"]);
    expect(await order("wss://declines-order.example")).toEqual(["eose", "close", "next turn"]);
    expect(await order("wss://empty-order.example")).toEqual(["eose", "next turn"]);
  });
});

describe("queryAnswered: who did not answer", () => {
  it("a relay that never connected is NOT an answer, and is not dialed a second time to find out", async () => {
    await expect(queryAnswered(["wss://dead-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
    expect(dials.filter((d) => d.includes("dead-one")).length).toBe(1);
  });

  it("nor is a whole set of them", async () => {
    const res = await queryAnswered(["wss://dead-a.example", "wss://dead-b.example"], FILTER, 3000);
    expect(res).toEqual({ events: [], answered: false });
  });

  it("a connected relay that says nothing is settled by OUR timer, unanswered and on time", async () => {
    const started = Date.now();
    const res = await queryAnswered(["wss://silent-one.example"], FILTER, 80);
    expect(res).toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("a dial that neither opens nor fails is settled by our timer too", async () => {
    const started = Date.now();
    const res = await queryAnswered(["wss://hangs-one.example"], FILTER, 80);
    expect(res).toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("a connected relay that declines the REQ is not an answer, and we know at once", async () => {
    // It was pinned here as a known limit while `answered` meant "the stream
    // ended and somebody is connected". A relay that turned the question down
    // told us nothing about what it holds.
    const started = Date.now();
    await expect(queryAnswered(["wss://declines-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("a relay that drops the socket without a word is not an answer, even though a re-dial would succeed", async () => {
    // The WebKit case. The library ends every read on a relay whose socket
    // errors; the relay takes connections again a moment later, which is what
    // made "somebody is connected" read this as answered.
    const started = Date.now();
    await expect(queryAnswered(["wss://drops-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("a relay that drops mid-answer has not answered, and what it did send comes back", async () => {
    const res = await queryAnswered(["wss://sendsdrops-one.example"], FILTER, 3000);
    expect(res.answered).toBe(false);
    expect(res.events.map((e) => e.content)).toEqual(["held by the relay"]);
  });

  it("the library's own made-up end of stream is not an answer", async () => {
    // Left alone, nostr-tools ends a silent relay's stream itself (4.4 s by
    // default, 10 s through this app's pool) through the same callback as a
    // real EOSE. A caller who waits longer than that must not take it for one.
    vi.useFakeTimers();
    let done: unknown;
    const pending = queryAnswered(["wss://silent-long.example"], FILTER, 6000).then((r) => { done = r; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    expect(done).toEqual({ events: [], answered: false });
  });

  it("no relays at all: nothing was asked", async () => {
    await expect(queryAnswered([], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
  });

  it("an address that is not a relay address is one more relay that did not answer, not a thrown read", async () => {
    await expect(queryAnswered(["wss://bad host"], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
    await expect(queryAnswered(["wss://bad host", "wss://empty-beside.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: true });
  });
});

describe("queryAnswered: who did", () => {
  it("a relay that answers with NOTHING is an answer", async () => {
    // The other half, and the one a too-eager fix would break: a first relay
    // list, a first feed and "No conversations yet" all rest on this being true.
    await expect(queryAnswered(["wss://empty-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: true });
  });

  it("a relay that answers with an event is an answer, and the event comes back", async () => {
    const res = await queryAnswered(["wss://holds-one.example"], FILTER, 3000);
    expect(res.answered).toBe(true);
    expect(res.events.map((e) => e.content)).toEqual(["held by the relay"]);
  });

  it("the same event from two relays comes back once", async () => {
    const res = await queryAnswered(["wss://holds-twin.example", "wss://holds-twinb.example"], FILTER, 3000);
    expect(res.answered).toBe(true);
    expect(res.events).toHaveLength(1);
  });

  it("one relay down and one answering is an answer: thin, but real", async () => {
    const res = await queryAnswered(["wss://dead-mixed.example", "wss://empty-mixed.example"], FILTER, 3000);
    expect(res).toEqual({ events: [], answered: true });
  });

  it("one relay declining and one answering is an answer", async () => {
    const res = await queryAnswered(["wss://declines-mixed.example", "wss://empty-mixedb.example"], FILTER, 3000);
    expect(res).toEqual({ events: [], answered: true });
  });

  it("a relay that answered in full and THEN dropped did answer", async () => {
    // The over-correction to guard against: reading every drop as "no answer".
    await expect(queryAnswered(["wss://eosedrops-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: true });
  });

  it("a silent neighbour does not erase a real answer when our timer ends the read", async () => {
    const started = Date.now();
    const res = await queryAnswered(["wss://silent-beside.example", "wss://empty-besideb.example"], FILTER, 80);
    expect(res).toEqual({ events: [], answered: true });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("queryAnswered: how long it waits for the rest", () => {
  it("with one answer in hand, a silent relay holds the read for the pool's wait and no longer", async () => {
    vi.useFakeTimers();
    let done: unknown;
    const pending = queryAnswered(["wss://empty-wait.example", "wss://silent-wait.example"], FILTER, 15_000).then((r) => { done = r; });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(done).toEqual({ events: [], answered: true });
  });

  it("past that wait, the first real answer ends the read rather than the caller's full time", async () => {
    vi.useFakeTimers();
    let done: unknown;
    const pending = queryAnswered(["wss://late-wait.example", "wss://silent-waitb.example"], FILTER, 15_000).then((r) => { done = r; });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_100);
    await pending;
    expect(done).toEqual({ events: [], answered: true });
  });
});
