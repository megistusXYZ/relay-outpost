// @vitest-environment node
/**
 * kind-10002 is REPLACEABLE, so publishing one built on a read nobody answered
 * DELETES the user's NIP-65 relay list — the record every other client on the
 * network uses to find them.
 *
 * The old fetch resolved `[]` on a 6s timer with no way to say "we never got an
 * answer", and updateNip65RelayList built the next list straight from it. The
 * `remove` path was the worse of the two: `[].filter(...)` is `[]`, so leaving
 * an outpost published a kind-10002 with ZERO tags. `add` published a single-`r`
 * list, deleting every other relay the user had. Both fire on ordinary
 * Join/Leave.
 *
 * Fourth instance of this shape in this codebase — kind-3, kind-10009,
 * kind-10073, now kind-10002 — which is why the guard is a shared primitive
 * (queryAnswered) rather than another local flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { publishEvent, signEvent, queryAnswered } = vi.hoisted(() => ({
  publishEvent: vi.fn().mockResolvedValue(true),
  signEvent: vi.fn(async (t: any) => ({ ...t, id: "e".repeat(64), sig: "00" })),
  queryAnswered: vi.fn(),
}));

vi.mock("@/lib/nostr", () => ({
  pool: { subscribeMany: vi.fn(), ensureRelay: vi.fn() },
  publishEvent,
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
}));
vi.mock("./relay-reach", () => ({ queryAnswered }));
vi.mock("./session-signer", () => ({
  resolveSessionSigner: () => ({ signEvent, getPublicKey: async () => "a".repeat(64) }),
}));
vi.mock("@/lib/signer-timeout", () => ({
  withSignerTimeout: (p: Promise<any>) => p,
  SIGNER_SIGN_TIMEOUT: 10_000,
}));
vi.mock("@/lib/nip11", () => ({ fetchNip11: vi.fn().mockResolvedValue(null) }));

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
(globalThis as any).window = { dispatchEvent: () => {} };
(globalThis as any).CustomEvent = class { constructor(public type: string, public init?: any) {} };

import { updateNip65RelayList } from "./outpost-relays";

const relayTag = (url: string) => ["r", url];
/** The tags of the kind-10002 we tried to publish, or null if we published nothing. */
function publishedTags(): string[][] | null {
  if (publishEvent.mock.calls.length === 0) return null;
  return publishEvent.mock.calls[0][0].tags;
}

beforeEach(() => {
  publishEvent.mockClear();
  signEvent.mockClear();
  queryAnswered.mockReset();
  store.clear();
});

describe("updateNip65RelayList", () => {
  it("REFUSES to publish when nobody answered — leaving would have deleted the list", async () => {
    // The exact live shape: timer fired, zero events, so `[]` is not a fact.
    queryAnswered.mockResolvedValue({ events: [], answered: false });
    const ok = await updateNip65RelayList("remove", "wss://leaving.example");
    expect(ok).toBe(false);
    expect(publishedTags()).toBeNull();
  });

  it("REFUSES on the add path too — it would have published a one-relay list", async () => {
    queryAnswered.mockResolvedValue({ events: [], answered: false });
    const ok = await updateNip65RelayList("add", "wss://joining.example");
    expect(ok).toBe(false);
    expect(publishedTags()).toBeNull();
  });

  it("adds to the real list when the relays DID answer", async () => {
    queryAnswered.mockResolvedValue({
      events: [{ created_at: 100, tags: [relayTag("wss://kept-a.example"), relayTag("wss://kept-b.example")] }],
      answered: true,
    });
    const ok = await updateNip65RelayList("add", "wss://new.example");
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([
      relayTag("wss://kept-a.example"),
      relayTag("wss://kept-b.example"),
      relayTag("wss://new.example"),
    ]);
  });

  it("removes only the named relay, keeping the rest", async () => {
    queryAnswered.mockResolvedValue({
      events: [{ created_at: 100, tags: [relayTag("wss://keep.example"), relayTag("wss://drop.example")] }],
      answered: true,
    });
    const ok = await updateNip65RelayList("remove", "wss://drop.example");
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([relayTag("wss://keep.example")]);
  });

  it("an answered EMPTY is a real answer — a first relay list may be created", async () => {
    // Refusing here would strand someone who genuinely has no kind-10002 yet.
    queryAnswered.mockResolvedValue({ events: [], answered: true });
    const ok = await updateNip65RelayList("add", "wss://first.example");
    expect(ok).toBe(true);
    expect(publishedTags()).toEqual([relayTag("wss://first.example")]);
  });
});
