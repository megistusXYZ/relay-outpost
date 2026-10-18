// @vitest-environment jsdom
/**
 * An operator's report decisions ride the synced settings (owner, 2026-10-18):
 * whose reports they ignore and when they dismissed each row. A synced copy
 * merges entry by entry, newest decision winning, so an undo on this device
 * isn't undone by another device's older copy.
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
const IGN = `ro_ignored_reporters:${PK}`;
const DIS = `ro_report_dismissals:${PK}`;
const R1 = "1".repeat(64), R2 = "2".repeat(64);

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

describe("report decisions and the synced settings", () => {
  it("a reporter ignored on another device is ignored here", async () => {
    const s = await freshSettings();
    remote = { lastModified: Date.now(), ignoredReporters: { [R1]: { on: true, at: 100 } } };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(JSON.parse(localStorage.getItem(IGN) || "{}")).toEqual({ [R1]: { on: true, at: 100 } });
  });

  it("an undo made here survives an older copy that still ignores them", async () => {
    localStorage.setItem(IGN, JSON.stringify({ [R1]: { on: false, at: 300 } }));
    const s = await freshSettings();
    remote = { lastModified: Date.now(), ignoredReporters: { [R1]: { on: true, at: 100 }, [R2]: { on: true, at: 150 } } };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(JSON.parse(localStorage.getItem(IGN) || "{}")).toEqual({ [R1]: { on: false, at: 300 }, [R2]: { on: true, at: 150 } });
  });

  it("dismissals merge, keeping the later time", async () => {
    localStorage.setItem(DIS, JSON.stringify({ "wss://r.example|p:x": 50 }));
    const s = await freshSettings();
    remote = { lastModified: Date.now(), reportDismissals: { "wss://r.example|p:x": 20, "wss://r.example|e:y": 70 } };
    await s.loadSettingsFromRelay(PK, signer as never);
    expect(JSON.parse(localStorage.getItem(DIS) || "{}")).toEqual({ "wss://r.example|p:x": 50, "wss://r.example|e:y": 70 });
  });

  it("this device's decisions ride up when settings sync", async () => {
    localStorage.setItem(IGN, JSON.stringify({ [R1]: { on: true, at: 100 } }));
    const s = await freshSettings();
    vi.useFakeTimers();
    try {
      s.initSettingsSync(PK, signer as never);
      const load = s.loadSettingsFromRelay(PK, signer as never);
      await vi.advanceTimersByTimeAsync(10);
      await load;
      await vi.advanceTimersByTimeAsync(3_500);
    } finally {
      vi.useRealTimers();
    }
    expect(published.some((p) => JSON.parse(p).ignoredReporters?.[R1]?.on === true)).toBe(true);
  });
});
