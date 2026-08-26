/**
 * Profile cache: what the app can still answer about someone after a long session.
 *
 * lib/nostr keeps THREE stores for the same kind-0, and they are not the same size:
 *
 *   eventStore           unbounded, and kind 0 is in KEEP_KINDS so its own pruner
 *                        never touches profiles — the durable record for a session
 *   sessionProfileCache  capped at PROFILE_SESSION_MAX, evicted by INSERTION ORDER
 *   globalProfileCache   unbounded Set — the "we already asked for this" ledger
 *
 * The bug these tests exist for: the lookup read only the middle one — the
 * smallest and most aggressively pruned — while the ledger that suppresses
 * re-fetching is unbounded. So a profile could be evicted from the cache, still be
 * sitting in the store, and still be marked as fetched, and the app would answer
 * "I don't know who that is" about someone it demonstrably knew. Permanently:
 * fetchProfilesCached skips anything the ledger has seen, so nothing ever asked
 * again for the rest of the session.
 *
 * It hit the accounts that matter most. Follows are registered FIRST, at login, so
 * insertion-order eviction takes them FIRST — a live probe found 7 of 18 follows
 * nameless after ordinary feed use. That set is exactly the trusted list the
 * impersonation guard compares candidates against, so the guard ran at partial
 * strength with no way to report it.
 *
 * These exercise the REAL module rather than a stub, because the defect lived in
 * the interaction between the three stores — a stub would have modelled it away.
 * Events are really signed for the same reason: EventStore.add silently declines
 * to index anything whose id/signature doesn't verify, so hand-rolled fixtures
 * would have produced a passing-looking test of nothing at all.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";

// node has neither; both writes are fire-and-forget inside try/catch, so a Map is
// a faithful stand-in (same approach as media-sync.test.ts).
const mem = new Map<string, string>();
const shim = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
vi.stubGlobal("sessionStorage", shim);
vi.stubGlobal("localStorage", shim);

/** PROFILE_SESSION_MAX is 1000 when navigator.deviceMemory is absent (node). */
const SESSION_MAX = 1000;

function signedProfile(name: string) {
  const sk = generateSecretKey();
  const event = finalizeEvent(
    { kind: 0, content: JSON.stringify({ name, display_name: name }), created_at: 1_700_000_000, tags: [] },
    sk,
  );
  return { pubkey: getPublicKey(sk), event };
}

let nostr: typeof import("@/lib/nostr");
let earliest: ReturnType<typeof signedProfile>;

beforeAll(async () => {
  nostr = await import("@/lib/nostr");

  // Someone learned at login — the follow — then buried under a feed's worth of
  // strangers. Registered first, so first out of an insertion-order eviction.
  earliest = signedProfile("Earliest");
  nostr.registerProfileInAllCaches(earliest.event);

  for (let i = 0; i < SESSION_MAX + 50; i++) {
    nostr.registerProfileInAllCaches(signedProfile(`Stranger ${i}`).event);
  }
}, 60_000);

describe("profile cache under session pressure", () => {
  it("still resolves a profile registered before the cap was exceeded", () => {
    const found = nostr.getCachedProfile(earliest.pubkey);
    expect(found).toBeTruthy();
    expect(JSON.parse(found.content).name).toBe("Earliest");
  });

  it("never reports a profile as cached that it cannot then produce", () => {
    // The invariant the bug broke, stated directly. isProfileCached() is what
    // suppresses re-fetching, so a `true` here that getCachedProfile can't honour
    // is not a cache miss — it is a permanent one.
    expect(nostr.isProfileCached(earliest.pubkey)).toBe(true);
    expect(nostr.getCachedProfile(earliest.pubkey)).toBeTruthy();
  });

  it("resolves a profile registered after the cache is already full", () => {
    const late = signedProfile("Late");
    nostr.registerProfileInAllCaches(late.event);
    expect(nostr.getCachedProfile(late.pubkey)).toBeTruthy();
  });

  it("returns undefined for someone genuinely unknown", () => {
    // The fallback must not turn a real miss into a phantom hit: a caller that
    // can no longer tell "unknown" from "known" would stop fetching entirely.
    const stranger = getPublicKey(generateSecretKey());
    expect(nostr.getCachedProfile(stranger)).toBeUndefined();
    expect(nostr.isProfileCached(stranger)).toBe(false);
  });
});
