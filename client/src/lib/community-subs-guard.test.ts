// @vitest-environment node
/**
 * kind-10073 is REPLACEABLE, so publishing an empty one deletes the real one.
 *
 * New joins are hidden from the public profile by default, and hidden URLs are
 * filtered out of the published list. So an account with real outposts computes
 * ZERO tags, and publishing that erases whatever was there.
 *
 * Observed live 2026-08-03: a join published a kind-10073 with zero `I` tags,
 * seconds after a different account was confirmed to have a healthy three-relay
 * one. Same shape as the kind-10009 wipe — a replaceable event built from a
 * filtered local view and published unconditionally.
 *
 * Empty is legitimate for exactly two actions, and both say so explicitly:
 * leaving your last outpost, and hiding your last outpost. Everything else must
 * decline rather than replace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module scope, so the spies they close
// over have to be hoisted too.
const { publishEvent, signEvent } = vi.hoisted(() => ({
  publishEvent: vi.fn().mockResolvedValue(true),
  signEvent: vi.fn(async (t: any) => ({ ...t, id: "e".repeat(64), sig: "00" })),
}));

vi.mock("@/lib/nostr", () => ({
  pool: { subscribeMany: vi.fn(), ensureRelay: vi.fn() },
  publishEvent,
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
}));
vi.mock("./session-signer", () => ({
  resolveSessionSigner: () => ({ signEvent, getPublicKey: async () => "a".repeat(64) }),
}));
vi.mock("@/lib/signer-timeout", () => ({
  withSignerTimeout: (p: Promise<any>) => p,
  SIGNER_SIGN_TIMEOUT: 10_000,
}));

const PUBKEY = "a".repeat(64);
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
(globalThis as any).window = { dispatchEvent: () => {}, CustomEvent: class {} };
(globalThis as any).CustomEvent = class { constructor(public type: string, public init?: any) {} };

import { publishCommunitySubscriptions } from "./outpost-relays";

/** An account with real outposts, all hidden from the profile (the join default). */
function outpostsAllHidden(urls: string[]) {
  store.clear();
  store.set("nostr_outpost_relays", JSON.stringify(urls.map((url) => ({ url, label: url, access: "public" }))));
  store.set(`relay-outpost-hidden-badges:${PUBKEY}`, JSON.stringify(urls));
}

/** The tags of the event we tried to publish, or null if we published nothing. */
function publishedTags(): string[][] | null {
  if (publishEvent.mock.calls.length === 0) return null;
  return publishEvent.mock.calls[0][0].tags;
}

beforeEach(() => {
  publishEvent.mockClear();
  signEvent.mockClear();
  store.clear();
});

describe("publishCommunitySubscriptions", () => {
  it("REFUSES to publish an empty list over real outposts — the wipe", async () => {
    outpostsAllHidden(["wss://a.example", "wss://b.example"]);
    const ok = await publishCommunitySubscriptions();
    expect(ok).toBe(false);
    expect(publishedTags()).toBeNull();
  });

  it("publishes empty when the caller says the emptiness is the point", async () => {
    // Hiding your last outpost, or leaving it — the profile list SHOULD clear.
    outpostsAllHidden(["wss://a.example"]);
    const ok = await publishCommunitySubscriptions({ allowEmpty: true });
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([]);
  });

  it("publishes the visible ones normally", async () => {
    store.set("nostr_outpost_relays", JSON.stringify([
      { url: "wss://shown.example", label: "shown", access: "public" },
      { url: "wss://hidden.example", label: "hidden", access: "public" },
    ]));
    store.set(`relay-outpost-hidden-badges:${PUBKEY}`, JSON.stringify(["wss://hidden.example"]));
    const ok = await publishCommunitySubscriptions();
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([["I", "wss://shown.example"]]);
  });

  it("an account with no outposts at all may publish empty without asking", async () => {
    // Nothing local to protect, so there is no wipe to prevent — and refusing
    // here would strand anyone who genuinely left everything.
    store.set("nostr_outpost_relays", JSON.stringify([]));
    const ok = await publishCommunitySubscriptions();
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([]);
  });
});
