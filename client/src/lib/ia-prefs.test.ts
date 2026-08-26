import { describe, it, expect, beforeEach } from "vitest";
import { isIaCollapsed, setIaCollapsed } from "./ia-prefs";

const KEY = "ro_ia_collapsed";

// jsdom isn't configured for this suite (vitest include is *.test.ts, no DOM),
// so stand up the two globals ia-prefs touches.
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

describe("ia-prefs — simplified navigation is the default", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it("is ON with nothing stored", () => {
    // The flip. Everyone who has never touched the switch gets the four-tab nav.
    expect(store.has(KEY)).toBe(false);
    expect(isIaCollapsed()).toBe(true);
  });

  it("only a literal \"0\" turns it off", () => {
    setIaCollapsed(false);
    expect(store.get(KEY)).toBe("0");
    expect(isIaCollapsed()).toBe(false);
  });

  it("turns back on, and the switch round-trips", () => {
    setIaCollapsed(false);
    expect(isIaCollapsed()).toBe(false);
    setIaCollapsed(true);
    expect(isIaCollapsed()).toBe(true);
  });

  it("fails OPEN on anything corrupt or half-written", () => {
    // Same rule as public-nostr and the Concord flag: an absent or damaged
    // value must never be mistaken for a deliberate opt-out. Reading it the
    // other way round would silently hand the old eight-item nav to anyone
    // whose storage was cleared.
    for (const junk of ["", "1", "true", "false", "off", "{}", " 0", "0 "]) {
      store.set(KEY, junk);
      expect(isIaCollapsed(), `stored ${JSON.stringify(junk)}`).toBe(true);
    }
  });

  it("respects an explicit opt-out across reloads", () => {
    // Someone who chose Classic keeps it — the default only fills a blank.
    store.set(KEY, "0");
    expect(isIaCollapsed()).toBe(false);
    expect(isIaCollapsed()).toBe(false);
  });

  it("treats unreadable storage as ON", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    // Private-mode / blocked storage must not resurrect the old navigation.
    expect(isIaCollapsed()).toBe(true);
  });
});
