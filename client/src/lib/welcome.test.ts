import { describe, it, expect, beforeEach } from "vitest";
import { isWelcomed, markWelcomed } from "./welcome";

// vitest here runs without a DOM; stand up localStorage the way
// media-feed-prefs.test.ts does.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

describe("the welcome is shown once per account", () => {
  beforeEach(() => { installStorage(); });

  it("isn't marked seen until the account has seen it, and only for that account", () => {
    expect(isWelcomed(ALICE)).toBe(false);
    markWelcomed(ALICE);
    expect(isWelcomed(ALICE)).toBe(true);
    // Another account on the same device still gets its own welcome.
    expect(isWelcomed(BOB)).toBe(false);
  });

  it("never throws when storage is unavailable, and treats that as already welcomed", () => {
    // A blocked store must never trap someone on the welcome screen at every sign-in.
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(() => markWelcomed(ALICE)).not.toThrow();
    expect(isWelcomed(ALICE)).toBe(true);
  });
});
