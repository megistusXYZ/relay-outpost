// @vitest-environment jsdom
/**
 * An edit made on this device outlives an older synced copy (WebKit sweep,
 * 2026-10-07: relays-home-e2e). A change only counted as "newer" once the
 * debounced sync ran, 3 s later — and never if it was made before the first
 * settings load finished. Close the app inside that window, or change
 * something in the first moments after launch, and the next load applied the
 * other device's older settings over it. For the community list an empty
 * synced copy removed the whole list.
 *
 * Now a device that already knows this account's settings stamps its edits
 * the moment they happen. A device that has never had them still defers to
 * what's synced (its defaults must never overwrite real settings), and a
 * synced copy genuinely newer than the edit still wins.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let remote: { lastModified: number; outpostRelays: unknown[] } | null = null;
vi.mock("@/lib/nostr", () => ({
  pool: {
    subscribeMany: (_relays: string[], _filter: unknown, h: { onevent: (e: unknown) => void; oneose: () => void }) => {
      setTimeout(() => {
        if (remote) h.onevent({ id: "e1", kind: 30078, pubkey: "p", created_at: Math.floor(remote.lastModified / 1000), tags: [], content: "sealed", sig: "s" });
        h.oneose();
      }, 0);
      return { close() {} };
    },
    listConnectionStatus: () => new Map([["wss://relay.example", true]]),
  },
  publishEvent: vi.fn(async () => true),
  filterBlockedRelays: (r: string[]) => r,
}));

const PK = "ab".repeat(32);
const signer = {
  getPublicKey: async () => PK,
  signEvent: async (t: object) => ({ ...t, id: "x", pubkey: PK, sig: "s" }),
  nip44: {
    decrypt: async () => JSON.stringify({ version: 1, ...remote }),
    encrypt: async (_pk: string, s: string) => s,
  },
};
const HARBOUR = [{ url: "wss://harbour.example", label: "Harbour Club", access: "public", isAdmin: true }];
const list = () => JSON.parse(localStorage.getItem("nostr_outpost_relays") || "[]");

async function freshSettings() {
  vi.resetModules();
  return import("./nip78-settings");
}

// A Storage-shaped class: the app's write hook patches its prototype, as it
// patches the browser's (lib/storage-write-hook.ts).
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  remote = null;
});

describe("an edit on this device and an older synced copy", () => {
  it("a device that knows its settings keeps an edit made moments ago", async () => {
    localStorage.setItem(`relay-outpost-settings-seen:${PK}`, "1");
    localStorage.setItem(`relay-outpost-settings-ts:${PK}`, String(Date.now() - 86_400_000));
    const s = await freshSettings();
    s.initSettingsSync(PK, signer as never);
    localStorage.setItem("nostr_outpost_relays", JSON.stringify(HARBOUR)); // connect a relay…
    remote = { lastModified: Date.now() - 60_000, outpostRelays: [] }; // …the other device synced a minute ago
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(list()).toHaveLength(1);
  });

  it("a synced copy genuinely newer than the edit still wins", async () => {
    localStorage.setItem(`relay-outpost-settings-seen:${PK}`, "1");
    const s = await freshSettings();
    s.initSettingsSync(PK, signer as never);
    localStorage.setItem("nostr_outpost_relays", JSON.stringify(HARBOUR));
    remote = { lastModified: Date.now() + 60_000, outpostRelays: [] };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(list()).toHaveLength(0);
  });

  it("rewriting a setting with the value it already had is not an edit", async () => {
    // The app re-writes some settings on its own (the theme, at load): that
    // must not outrank changes made on the other device since.
    localStorage.setItem(`relay-outpost-settings-seen:${PK}`, "1");
    localStorage.setItem(`relay-outpost-settings-ts:${PK}`, String(Date.now() - 86_400_000));
    localStorage.setItem("nostr_outpost_relays", JSON.stringify(HARBOUR));
    const s = await freshSettings();
    s.initSettingsSync(PK, signer as never);
    localStorage.setItem("nostr_outpost_relays", JSON.stringify(HARBOUR)); // same value again
    remote = { lastModified: Date.now() - 60_000, outpostRelays: [] }; // the other device removed it since
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(list()).toHaveLength(0);
  });

  it("a device that has never had this account's settings defers to them", async () => {
    const s = await freshSettings();
    s.initSettingsSync(PK, signer as never);
    localStorage.setItem("nostr_outpost_relays", JSON.stringify(HARBOUR));
    remote = { lastModified: Date.now() - 60_000, outpostRelays: [] };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(list()).toHaveLength(0);
  });
});
