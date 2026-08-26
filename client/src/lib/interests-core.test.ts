// Guards the kind-10015 "Interests" (followed hashtags) WIPE FOOTGUN — the same
// class of bug that bit the kind-3 follow list. kind-10015 is a single
// replaceable event shared across every one of the user's Nostr apps, so an
// incremental follow/unfollow must merge into the CURRENT list; a write built on
// an unknown/empty base would replace (wipe) hashtags another client added.
//
// These test the PURE core (interests-core.ts) directly — no mocks — and lock:
// parse, merge-add (dedup + lowercase + strip "#"), remove (preserving other
// tags), and the wipe-guard DECISION (resolveBase: unknown base for a KNOWN
// account → blocked, so the caller never publishes; known base → returned intact
// so mergeAddTag/removeTag preserve every existing "t" AND non-"t" tag).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeHashtag,
  parseInterests,
  cacheInterestsEvent,
  getCachedInterestsEvent,
  getFollowedHashtags,
  hasKnownInterests,
  isHashtagFollowed,
  mergeAddTag,
  removeTag,
  resolveBase,
  KIND_INTERESTS,
} from "./interests-core";
import type { Event } from "nostr-tools";

const PK = "a".repeat(64);

// Deterministic localStorage (node env has none) — interests' durable cache.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
  key: (i: number) => Array.from(__store.keys())[i] ?? null,
  get length() { return __store.size; },
});

function mkInterestsEvent(tags: string[][], created_at: number, content = "", pubkey = PK): Event {
  return { id: "id" + created_at, kind: KIND_INTERESTS, pubkey, created_at, tags, content, sig: "sig" } as Event;
}
const tTags = (...hashtags: string[]): string[][] => hashtags.map((h) => ["t", h]);

beforeEach(() => { __store.clear(); });

describe("normalizeHashtag", () => {
  it("lowercases, trims, and strips leading #", () => {
    expect(normalizeHashtag("  #Nostr ")).toBe("nostr");
    expect(normalizeHashtag("##BITCOIN")).toBe("bitcoin");
    expect(normalizeHashtag("")).toBe("");
  });
});

describe("parseInterests (kind-10015 event → hashtag list)", () => {
  it("extracts lowercased 't' tag hashtags, dedups, ignores other tags", () => {
    const ev = mkInterestsEvent(
      [["t", "Nostr"], ["t", "bitcoin"], ["p", "x".repeat(64)], ["t", "nostr"], ["title", "junk"]],
      1000,
    );
    expect(parseInterests(ev)).toEqual(["nostr", "bitcoin"]);
  });
  it("returns [] for null / undefined / no tags", () => {
    expect(parseInterests(null)).toEqual([]);
    expect(parseInterests(undefined)).toEqual([]);
  });
});

describe("mergeAddTag — dedups, lowercases, strips #, preserves everything", () => {
  it("appends a normalized new tag", () => {
    expect(mergeAddTag(tTags("nostr"), "#Bitcoin")).toEqual([["t", "nostr"], ["t", "bitcoin"]]);
  });
  it("is idempotent — re-adding an existing (differently-cased) tag is a no-op", () => {
    expect(mergeAddTag(tTags("nostr"), "NOSTR")).toEqual([["t", "nostr"]]);
  });
  it("preserves non-'t' tags added by other clients", () => {
    const base = [["t", "nostr"], ["emoji", "shrug", "url"]];
    const out = mergeAddTag(base, "art");
    expect(out).toContainEqual(["emoji", "shrug", "url"]);
    expect(parseInterests(mkInterestsEvent(out, 1))).toEqual(["nostr", "art"]);
  });
});

describe("removeTag — removes only the target, preserves the rest + non-'t' tags", () => {
  it("removes the matching hashtag (case-insensitive) only", () => {
    const base = [["t", "nostr"], ["t", "bitcoin"], ["t", "art"], ["emoji", "keep"]];
    const out = removeTag(base, "#Bitcoin");
    expect(parseInterests(mkInterestsEvent(out, 1))).toEqual(["nostr", "art"]);
    expect(out).toContainEqual(["emoji", "keep"]);
  });
});

describe("durable cache (never shrink on hydration, force overrides)", () => {
  it("round-trips and rejects wrong-kind events", () => {
    cacheInterestsEvent(mkInterestsEvent(tTags("nostr"), 1));
    expect(getFollowedHashtags(PK)).toEqual(["nostr"]);
    cacheInterestsEvent({ ...mkInterestsEvent(tTags("x"), 1), kind: 1 } as Event);
    expect(getFollowedHashtags(PK)).toEqual(["nostr"]);
  });
  it("hydration never overwrites a fuller cache with a smaller/newer one", () => {
    cacheInterestsEvent(mkInterestsEvent(tTags("a", "b", "c"), 1000));
    cacheInterestsEvent(mkInterestsEvent(tTags("a"), 2000));
    expect(getFollowedHashtags(PK)).toEqual(["a", "b", "c"]);
  });
  it("force stores even a deliberate shrink (user unfollow)", () => {
    cacheInterestsEvent(mkInterestsEvent(tTags("a", "b", "c"), 1000));
    cacheInterestsEvent(mkInterestsEvent(tTags("a"), 2000), { force: true });
    expect(getFollowedHashtags(PK)).toEqual(["a"]);
  });
  it("isHashtagFollowed reflects the cache, case-insensitively", () => {
    cacheInterestsEvent(mkInterestsEvent(tTags("nostr", "bitcoin"), 1000));
    expect(isHashtagFollowed(PK, "#Bitcoin")).toBe(true);
    expect(isHashtagFollowed(PK, "art")).toBe(false);
  });
});

describe("WIPE-GUARD decision (resolveBase)", () => {
  it("KNOWN account + no obtainable base → BLOCKED (caller must not publish)", () => {
    // We have durable evidence a list exists (the "seen" marker set when we first
    // cached a real list)...
    cacheInterestsEvent(mkInterestsEvent(tTags("nostr", "art"), 1000));
    // ...but the cached EVENT is now gone (cleared/corrupt) and neither the
    // eventStore nor the relays returned it. This is the exact fresh-device /
    // slow-relay scenario that would wipe a remote list if unguarded.
    __store.delete(`relay_outpost_interests_event_${PK}`);
    expect(hasKnownInterests(PK)).toBe(true); // knownness survives the event loss

    const res = resolveBase(PK, /* candidate */ null, /* cached */ getCachedInterestsEvent(PK));
    expect(res.base).toBeNull();
    expect(res.blocked).toBe(true); // → followHashtag aborts, publishes NOTHING
  });

  it("KNOWN base present → returned INTACT so the merge preserves every tag", () => {
    // Base from another client: two hashtags + a non-'t' tag + opaque content.
    const otherClientBase = mkInterestsEvent(
      [["t", "nostr"], ["t", "bitcoin"], ["emoji", "shrug", "url"]],
      1000,
      "opaque-content",
    );
    const res = resolveBase(PK, otherClientBase, null);
    expect(res.blocked).toBe(false);
    expect(res.base).toBe(otherClientBase);

    // What followHashtag would then publish: mergeAddTag over the base tags.
    const published = mergeAddTag(res.base!.tags, "#Photography");
    expect(parseInterests(mkInterestsEvent(published, 2000))).toEqual(["nostr", "bitcoin", "photography"]);
    expect(published).toContainEqual(["emoji", "shrug", "url"]); // no other-client data dropped
    expect(res.base!.content).toBe("opaque-content"); // content carried through by caller
  });

  it("prefers the NEWER of candidate and durable cache", () => {
    const olderLarger = mkInterestsEvent(tTags("a", "b", "c"), 1000);
    const newerSmaller = mkInterestsEvent(tTags("a"), 3000);
    cacheInterestsEvent(newerSmaller, { force: true });
    const res = resolveBase(PK, olderLarger, getCachedInterestsEvent(PK));
    expect(parseInterests(res.base)).toEqual(["a"]); // newer wins (cross-device unfollow honored)
  });

  it("brand-NEW account (never seen) → base null, NOT blocked (safe first write)", () => {
    expect(hasKnownInterests(PK)).toBe(false);
    const res = resolveBase(PK, null, null);
    expect(res.base).toBeNull();
    expect(res.blocked).toBe(false); // no prior data anywhere → safe to create list
  });
});
