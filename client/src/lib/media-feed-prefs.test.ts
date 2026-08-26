import { describe, it, expect, beforeEach } from "vitest";
import { isMediaFeedEnabled, setMediaFeedEnabled } from "./media-feed-prefs";

const KEY = "ro_media_feed";

// vitest include here is *.test.ts with no DOM, so stand up the two globals
// this module touches — same approach as ia-prefs.test.ts.
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

describe("media-feed flag — on by default, one literal turns it off", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it("is ON with nothing stored", () => {
    expect(store.has(KEY)).toBe(false);
    expect(isMediaFeedEnabled()).toBe(true);
  });

  it('only a literal "0" turns it off', () => {
    setMediaFeedEnabled(false);
    expect(store.get(KEY)).toBe("0");
    expect(isMediaFeedEnabled()).toBe(false);
  });

  it("turning it back on clears the key rather than storing a truthy string", () => {
    // Absence is the ON state, so ON must be represented by absence — storing
    // "1" would leave two encodings of the same thing and invite drift.
    setMediaFeedEnabled(false);
    setMediaFeedEnabled(true);
    expect(store.has(KEY)).toBe(false);
    expect(isMediaFeedEnabled()).toBe(true);
  });

  it("fails OPEN on anything corrupt or half-written", () => {
    for (const junk of ["", "1", "true", "false", "off", "{}", " 0", "0 "]) {
      store.set(KEY, junk);
      expect(isMediaFeedEnabled(), `stored ${JSON.stringify(junk)}`).toBe(true);
    }
  });

  it("respects an explicit opt-out across reloads", () => {
    store.set(KEY, "0");
    expect(isMediaFeedEnabled()).toBe(false);
    expect(isMediaFeedEnabled()).toBe(false);
  });

  it("treats unreadable storage as ON", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(isMediaFeedEnabled()).toBe(true);
    // And writing through blocked storage must not throw into the caller.
    expect(() => setMediaFeedEnabled(false)).not.toThrow();
  });
});
