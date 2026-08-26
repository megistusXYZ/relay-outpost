/**
 * "No rooms here" and "we never got an answer" are different facts.
 *
 * fetchGroupMetadata resolves both ways and never rejects, so every caller's
 * `.catch()` was dead code — a relay that was completely offline spent ten
 * seconds arriving at an empty array, and the UI rendered "No Chat Rooms Found —
 * be the first, create a channel!" about a relay it had never reached.
 *
 * The obvious signal — EOSE — is the WRONG one, and I shipped it before
 * measuring. SimplePool fires `oneose` when a relay fails to connect, so a dead
 * relay EOSEs in ~143ms with zero events, identical to a healthy empty one.
 * Connecting is the signal: ensureRelay rejects (~140ms) on a relay that is
 * down and resolves instantly on one that is up. Both numbers measured against
 * real relays, not assumed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/nostr", () => ({
  pool: { subscribeMany: vi.fn(), ensureRelay: vi.fn() },
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  publishEvent: vi.fn(),
  publishEventDetailed: vi.fn(),
  // The onauth signer the fetchers now pass so nostr-tools can answer a
  // `CLOSED auth-required` instead of surfacing it as an empty EOSE.
  subscriptionAuthFor: () => undefined,
  throttledPoolSubscribe: vi.fn(),
  persistentPoolSubscribe: vi.fn(),
  filterBlockedRelays: (r: string[]) => r,
  getHealthyRelays: (r: string[]) => r,
  sortRelaysByScore: (r: string[]) => r,
}));

import { pool } from "@/lib/nostr";
import { fetchGroupMetadataResult } from "./nip29";

const RELAY = "wss://relay.example";
const groupEvent = (id: string, name: string) => ({
  kind: 39000, id: `evt-${id}`, pubkey: "f".repeat(64), created_at: 1_700_000_000, sig: "",
  tags: [["d", id], ["name", name]],
  content: "",
});

beforeEach(() => {
  vi.mocked(pool.subscribeMany).mockReset();
  // Connected by default; the unreachable test overrides this.
  vi.mocked(pool.ensureRelay).mockReset().mockResolvedValue({ connected: true } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe("fetchGroupMetadataResult", () => {
  it("reached=true when the relay answers with groups", async () => {
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      h.onevent(groupEvent("room-a", "Room A"));
      h.oneose();
      return { close: vi.fn() } as any;
    });
    const r = await fetchGroupMetadataResult(RELAY);
    expect(r.reached).toBe(true);
    expect(r.groups.map((g) => g.id)).toEqual(["room-a"]);
  });

  it("reached=true when the relay answers with NOTHING — that is a real answer", async () => {
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      h.oneose();
      return { close: vi.fn() } as any;
    });
    const r = await fetchGroupMetadataResult(RELAY);
    expect(r.reached).toBe(true);
    expect(r.groups).toEqual([]);
  });

  it("reached=FALSE when the relay will not connect — the bug", async () => {
    // MEASURED, not assumed: a dead relay's subscription still EOSEs (143ms,
    // zero events), so EOSE cannot be the signal. ensureRelay rejects.
    vi.mocked(pool.ensureRelay).mockRejectedValue(new Error("connection failed"));
    const r = await fetchGroupMetadataResult(RELAY);
    expect(r.reached).toBe(false);
    expect(r.groups).toEqual([]);
    // And it does not even open a subscription against a relay it cannot reach.
    expect(pool.subscribeMany).not.toHaveBeenCalled();
  });

  it("a connected relay that EOSEs instantly with nothing is still reached", async () => {
    // This is exactly the shape a DEAD relay produced before the fix, which is
    // why connecting has to be checked separately from the query completing.
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      h.oneose();
      return { close: vi.fn() } as any;
    });
    const r = await fetchGroupMetadataResult(RELAY);
    expect(r.reached).toBe(true);
    expect(r.groups).toEqual([]);
  });

  it("a connected relay that never EOSEs still returns what it sent", async () => {
    vi.useFakeTimers();
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      h.onevent(groupEvent("room-b", "Room B"));
      return { close: vi.fn() } as any;
    });
    const p = fetchGroupMetadataResult(RELAY, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;
    expect(r.reached).toBe(true);
    expect(r.groups.map((g) => g.id)).toEqual(["room-b"]);
  });

  it("closes the subscription on both paths", async () => {
    const close = vi.fn();
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      h.oneose();
      return { close } as any;
    });
    await fetchGroupMetadataResult(RELAY);
    expect(close).toHaveBeenCalled();
  });
});

/**
 * The timeout decides when the UI stops waiting — not when we stop listening.
 *
 * Whatever made us give up, hanging up on the answer makes it strictly worse:
 * the rooms exist, they are merely late, and closing the subscription
 * guarantees we never see them. So the promise resolves on time with
 * `reached: false`, the subscription stays open, and a late answer still
 * reaches the caller.
 *
 * (Built after a relay appeared to take ~27s. That figure was an artifact of
 * measuring on a socket contending with the app's own pool — the same query is
 * ~87ms through the pool. The behaviour is still worth having; the motivating
 * number was wrong.)
 */
describe("fetchGroupMetadataResult late answers", () => {
  it("resolves on time as unreached, then delivers rooms that arrive afterwards", async () => {
    vi.useFakeTimers();
    let handlers: any;
    const close = vi.fn();
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      handlers = h;
      return { close } as any;
    });

    const late: number[] = [];
    const p = fetchGroupMetadataResult(RELAY, 1000, { onLate: (g) => late.push(g.length) });
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;

    // Gave up honestly...
    expect(r.reached).toBe(false);
    expect(r.groups).toEqual([]);
    // ...but did NOT hang up.
    expect(close).not.toHaveBeenCalled();

    // The relay finally answers.
    handlers.onevent(groupEvent("late-room", "Late Room"));
    await vi.advanceTimersByTimeAsync(300);
    expect(late).toEqual([1]);
  });

  it("closes the late window on a real EOSE, so a finished relay is not held open", async () => {
    vi.useFakeTimers();
    let handlers: any;
    const close = vi.fn();
    vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
      handlers = h;
      return { close } as any;
    });

    const p = fetchGroupMetadataResult(RELAY, 1000, { onLate: () => {} });
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    expect(close).not.toHaveBeenCalled();

    handlers.onevent(groupEvent("r1", "R1"));
    handlers.oneose();
    await vi.advanceTimersByTimeAsync(300);
    expect(close).toHaveBeenCalled();
  });

  it("a silent relay cannot leak the subscription — the ceiling closes it", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    vi.mocked(pool.subscribeMany).mockImplementation(() => ({ close }) as any);

    const p = fetchGroupMetadataResult(RELAY, 1000, { onLate: () => {}, lateWindowMs: 5000 });
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    expect(close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5100);
    expect(close).toHaveBeenCalled();
  });

  it("without onLate the old behaviour stands: give up and close", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    vi.mocked(pool.subscribeMany).mockImplementation(() => ({ close }) as any);

    const p = fetchGroupMetadataResult(RELAY, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    const r = await p;
    expect(r.reached).toBe(false);
    expect(close).toHaveBeenCalled();
  });
});
