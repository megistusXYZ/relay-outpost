// Guards the follow-list WIPE FOOTGUN (it has bitten real users twice). The cache
// must never let a smaller/older kind-3 overwrite a fuller/newer one during the
// post-login hydration race, and loadFollowBase must BLOCK (not wipe) when it can't
// obtain an authoritative base for an account known to have follows.

import { describe, it, expect, beforeEach, vi } from "vitest";

// follow-list.ts transitively imports the heavy nostr.ts graph (IndexedDB at load).
// Stub it + outbox so the pure cache/base logic is testable in isolation.
vi.mock("@/lib/nostr", () => ({
  pool: { querySync: vi.fn() },
  eventStore: { getReplaceable: vi.fn(), add: vi.fn() },
  DEFAULT_RELAYS: [] as string[],
}));
vi.mock("@/lib/outbox", () => ({
  getWriteRelays: () => [] as string[],
  getReadRelays: () => [] as string[],
}));

import {
  cacheFollowEvent,
  getCachedFollowEvent,
  hasKnownFollows,
  loadFollowBase,
} from "./follow-list";
import { pool, eventStore } from "@/lib/nostr";
import type { Event } from "nostr-tools";

// Deterministic localStorage (node env has none) — follow-list's durable cache.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
  key: (i: number) => Array.from(__store.keys())[i] ?? null,
  get length() { return __store.size; },
});

const PK = "a".repeat(64);

function mkFollowEvent(pubkeys: string[], created_at: number, pubkey = PK): Event {
  return {
    id: "id" + created_at,
    kind: 3,
    pubkey,
    created_at,
    tags: pubkeys.map((p) => ["p", p]),
    content: "",
    sig: "sig",
  } as Event;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pool.querySync).mockReset();
  vi.mocked(eventStore.getReplaceable).mockReset();
  vi.mocked(eventStore.add).mockReset();
});

describe("cacheFollowEvent / getCachedFollowEvent", () => {
  it("round-trips a valid kind-3", () => {
    const ev = mkFollowEvent(["b".repeat(64), "c".repeat(64)], 1000);
    cacheFollowEvent(ev);
    const got = getCachedFollowEvent(PK);
    expect(got?.tags.filter((t) => t[0] === "p")).toHaveLength(2);
  });

  it("ignores non-kind-3 events", () => {
    cacheFollowEvent({ ...mkFollowEvent([], 1), kind: 1 } as Event);
    expect(getCachedFollowEvent(PK)).toBeNull();
  });

  it("default mode: never shrinks the cache (wipe guard)", () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64), "d".repeat(64)], 1000));
    // A wipe event (1 follow, newer timestamp) must NOT overwrite the fuller list.
    cacheFollowEvent(mkFollowEvent(["b".repeat(64)], 2000));
    expect(getCachedFollowEvent(PK)?.tags.filter((t) => t[0] === "p")).toHaveLength(3);
  });

  it("default mode: never overwrites a newer cache with an older event", () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64)], 2000));
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64), "d".repeat(64)], 1000));
    expect(getCachedFollowEvent(PK)?.created_at).toBe(2000);
  });

  it("default mode: accepts a newer, at-least-as-full list", () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64)], 1000));
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64), "d".repeat(64)], 2000));
    expect(getCachedFollowEvent(PK)?.created_at).toBe(2000);
    expect(getCachedFollowEvent(PK)?.tags.filter((t) => t[0] === "p")).toHaveLength(3);
  });

  it("force mode: stores even a deliberate shrink (user-initiated unfollow)", () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64), "d".repeat(64)], 1000));
    cacheFollowEvent(mkFollowEvent(["b".repeat(64)], 2000), { force: true });
    expect(getCachedFollowEvent(PK)?.tags.filter((t) => t[0] === "p")).toHaveLength(1);
  });
});

describe("hasKnownFollows", () => {
  it("true when the durable cache has follows", () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64)], 1000));
    expect(hasKnownFollows(PK)).toBe(true);
  });

  it("true via the legacy snapshot key", () => {
    localStorage.setItem(
      `flight_log_contacts_${PK.slice(0, 16)}`,
      JSON.stringify({ pubkeys: ["b".repeat(64)], timestamp: 1 }),
    );
    expect(hasKnownFollows(PK)).toBe(true);
  });

  it("false when nothing is known", () => {
    expect(hasKnownFollows(PK)).toBe(false);
  });
});

describe("loadFollowBase", () => {
  it("returns the eventStore base when present (no relay fetch)", async () => {
    const ev = mkFollowEvent(["b".repeat(64)], 5000);
    vi.mocked(eventStore.getReplaceable).mockReturnValue(ev as any);
    const res = await loadFollowBase(PK);
    expect(res.blocked).toBe(false);
    expect(res.base?.created_at).toBe(5000);
    expect(pool.querySync).not.toHaveBeenCalled();
  });

  it("prefers the NEWER of fetched vs cache (no resurrecting a cross-device unfollow)", async () => {
    // Stale-but-larger cache; newer authoritative fetch with fewer follows must win.
    cacheFollowEvent(mkFollowEvent(["b".repeat(64), "c".repeat(64)], 1000));
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined as any);
    vi.mocked(pool.querySync).mockResolvedValue([mkFollowEvent(["b".repeat(64)], 9000)] as any);
    const res = await loadFollowBase(PK);
    expect(res.base?.created_at).toBe(9000);
    expect(res.blocked).toBe(false);
  });

  it("blocks (never wipes) when no base is found but follows are known", async () => {
    cacheFollowEvent(mkFollowEvent(["b".repeat(64)], 1000)); // durable evidence...
    localStorage.removeItem(`relay_outpost_follow_event_${PK}`); // ...but cache cleared
    // Re-seed only the legacy snapshot so hasKnownFollows is true with no kind-3 base.
    localStorage.setItem(
      `flight_log_contacts_${PK.slice(0, 16)}`,
      JSON.stringify({ pubkeys: ["b".repeat(64)] }),
    );
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined as any);
    vi.mocked(pool.querySync).mockResolvedValue([] as any);
    const res = await loadFollowBase(PK);
    expect(res.base).toBeNull();
    expect(res.blocked).toBe(true);
  });

  it("allows a genuinely new account (no base, no known follows) to create its first list", async () => {
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined as any);
    vi.mocked(pool.querySync).mockResolvedValue([] as any);
    const res = await loadFollowBase(PK);
    expect(res.base).toBeNull();
    expect(res.blocked).toBe(false);
  });

  it("blocks when caller passes a non-zero in-memory follow count but no base is found", async () => {
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined as any);
    vi.mocked(pool.querySync).mockResolvedValue([] as any);
    const res = await loadFollowBase(PK, 12);
    expect(res.blocked).toBe(true);
  });
});
