/**
 * The reachability primitive, pinned against the behaviour that fooled me once.
 *
 * The first version of this logic used EOSE as the signal. It had passing unit
 * tests and the resulting UI state could never appear, because the mock was
 * written to match my assumption rather than nostr-tools' actual behaviour:
 * SimplePool fires `oneose` when a relay FAILS to connect. So these tests mock
 * `ensureRelay` — the thing that genuinely rejects — and the EOSE case is
 * covered separately in nip29-reach.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/nostr", () => ({
  pool: { ensureRelay: vi.fn(), subscribeMany: vi.fn() },
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  publishEvent: vi.fn(),
}));

import { pool } from "@/lib/nostr";
import { canReachRelay, canReachAny, withReach } from "./relay-reach";

const UP = "wss://up.example";
const DOWN = "wss://down.example";

beforeEach(() => {
  vi.mocked(pool.ensureRelay).mockReset().mockImplementation(async (url: string) => {
    if (url === DOWN) throw new Error("connection failed");
    return { connected: true } as any;
  });
});

describe("canReachRelay", () => {
  it("true when the socket opens", async () => {
    expect(await canReachRelay(UP)).toBe(true);
  });
  it("false when it does not — and never throws", async () => {
    await expect(canReachRelay(DOWN)).resolves.toBe(false);
  });
});

describe("withReach", () => {
  it("runs the fetch and reports reached when the relay is up", async () => {
    const run = vi.fn().mockResolvedValue([1, 2, 3]);
    const r = await withReach(UP, [] as number[], run);
    expect(r).toEqual({ data: [1, 2, 3], reached: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("an EMPTY answer from a reachable relay is still reached", async () => {
    // The distinction the whole module exists for: this is a real answer, and
    // the caller may say "there are none".
    const r = await withReach(UP, [] as number[], async () => []);
    expect(r).toEqual({ data: [], reached: true });
  });

  it("does not run the fetch at all when the relay is unreachable", async () => {
    const run = vi.fn();
    const r = await withReach(DOWN, [] as number[], run);
    expect(r).toEqual({ data: [], reached: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("lets a genuine fetch error propagate rather than disguising it as empty", async () => {
    // Swallowing here would rebuild the same defect one layer up: a thrown
    // fetch would become an innocent-looking empty list.
    await expect(withReach(UP, [] as number[], async () => { throw new Error("parse blew up"); }))
      .rejects.toThrow("parse blew up");
  });
});

describe("canReachAny", () => {
  it("true if ANY relay answers — one live relay is a thin answer, but an answer", async () => {
    expect(await canReachAny([DOWN, UP, DOWN])).toBe(true);
  });
  it("false only when every relay is unreachable", async () => {
    expect(await canReachAny([DOWN, DOWN])).toBe(false);
  });
  it("false for an empty set — nothing was asked", async () => {
    expect(await canReachAny([])).toBe(false);
  });
});
