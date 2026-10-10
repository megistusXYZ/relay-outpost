// @vitest-environment jsdom
/**
 * The wider-network switch rides the synced settings (owner, 2026-10-10), so
 * a new account that opens or closes the wider network on one phone is in
 * the same state on the next. Two rules keep existing users untouched:
 * absence in a synced copy NEVER clears a stored value (a settings event
 * from an older build simply doesn't know the field), and only a boolean is
 * applied.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let remote: Record<string, unknown> | null = null;
let published: string[] = [];
vi.mock("@/lib/nostr", () => ({
  pool: {
    subscribeMany: (_relays: string[], _filter: unknown, h: { onevent: (e: unknown) => void; oneose: () => void }) => {
      setTimeout(() => {
        if (remote) h.onevent({ id: "e1", kind: 30078, pubkey: "p", created_at: Math.floor((remote.lastModified as number) / 1000), tags: [], content: "sealed", sig: "s" });
        h.oneose();
      }, 0);
      return { close() {} };
    },
    listConnectionStatus: () => new Map([["wss://relay.example", true]]),
  },
  publishEvent: vi.fn(async () => true),
  filterBlockedRelays: (r: string[]) => r,
}));

const PK = "cd".repeat(32);
const signer = {
  getPublicKey: async () => PK,
  signEvent: async (t: object) => ({ ...t, id: "x", pubkey: PK, sig: "s" }),
  nip44: {
    decrypt: async () => JSON.stringify({ version: 1, ...remote }),
    encrypt: async (_pk: string, s: string) => { published.push(s); return s; },
  },
};
const KEY = `ro_public_nostr:${PK}`;

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

async function freshSettings() {
  vi.resetModules();
  return import("./nip78-settings");
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
  remote = null;
  published = [];
});

describe("the wider-network switch and the synced settings", () => {
  it("a synced copy that says OFF turns this device off", async () => {
    const s = await freshSettings();
    remote = { lastModified: Date.now(), widerNetwork: false };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("a synced copy that says ON turns this device on", async () => {
    localStorage.setItem(KEY, "0");
    const s = await freshSettings();
    remote = { lastModified: Date.now(), widerNetwork: true };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("a synced copy without the field (an older build) leaves a new account's OFF alone", async () => {
    localStorage.setItem(KEY, "0");
    const s = await freshSettings();
    remote = { lastModified: Date.now(), theme: "dark" };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("a synced copy without the field leaves an existing account unset — still on", async () => {
    const s = await freshSettings();
    remote = { lastModified: Date.now(), theme: "dark" };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("this device's OFF rides up to the relays when settings sync (a new account's only setting)", async () => {
    localStorage.setItem(KEY, "0");
    const s = await freshSettings();
    vi.useFakeTimers();
    try {
      s.initSettingsSync(PK, signer as never);
      const load = s.loadSettingsFromRelay(PK, signer as never); // nothing remote → local publishes
      await vi.advanceTimersByTimeAsync(10);
      await load;
      await vi.advanceTimersByTimeAsync(3_500); // the debounced publish
    } finally {
      vi.useRealTimers();
    }
    const last = published.at(-1);
    expect(last).toBeDefined();
    expect(JSON.parse(last!).widerNetwork).toBe(false);
  });
});
