/**
 * The kind-10009 wipe guard.
 *
 * Joining or leaving a room rebuilds the ENTIRE joined-rooms list from whatever
 * `fetchSimpleGroupsList` returned and publishes it as a replaceable event. That
 * fetch resolves [] both when the account has no rooms and when none of its
 * three relays could be reached — so an offline join published a 1-entry
 * kind-10009 over every room the user had.
 *
 * This is the kind-3 follow-list footgun (lib/follow-list.ts) on another kind.
 * These tests pin the distinction that guard depends on: reached-and-empty is a
 * real answer and must still let a new account create its first list;
 * never-reached is not an answer and must abort.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/nostr", () => ({
  pool: { ensureRelay: vi.fn(), subscribeMany: vi.fn(), subscribeMap: vi.fn() },
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  publishEvent: vi.fn(),
  publishEventDetailed: vi.fn(),
}));

import { pool } from "@/lib/nostr";
import { loadSimpleGroupsBase, KIND_SIMPLE_GROUPS_LIST } from "./nip29";

const PUBKEY = "a".repeat(64);

// This suite runs under the `node` environment, where there is no
// localStorage — and the guard wraps every access in try/catch, so without a
// stub the durable-evidence half would silently no-op and its tests would pass
// for the wrong reason.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

/** A kind-10009 listing rooms as ["group", <id>, <relay>, <name>] tags. */
const listEvent = (rooms: Array<[string, string]>) => ({
  kind: KIND_SIMPLE_GROUPS_LIST,
  id: "evt-list",
  pubkey: PUBKEY,
  created_at: 1_700_000_000,
  sig: "",
  content: "",
  tags: rooms.map(([id, relay]) => ["group", id, relay]),
});

/** The relay set answers, and hands back these rooms (or nothing). */
function relaysAnswer(rooms: Array<[string, string]> | null) {
  vi.mocked(pool.ensureRelay).mockResolvedValue({ connected: true } as any);
  vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
    if (rooms) h.onevent(listEvent(rooms));
    h.oneose();
    return { close: vi.fn() } as any;
  });
}

/** Nothing in the relay set can be reached. */
function relaysDown() {
  vi.mocked(pool.ensureRelay).mockRejectedValue(new Error("connection failed"));
  vi.mocked(pool.subscribeMany).mockImplementation((_r, _f, h: any) => {
    // MEASURED: a dead relay still EOSEs, with zero events. This is exactly why
    // the fetch alone cannot tell the two cases apart.
    h.oneose();
    return { close: vi.fn() } as any;
  });
}

beforeEach(() => {
  vi.mocked(pool.ensureRelay).mockReset();
  vi.mocked(pool.subscribeMany).mockReset();
  localStorage.clear();
});

describe("loadSimpleGroupsBase", () => {
  it("returns the rooms when the relays answer", async () => {
    relaysAnswer([["room-a", "wss://a.example"], ["room-b", "wss://b.example"]]);
    const base = await loadSimpleGroupsBase(PUBKEY);
    expect(base.blocked).toBe(false);
    expect(base.entries.map((e) => e.groupId)).toEqual(["room-a", "room-b"]);
  });

  it("BLOCKS when no relay could be reached — the wipe", async () => {
    relaysDown();
    const base = await loadSimpleGroupsBase(PUBKEY);
    expect(base.blocked).toBe(true);
    expect(base.entries).toEqual([]);
  });

  it("lets a brand-new account create its first list", async () => {
    // Reached, genuinely empty, no history. Blocking here would mean nobody
    // could ever join their first room.
    relaysAnswer(null);
    const base = await loadSimpleGroupsBase(PUBKEY);
    expect(base.blocked).toBe(false);
    expect(base.entries).toEqual([]);
  });

  it("BLOCKS on an empty read when we know this account had rooms", async () => {
    // The subtler case the reachability signal can't catch: relays answered,
    // but hadn't seen this account's list. follow-list.ts guards the same way.
    relaysAnswer([["room-a", "wss://a.example"]]);
    await loadSimpleGroupsBase(PUBKEY);

    relaysAnswer(null);
    const base = await loadSimpleGroupsBase(PUBKEY);
    expect(base.blocked).toBe(true);
  });

  it("keeps that evidence per-account", async () => {
    relaysAnswer([["room-a", "wss://a.example"]]);
    await loadSimpleGroupsBase(PUBKEY);

    // A different account with no history is still free to start a list.
    relaysAnswer(null);
    const other = await loadSimpleGroupsBase("b".repeat(64));
    expect(other.blocked).toBe(false);
  });

  it("does not even query a relay set it cannot reach", async () => {
    relaysDown();
    await loadSimpleGroupsBase(PUBKEY);
    expect(pool.subscribeMany).not.toHaveBeenCalled();
  });
});
