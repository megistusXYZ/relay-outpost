/**
 * The encrypted-calls switch: calls ship hidden and are turned on per device
 * while they're being proven, the way "Private chats (beta)" started.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isConcordCallsEnabled, setConcordCallsEnabled } from "./concord-prefs";

const KEY = "ro_concord_calls";

// vitest here is *.test.ts with no DOM, so stand up the two globals this
// module touches, the same way media-feed-prefs.test.ts does.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return store;
}

describe("encrypted calls switch: off until turned on, on this device only", () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installStorage(); });

  it("is off with nothing stored", () => {
    expect(isConcordCallsEnabled()).toBe(false);
  });

  it("turns on and off again", () => {
    setConcordCallsEnabled(true);
    expect(isConcordCallsEnabled()).toBe(true);
    setConcordCallsEnabled(false);
    expect(isConcordCallsEnabled()).toBe(false);
  });

  it("is on only for the exact value it writes", () => {
    for (const leftover of ["true", "0", "yes", ""]) {
      store.set(KEY, leftover);
      expect(isConcordCallsEnabled(), leftover).toBe(false);
    }
  });

  it("never syncs to other devices (a synced setting publishes a NIP-78 event on every change)", () => {
    const synced = readFileSync(join(process.cwd(), "client", "src", "lib", "nip78-settings.ts"), "utf8");
    expect(synced).not.toContain(KEY);
  });
});
