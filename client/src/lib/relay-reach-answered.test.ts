// @vitest-environment node
/**
 * queryAnswered: the end of the stream is not an answer unless someone was
 * there to end it.
 *
 * `answered` is what writes are gated on (the DM relay list, the NIP-65 list,
 * a Featured feed), and it was settled inside `oneose` with no look at the
 * connection. nostr-tools fires `oneose` for a relay that never connected, so
 * a set with every relay down came back `answered: true` with zero events:
 * "we never got to ask" filed as "asked, and there is none".
 *
 * Found in a browser against real sockets (2026-11-18), not here: a refused
 * connection and one dropped before the handshake both read as answered. That
 * check lives outside the repo because it needs a browser and local relays.
 * This file is the backstop that runs every time, so it must not repeat the
 * mistake the first reachability tests made, a pool mocked to match an
 * assumption. The pool here is the library's own. Only the socket under it is
 * scripted, so a relay that never opens ends the stream the way the library
 * really ends it.
 */
import { describe, it, expect, vi } from "vitest";

const { ScriptedSocket, dials } = vi.hoisted(() => {
  const dials: string[] = [];
  const HELD = {
    id: "a".repeat(64), pubkey: "b".repeat(64), created_at: 1_700_000_000,
    kind: 1, tags: [] as string[][], content: "held by the relay", sig: "c".repeat(128),
  };
  /**
   * One socket class, a different relay per host name:
   *   dead-*      errors before it opens
   *   deadthenhangs-*  errors on the first dial, then never opens nor errors
   *   silent-*    opens, never says a word
   *   empty-*     opens, answers every REQ with a bare EOSE
   *   holds-*     opens, sends one event, then EOSE
   *   declines-*  opens, turns every REQ down with CLOSED
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
      const earlier = dials.filter((d) => d === url).length;
      dials.push(url);
      if (this.kind === "dead" || (this.kind === "deadthenhangs" && earlier === 0)) {
        setTimeout(() => this.onerror?.(new Error("connection failed")), 0);
        return;
      }
      if (this.kind === "deadthenhangs") return;
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg[0] !== "REQ") return;
      const say = (m: unknown) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), 0);
      if (this.kind === "holds") say(["EVENT", msg[1], HELD]);
      if (this.kind === "holds" || this.kind === "empty") say(["EOSE", msg[1]]);
      if (this.kind === "declines") say(["CLOSED", msg[1], "restricted: not a relay member"]);
    }
    close() { this.readyState = 3; }
  }
  return { ScriptedSocket, dials };
});

vi.mock("@/lib/nostr", async () => {
  const { AbstractSimplePool } = await import("nostr-tools/abstract-pool");
  return { pool: new AbstractSimplePool({ verifyEvent: () => true, websocketImplementation: ScriptedSocket } as any) };
});
vi.mock("./nip42-auth", () => ({ getAuthStatus: () => ({ status: "idle" }) }));

import { pool } from "@/lib/nostr";
import { queryAnswered } from "./relay-reach";

const FILTER = { kinds: [1], limit: 1 };

describe("the library, as it really behaves", () => {
  it("ends the stream for a relay that never connected: this is the trap", async () => {
    // If a nostr-tools upgrade stops doing this, the check in queryAnswered is
    // merely redundant. If the tests below pass while this one fails, they are
    // no longer exercising the case they were written for.
    const ended = await new Promise<boolean>((resolve) => {
      pool.subscribeMany(["wss://dead-trap.example"], FILTER, { oneose: () => resolve(true) });
      setTimeout(() => resolve(false), 1500);
    });
    expect(ended).toBe(true);
  });
});

describe("queryAnswered", () => {
  it("a relay that never connected is NOT an answer", async () => {
    await expect(queryAnswered(["wss://dead-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
  });

  it("nor is a whole set of them", async () => {
    const res = await queryAnswered(["wss://dead-a.example", "wss://dead-b.example"], FILTER, 3000);
    expect(res).toEqual({ events: [], answered: false });
  });

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

  it("one relay down and one answering is an answer: thin, but real", async () => {
    const res = await queryAnswered(["wss://dead-mixed.example", "wss://empty-mixed.example"], FILTER, 3000);
    expect(res).toEqual({ events: [], answered: true });
  });

  it("a connected relay that says nothing is settled by OUR timer, unanswered and on time", async () => {
    const started = Date.now();
    const res = await queryAnswered(["wss://silent-one.example"], FILTER, 80);
    expect(res).toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("our timer still wins while the connection check is undecided", async () => {
    // The stream ends (first dial failed), then the check dials a socket that
    // neither opens nor errors. The read must not wait on it.
    const started = Date.now();
    const res = await queryAnswered(["wss://deadthenhangs-one.example"], FILTER, 80);
    expect(res).toEqual({ events: [], answered: false });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(dials.filter((d) => d.includes("deadthenhangs-one")).length).toBe(2);
  });

  it("no relays at all: nothing was asked", async () => {
    await expect(queryAnswered([], FILTER, 3000)).resolves.toEqual({ events: [], answered: false });
  });

  it("KNOWN LIMIT, pinned: a connected relay that declines the REQ still reads as answered", async () => {
    // Not what anyone would choose; it is what the code does, before and after
    // the connection check. A CLOSED ends the stream and the relay IS
    // connected. Changing this is a decision about every caller, so it fails
    // here rather than drifting.
    await expect(queryAnswered(["wss://declines-one.example"], FILTER, 3000)).resolves.toEqual({ events: [], answered: true });
  });
});
