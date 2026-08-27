// Locks the client-tag OPT-IN (owner decision 2026-08-27, flipping the earlier
// default): publishing which app someone uses is metadata about them, so the
// tag is OFF unless the user turns it on in Settings. Explicit choices in
// either direction keep working — only the unset default changed.

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage; the gate reads it synchronously.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

import { clientTags, CLIENT_TAG, CLIENT_TAG_ENABLED_KEY, buildReactionTags, buildRepostTags } from "./nostr-helpers";
import type { Event } from "nostr-tools";

const ev = { id: "abc", pubkey: "pk", kind: 1, tags: [], content: "", created_at: 0, sig: "sig" } as Event;
const hasClient = (tags: string[][]) => tags.some((t) => t[0] === "client");

beforeEach(() => __store.clear());

describe("clientTags() gate", () => {
  it("default (unset) → NO client tag: attribution is opt-in", () => {
    expect(clientTags()).toEqual([]);
  });

  it('explicit "true" → includes the client tag', () => {
    localStorage.setItem(CLIENT_TAG_ENABLED_KEY, "true");
    expect(clientTags()).toEqual([CLIENT_TAG]);
  });

  it('"false" → omits it (empty, spreadable)', () => {
    localStorage.setItem(CLIENT_TAG_ENABLED_KEY, "false");
    expect(clientTags()).toEqual([]);
  });
});

describe("tag builders honor the gate", () => {
  it("reaction + repost omit the client tag by default — opt-in like everything else", () => {
    expect(hasClient(buildReactionTags(ev))).toBe(false);
    expect(hasClient(buildRepostTags(ev))).toBe(false);
  });

  it("reaction + repost carry the client tag when the user opted in", () => {
    localStorage.setItem(CLIENT_TAG_ENABLED_KEY, "true");
    expect(hasClient(buildReactionTags(ev))).toBe(true);
    expect(hasClient(buildRepostTags(ev))).toBe(true);
  });
});
